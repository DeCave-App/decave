// DM encryption on mobile: starts the session for the signed-in account, feeds
// it realtime events, and shows the recovery code, device approval, unlock,
// reset and safety-number dialogs. See src/lib/e2ee/client.ts.

import { useEffect, useState, useSyncExternalStore, type PropsWithChildren } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { DM_HISTORY_CHOICES, UNKNOWN_DEVICE_LABEL } from "@/src/lib/e2ee/dm-e2ee-session";
import { e2eeErrorText, e2eeStateErrorText } from "@/src/lib/e2ee-error-text";
import { deviceName } from "@/src/lib/session-device";
import { Ionicons } from "@expo/vector-icons";
import { Trans, useTranslation } from "react-i18next";
import { useSession } from "@/src/providers/SessionProvider";
import { useRealtime } from "@/src/providers/RealtimeProvider";
import {
  dmE2ee,
  discardDmSend,
  discardGroupSend,
  knownGroup,
  settleDmSend,
  settleGroupSend,
  retryFrameAfterDmError,
  retryGroupFrameAfterError,
  setDmE2eeToken,
  useDmE2ee,
} from "@/src/lib/e2ee/client";
import { colors } from "@/src/theme";
import { useCallVerdict } from "@/src/lib/e2ee/call-verification";

type Peer = { id: string; username: string };
type DialogState = { kind: "unlock" } | { kind: "safety"; peer: Peer } | { kind: "reset" } | null;

let dialog: DialogState = null;
const dialogListeners = new Set<() => void>();
function setDialog(next: DialogState) {
  dialog = next;
  for (const listener of dialogListeners) listener();
}
function useDialog() {
  return useSyncExternalStore(
    (listener) => {
      dialogListeners.add(listener);
      return () => dialogListeners.delete(listener);
    },
    () => dialog,
  );
}

export const openDmUnlock = () => setDialog({ kind: "unlock" });

const errorText = e2eeErrorText;

/** The format of a recovery code, shown as the input's placeholder. */
const RECOVERY_CODE_MASK = "XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX";

export function DmE2eeProvider({ children }: PropsWithChildren) {
  const { user, token } = useSession();
  const { subscribe, send } = useRealtime();

  useEffect(() => {
    setDmE2eeToken(token);
    if (user?.id && token) void dmE2ee.start(user.id);
    // Signed out without choosing to (session ended elsewhere): keep the key on the phone.
    else void dmE2ee.stop({ forget: false });
  }, [user?.id, token]);

  useEffect(
    () =>
      subscribe((event) => {
        if (dmE2ee.handleRealtimeEvent(event)) return;
        if (event.type === "DM_MESSAGE" && event.message && typeof event.message === "object") {
          const message = event.message as { id?: unknown; fromUserId?: unknown; toUserId?: unknown };
          if (
            message.fromUserId === user?.id &&
            typeof message.id === "string" &&
            typeof message.toUserId === "string"
          ) {
            settleDmSend(message.id, message.toUserId, event.clientMessageId);
          }
        }
        if (event.type === "GROUP_MESSAGE" && event.message && typeof event.message === "object") {
          const message = event.message as { id?: unknown; fromUserId?: unknown; groupId?: unknown };
          const groupId = typeof event.groupId === "string" ? event.groupId : message.groupId;
          if (
            message.fromUserId === user?.id &&
            typeof message.id === "string" &&
            typeof groupId === "string"
          ) {
            settleGroupSend(message.id, groupId, event.clientMessageId);
          }
        }
        if (event.type === "DM_ERROR") {
          void retryFrameAfterDmError({
            code: event.code,
            messageId: event.messageId,
            clientMessageId: event.clientMessageId,
            targetUserId: event.targetUserId,
          })
            .then((frame) => {
              if (frame && !send(frame)) discardDmSend(frame.clientMessageId);
            })
            .catch(() => undefined);
        }
        if (event.type === "GROUP_ERROR") {
          void retryGroupFrameAfterError(
            {
              code: event.code,
              messageId: event.messageId,
              clientMessageId: event.clientMessageId,
              groupId: event.groupId,
            },
            knownGroup,
          )
            .then((frame) => {
              if (frame && !send(frame)) discardGroupSend(frame.clientMessageId);
            })
            .catch(() => undefined);
        }
      }),
    [subscribe, send, user?.id],
  );

  return (
    <>
      {children}
      <DmE2eeDialogs />
    </>
  );
}

/** Whether a conversation is encrypted, and its safety number. */
function useConversationInfo(peerId: string) {
  const state = useDmE2ee();
  const pin = state.pins[peerId];
  const [info, setInfo] = useState<{ encrypted: boolean; safetyNumber: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    if (!peerId || (state.status !== "ready" && state.status !== "locked")) return;
    const load = async () => {
      try {
        const result =
          state.status === "ready"
            ? await dmE2ee.conversationInfo(peerId)
            : { encrypted: await dmE2ee.peerHasKey(peerId), safetyNumber: null };
        if (!cancelled) setInfo(result);
      } catch {
        if (!cancelled) setInfo(null);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [peerId, state.status, state.keyId, pin?.keyId]);
  return { state, info, pin };
}

/** Lock button for a DM header. */
export function DmEncryptionBadge({ peer }: { peer: Peer }) {
  const { t } = useTranslation(["common", "dm"]);
  const { state, info, pin } = useConversationInfo(peer.id);
  if (!info) return null;
  const label = info.encrypted
    ? pin?.verified
      ? t("dm.mobile.e2ee.badgeVerified")
      : t("dm.e2ee.badge.encrypted")
    : t("dm.e2ee.badge.notEncrypted");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => setDialog(state.status === "locked" ? { kind: "unlock" } : { kind: "safety", peer })}
      style={styles.badge}
    >
      <Ionicons
        name={info.encrypted ? "lock-closed" : "lock-open-outline"}
        size={18}
        color={info.encrypted ? colors.green : colors.muted}
      />
    </Pressable>
  );
}

/** The lock in a group chat header, once the group is encrypted. */
export function GroupEncryptionBadge({ group }: { group: { e2ee?: boolean } }) {
  const { t } = useTranslation(["common", "dm"]);
  const state = useDmE2ee();
  if (!state.available || !group.e2ee) return null;
  const label =
    state.status === "locked"
      ? t("dm.mobile.e2ee.groupLocked")
      : t("dm.e2ee.groupBadge.ready");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => {
        if (state.status === "locked") setDialog({ kind: "unlock" });
      }}
      style={styles.badge}
    >
      <Ionicons name="lock-closed" size={18} color={colors.green} />
    </Pressable>
  );
}

/** The notice above a conversation, when there is something to say. */
export function DmEncryptionNotice({ peer }: { peer: Peer }) {
  const { t } = useTranslation(["common", "dm"]);
  const { state, info, pin } = useConversationInfo(peer.id);
  let body: string | null = null;
  let action: { label: string; run: () => void } | null = null;
  let warning = true;
  if (state.status === "locked") {
    body = t("dm.mobile.e2ee.noticeLocked");
    action = { label: t("dm.e2ee.notice.unlock"), run: () => setDialog({ kind: "unlock" }) };
  } else if (state.status === "error") {
    body = t("dm.e2ee.notice.unavailable", { error: e2eeStateErrorText(state) });
    action = { label: t("dm.e2ee.notice.retry"), run: () => state.accountId && void dmE2ee.start(state.accountId) };
  } else if (pin?.changed) {
    body = t("dm.e2ee.notice.codeChanged", { name: peer.username });
    action = { label: t("dm.e2ee.notice.verify"), run: () => setDialog({ kind: "safety", peer }) };
  } else if (info && !info.encrypted) {
    warning = false;
    body = t("dm.e2ee.notice.notYetEncrypted", { name: peer.username });
  }
  if (!body) return null;
  return (
    <View style={[styles.notice, warning && styles.noticeWarning]} accessibilityRole="summary">
      <Ionicons name="lock-closed-outline" size={15} color={warning ? colors.yellow : colors.muted} />
      <Text style={styles.noticeText}>{body}</Text>
      {action && (
        <Pressable accessibilityRole="button" onPress={action.run} style={styles.noticeButton}>
          <Text style={styles.noticeButtonText}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

/** Settings row: this phone's encryption status and key controls. */
export function DmEncryptionSettings() {
  const { t } = useTranslation(["common", "dm"]);
  const state = useDmE2ee();
  const [error, setError] = useState("");
  const status =
    state.status === "ready"
      ? t("dm.mobile.e2ee.statusReady")
      : state.status === "locked"
        ? t("dm.mobile.e2ee.statusLocked")
        : state.status === "error"
          ? t("dm.e2ee.settings.statusError", { error: e2eeStateErrorText(state) })
          : t("dm.e2ee.settings.statusStarting");
  return (
    <View style={{ gap: 10 }}>
      <Text style={styles.muted}>
        {t("dm.mobile.e2ee.settingsIntro")}
      </Text>
      <Text style={styles.body}>{status}</Text>
      {state.status === "locked" && <Button label={t("dm.mobile.e2ee.unlockOnPhone")} primary onPress={() => setDialog({ kind: "unlock" })} />}
      {state.status === "ready" && (
        <Button
          label={t("dm.e2ee.settings.newRecoveryCode")}
          onPress={() => {
            setError("");
            dmE2ee.replaceRecoveryCode().catch((caught) => setError(errorText(caught, t("dm.mobile.e2ee.newCodeFailed"))));
          }}
        />
      )}
      {state.status === "ready" && (
        <View style={{ gap: 6 }}>
          <Text style={styles.body}>{t("dm.e2ee.settings.historyTitle")}</Text>
          <Text style={styles.muted}>
            {t("dm.mobile.e2ee.historyHelp")}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {DM_HISTORY_CHOICES.map((days) => {
              const label = days === null ? t("dm.e2ee.history.always") : days === 365 ? t("dm.e2ee.history.year") : t("dm.e2ee.history.days", { count: days });
              const selected = state.historyDays === days;
              return (
                <Pressable
                  key={label}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    if (selected) return;
                    const apply = () => {
                      setError("");
                      dmE2ee.setHistoryDays(days).catch((caught) => setError(errorText(caught, t("dm.e2ee.settings.saveFailed"))));
                    };
                    if (days === null) {
                      apply();
                      return;
                    }
                    Alert.alert(
                      t("dm.mobile.e2ee.historyConfirmTitle", { period: label }),
                      t("dm.mobile.e2ee.historyConfirm", { period: label }),
                      [
                        { text: t("common.actions.cancel"), style: "cancel" },
                        { text: t("common.actions.continue"), style: "destructive", onPress: apply },
                      ],
                    );
                  }}
                  style={[styles.button, selected && styles.buttonPrimary]}
                >
                  <Text style={[styles.buttonText, selected && { color: "#FFFFFF" }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
      {(state.status === "ready" || state.status === "locked") && (
        <Button label={t("dm.e2ee.settings.resetKey")} danger onPress={() => setDialog({ kind: "reset" })} />
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

// ---------------------------------------------------------------- dialogs

function Button({
  label,
  onPress,
  primary,
  danger,
  disabled,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, primary && styles.buttonPrimary, danger && styles.buttonDanger, disabled && { opacity: 0.45 }]}
    >
      <Text style={[styles.buttonText, (primary || danger) && { color: "#FFFFFF" }]}>{label}</Text>
    </Pressable>
  );
}

function Sheet({ title, onClose, children }: PropsWithChildren<{ title: string; onClose?: () => void }>) {
  const { t } = useTranslation(["common", "dm"]);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose ?? (() => undefined)}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.sheetHead}>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            {onClose && (
              <Pressable accessibilityRole="button" accessibilityLabel={t("dm.e2ee.modal.close")} hitSlop={10} onPress={onClose}>
                <Ionicons name="close" size={22} color={colors.muted} />
              </Pressable>
            )}
          </View>
          <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function RecoveryCodeSheet({ code }: { code: string }) {
  const { t } = useTranslation(["common", "dm"]);
  const [saved, setSaved] = useState(false);
  return (
    <Sheet title={t("dm.e2ee.recovery.title")}>
      <Text style={styles.muted}>
        {t("dm.e2ee.recovery.intro")}
      </Text>
      <Text selectable style={styles.code}>
        {code}
      </Text>
      <Button label={t("dm.mobile.e2ee.shareCode")} onPress={() => void Share.share({ message: code })} />
      <View style={styles.row}>
        <Switch value={saved} onValueChange={setSaved} accessibilityLabel={t("dm.mobile.e2ee.savedLabel")} />
        <Text style={[styles.body, { flex: 1 }]}>{t("dm.mobile.e2ee.savedConfirm")}</Text>
      </View>
      <Button label={t("dm.e2ee.recovery.done")} primary disabled={!saved} onPress={() => dmE2ee.acknowledgeRecoveryCode()} />
    </Sheet>
  );
}

function UnlockSheet() {
  const { t } = useTranslation(["common", "dm"]);
  const state = useDmE2ee();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const link = state.link;
  useEffect(() => {
    if (state.status === "ready") setDialog(null);
  }, [state.status]);
  const close = () => {
    if (link?.state === "waiting") dmE2ee.cancelLink();
    setDialog(null);
  };
  return (
    <Sheet title={t("dm.e2ee.unlock.title")} onClose={close}>
      <Text style={styles.muted}>
        {t("dm.mobile.e2ee.unlockIntro")}
      </Text>
      <Text style={styles.subtitle}>{t("dm.mobile.e2ee.useSignedInDevice")}</Text>
      {!link && (
        <Button
          label={t("dm.e2ee.unlock.askDevices")}
          primary
          disabled={busy}
          onPress={() => {
            setError("");
            setBusy(true);
            dmE2ee
              .requestLink()
              .catch((caught) => setError(errorText(caught, t("dm.e2ee.unlock.askFailed"))))
              .finally(() => setBusy(false));
          }}
        />
      )}
      {link?.state === "waiting" && (
        <>
          <Text style={styles.body}>{t("dm.e2ee.unlock.compareCode")}</Text>
          <Text selectable style={styles.code}>
            {link.code}
          </Text>
          <Text style={styles.muted}>{t("dm.e2ee.unlock.waiting")}</Text>
        </>
      )}
      {link && link.state !== "waiting" && (
        <>
          <Text style={styles.error}>
            {link.state === "denied"
              ? t("dm.e2ee.unlock.declined")
              : link.state === "expired"
                ? t("dm.e2ee.unlock.expired")
                : t("dm.mobile.e2ee.linkFailed")}
          </Text>
          <Button label={t("dm.e2ee.unlock.startOver")} onPress={() => dmE2ee.cancelLink()} />
        </>
      )}
      <Text style={styles.subtitle}>{t("dm.e2ee.unlock.codeHeading")}</Text>
      <TextInput
        value={code}
        onChangeText={setCode}
        placeholder={RECOVERY_CODE_MASK}
        placeholderTextColor={colors.faint}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        accessibilityLabel={t("dm.e2ee.unlock.codeLabel")}
        style={styles.input}
      />
      <Button
        label={t("dm.e2ee.unlock.submit")}
        disabled={busy || code.replace(/[\s-]/g, "").length < 32}
        onPress={() => {
          setError("");
          setBusy(true);
          dmE2ee
            .unlockWithRecoveryCode(code)
            .catch((caught) => setError(errorText(caught, t("dm.e2ee.unlock.codeFailed"))))
            .finally(() => setBusy(false));
        }}
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Pressable accessibilityRole="button" onPress={() => setDialog({ kind: "reset" })}>
        <Text style={styles.link}>{t("dm.mobile.e2ee.lostEverything")}</Text>
      </Pressable>
    </Sheet>
  );
}

function ResetSheet() {
  const { t } = useTranslation(["common", "dm"]);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Sheet title={t("dm.e2ee.reset.title")} onClose={() => setDialog(null)}>
      <Text style={styles.muted}>
        {t("dm.e2ee.reset.intro")}
      </Text>
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder={t("dm.e2ee.reset.password")}
        placeholderTextColor={colors.faint}
        secureTextEntry
        autoComplete="current-password"
        accessibilityLabel={t("dm.e2ee.reset.password")}
        style={styles.input}
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Button
        label={t("dm.e2ee.reset.submit")}
        danger
        disabled={busy || !password}
        onPress={() => {
          setBusy(true);
          setError("");
          dmE2ee
            .resetKey(password)
            .then(() => setDialog(null))
            .catch((caught) => setError(errorText(caught, t("dm.e2ee.reset.failed"))))
            .finally(() => setBusy(false));
        }}
      />
    </Sheet>
  );
}

function SafetySheet({ peer }: { peer: Peer }) {
  const { t } = useTranslation(["common", "dm"]);
  const { state, info, pin } = useConversationInfo(peer.id);
  return (
    <Sheet title={t("dm.e2ee.safety.title")} onClose={() => setDialog(null)}>
      {info?.encrypted && info.safetyNumber ? (
        <>
          <Text style={styles.muted}>
            {t("dm.e2ee.safety.intro", { name: peer.username })}
          </Text>
          <Text selectable style={styles.code}>
            {info.safetyNumber.replace(/((?:\d{5} ){3}\d{5}) /g, "$1\n")}
          </Text>
          {!pin?.verified && (
            <Button
              label={t("dm.e2ee.safety.markVerified")}
              primary
              onPress={() => {
                void dmE2ee.acknowledgeKeyChange(peer.id, true);
                setDialog(null);
              }}
            />
          )}
          {pin?.changed && <Button label={t("dm.mobile.e2ee.dismissChange")} onPress={() => void dmE2ee.acknowledgeKeyChange(peer.id)} />}
        </>
      ) : (
        <Text style={styles.muted}>
          {state.status === "ready"
            ? t("dm.e2ee.safety.peerNotSetUp", { name: peer.username })
            : t("dm.mobile.e2ee.unlockToSee")}
        </Text>
      )}
    </Sheet>
  );
}

function ApproveSheet() {
  const { t } = useTranslation(["common", "dm"]);
  const state = useDmE2ee();
  const approval = state.approvals[0];
  const [error, setError] = useState("");
  if (!approval) return null;
  const answer = (approve: boolean) => {
    setError("");
    dmE2ee.answerApproval(approval.id, approve).catch((caught) => setError(errorText(caught, t("dm.mobile.e2ee.answerFailed"))));
  };
  return (
    <Sheet title={t("dm.e2ee.approve.title")} onClose={() => answer(false)}>
      <Text style={styles.muted}>
        <Trans
          t={t}
          i18nKey="dm.e2ee.approve.intro"
          values={{
            device:
              approval.deviceLabel === UNKNOWN_DEVICE_LABEL
                ? t("dm.e2ee.approve.unnamedDevice")
                : deviceName(approval.deviceLabel, approval.device),
          }}
          components={{ strong: <Text style={styles.body} /> }}
        />
      </Text>
      <Text selectable style={styles.code}>
        {approval.code}
      </Text>
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Button label={t("dm.e2ee.approve.approve")} primary onPress={() => answer(true)} />
      <Button label={t("dm.e2ee.approve.decline")} onPress={() => answer(false)} />
    </Sheet>
  );
}

function DmE2eeDialogs() {
  const state = useDmE2ee();
  const open = useDialog();
  if (state.pendingRecoveryCode) return <RecoveryCodeSheet code={state.pendingRecoveryCode} />;
  if (open?.kind === "reset") return <ResetSheet />;
  if (open?.kind === "unlock") return <UnlockSheet />;
  if (open?.kind === "safety") return <SafetySheet peer={open.peer} />;
  if (state.status === "ready" && state.approvals.length) return <ApproveSheet />;
  return null;
}

const styles = StyleSheet.create({
  badge: { padding: 6 },
  notice: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 12,
    marginTop: 8,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel2,
  },
  noticeWarning: { borderColor: colors.yellow },
  noticeText: { flex: 1, minWidth: 180, color: colors.text, fontSize: 13, lineHeight: 18 },
  noticeButton: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.violet },
  noticeButtonText: { color: "#FFFFFF", fontWeight: "800", fontSize: 13 },
  backdrop: { flex: 1, justifyContent: "center", padding: 16, backgroundColor: colors.overlay },
  sheet: {
    maxHeight: "90%",
    padding: 18,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.sheet,
  },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  title: { flex: 1, color: colors.text, fontSize: 19, fontWeight: "900" },
  subtitle: { color: colors.text, fontSize: 15, fontWeight: "800", marginTop: 6 },
  body: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: "600" },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  error: { color: colors.red, fontSize: 13, fontWeight: "700" },
  link: { color: colors.cyan, fontSize: 13, textDecorationLine: "underline", marginTop: 6 },
  code: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.input,
    color: colors.text,
    fontSize: 17,
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    letterSpacing: 1,
    textAlign: "center",
    lineHeight: 26,
  },
  input: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.input,
    color: colors.text,
    fontSize: 15,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  button: {
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.panel2,
  },
  buttonPrimary: { backgroundColor: colors.violet, borderColor: colors.violet },
  buttonDanger: { backgroundColor: colors.red, borderColor: colors.red },
  buttonText: { color: colors.text, fontWeight: "800", fontSize: 15 },
});

/** A small lock next to a call or voice participant whose connection was checked against their key. */
export function CallVerificationMark({ connectionId }: { connectionId: string }) {
  const { t } = useTranslation(["common", "dm"]);
  const verdict = useCallVerdict(connectionId);
  if (!verdict || verdict === "unverified") return null;
  const label =
    verdict === "verified"
      ? t("dm.e2ee.call.verified")
      : t("dm.e2ee.call.failed");
  return (
    <Ionicons
      name={verdict === "verified" ? "lock-closed" : "warning"}
      size={13}
      color={verdict === "verified" ? colors.muted : colors.red}
      accessibilityLabel={label}
      style={{ marginLeft: 4 }}
    />
  );
}
