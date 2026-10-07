// DM encryption on mobile: starts the session for the signed-in account, feeds
// it realtime events, and shows the recovery code, device approval, unlock,
// reset and safety-number dialogs. See src/lib/e2ee/client.ts.

import { useEffect, useState, useSyncExternalStore, type PropsWithChildren } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { DM_HISTORY_CHOICES } from "@/src/lib/e2ee/dm-e2ee-session";
import { Ionicons } from "@expo/vector-icons";
import { useSession } from "@/src/providers/SessionProvider";
import { useRealtime } from "@/src/providers/RealtimeProvider";
import {
  dmE2ee,
  knownGroup,
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

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

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
        if (event.type === "DM_ERROR") {
          void retryFrameAfterDmError({ code: event.code, messageId: event.messageId })
            .then((frame) => {
              if (frame) send(frame);
            })
            .catch(() => undefined);
        }
        if (event.type === "GROUP_ERROR") {
          void retryGroupFrameAfterError(
            { code: event.code, messageId: event.messageId, groupId: event.groupId },
            knownGroup,
          )
            .then((frame) => {
              if (frame) send(frame);
            })
            .catch(() => undefined);
        }
      }),
    [subscribe, send],
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
  const { state, info, pin } = useConversationInfo(peer.id);
  if (!info) return null;
  const label = info.encrypted ? (pin?.verified ? "Encrypted, verified" : "End-to-end encrypted") : "Not encrypted";
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
  const state = useDmE2ee();
  if (!state.available || !group.e2ee) return null;
  const label =
    state.status === "locked"
      ? "End-to-end encrypted. Unlock encrypted messages on this phone to read them."
      : "End-to-end encrypted: only members can read messages sent while they're in the group.";
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
  const { state, info, pin } = useConversationInfo(peer.id);
  let body: string | null = null;
  let action: { label: string; run: () => void } | null = null;
  let warning = true;
  if (state.status === "locked") {
    body = "Your encrypted messages are locked on this phone.";
    action = { label: "Unlock", run: () => setDialog({ kind: "unlock" }) };
  } else if (state.status === "error") {
    body = `Encryption isn't available right now: ${state.error}`;
    action = { label: "Retry", run: () => state.accountId && void dmE2ee.start(state.accountId) };
  } else if (pin?.changed) {
    body = `${peer.username}'s security code changed. This happens when they reset their encryption key; check with them if you didn't expect it.`;
    action = { label: "Verify", run: () => setDialog({ kind: "safety", peer }) };
  } else if (info && !info.encrypted) {
    warning = false;
    body = `Messages with ${peer.username} aren't end-to-end encrypted yet. They will be once ${peer.username} opens an up-to-date DeCave.`;
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
  const state = useDmE2ee();
  const [error, setError] = useState("");
  const status =
    state.status === "ready"
      ? "This phone can read and send end-to-end encrypted messages."
      : state.status === "locked"
        ? "Locked: approve this phone from a signed-in device, or enter your recovery code."
        : state.status === "error"
          ? `Unavailable: ${state.error}`
          : "Starting…";
  return (
    <View style={{ gap: 10 }}>
      <Text style={styles.muted}>
        Direct messages and group chats are end-to-end encrypted once everyone in them uses an up-to-date DeCave: only
        the people in the conversation can read them, not DeCave. Your key changes every month. Keep your recovery code somewhere safe.
      </Text>
      <Text style={styles.body}>{status}</Text>
      {state.status === "locked" && <Button label="Unlock on this phone" primary onPress={() => setDialog({ kind: "unlock" })} />}
      {state.status === "ready" && (
        <Button
          label="Create a new recovery code"
          onPress={() => {
            setError("");
            dmE2ee.replaceRecoveryCode().catch((caught) => setError(errorText(caught, "Could not create a new code.")));
          }}
        />
      )}
      {state.status === "ready" && (
        <View style={{ gap: 6 }}>
          <Text style={styles.body}>Keep old encrypted messages readable</Text>
          <Text style={styles.muted}>
            Shorter means a stolen phone or recovery code can read less of your past. Older encrypted messages become
            unreadable on all your devices.
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {DM_HISTORY_CHOICES.map((days) => {
              const label = days === null ? "Always" : days === 365 ? "1 year" : `${days} days`;
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
                      dmE2ee.setHistoryDays(days).catch((caught) => setError(errorText(caught, "Could not save the setting.")));
                    };
                    if (days === null) {
                      apply();
                      return;
                    }
                    Alert.alert(
                      `Keep ${label}?`,
                      `Encrypted messages older than ${label} will become unreadable on all your devices. This can't be undone.`,
                      [
                        { text: "Cancel", style: "cancel" },
                        { text: "Continue", style: "destructive", onPress: apply },
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
        <Button label="Reset encryption key" danger onPress={() => setDialog({ kind: "reset" })} />
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
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose ?? (() => undefined)}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.sheetHead}>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            {onClose && (
              <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={onClose}>
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
  const [saved, setSaved] = useState(false);
  return (
    <Sheet title="Save your recovery code">
      <Text style={styles.muted}>
        Your direct messages are now end-to-end encrypted. This code is the only way to read them on a new device when
        none of your other devices is around. DeCave can't show it again or recover it for you.
      </Text>
      <Text selectable style={styles.code}>
        {code}
      </Text>
      <Button label="Save to a password manager or notes…" onPress={() => void Share.share({ message: code })} />
      <View style={styles.row}>
        <Switch value={saved} onValueChange={setSaved} accessibilityLabel="I saved my recovery code" />
        <Text style={[styles.body, { flex: 1 }]}>I saved it somewhere safe.</Text>
      </View>
      <Button label="Done" primary disabled={!saved} onPress={() => dmE2ee.acknowledgeRecoveryCode()} />
    </Sheet>
  );
}

function UnlockSheet() {
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
    <Sheet title="Unlock encrypted messages" onClose={close}>
      <Text style={styles.muted}>
        This phone doesn't have your encryption key yet. Approve it from DeCave on your computer (if you're signed in
        there right now), or use your recovery code.
      </Text>
      <Text style={styles.subtitle}>Use a signed-in device</Text>
      {!link && (
        <Button
          label="Ask my signed-in devices"
          primary
          disabled={busy}
          onPress={() => {
            setError("");
            setBusy(true);
            dmE2ee
              .requestLink()
              .catch((caught) => setError(errorText(caught, "Could not ask your other devices.")))
              .finally(() => setBusy(false));
          }}
        />
      )}
      {link?.state === "waiting" && (
        <>
          <Text style={styles.body}>Approve this on your other device and check that it shows the same code:</Text>
          <Text selectable style={styles.code}>
            {link.code}
          </Text>
          <Text style={styles.muted}>Waiting for approval…</Text>
        </>
      )}
      {link && link.state !== "waiting" && (
        <>
          <Text style={styles.error}>
            {link.state === "denied" ? "The request was declined." : link.state === "expired" ? "The request expired." : "Something went wrong."}
          </Text>
          <Button label="Start over" onPress={() => dmE2ee.cancelLink()} />
        </>
      )}
      <Text style={styles.subtitle}>Use your recovery code</Text>
      <TextInput
        value={code}
        onChangeText={setCode}
        placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
        placeholderTextColor={colors.faint}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        accessibilityLabel="Recovery code"
        style={styles.input}
      />
      <Button
        label="Unlock"
        disabled={busy || code.replace(/[\s-]/g, "").length < 32}
        onPress={() => {
          setError("");
          setBusy(true);
          dmE2ee
            .unlockWithRecoveryCode(code)
            .catch((caught) => setError(errorText(caught, "That recovery code didn't work.")))
            .finally(() => setBusy(false));
        }}
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Pressable accessibilityRole="button" onPress={() => setDialog({ kind: "reset" })}>
        <Text style={styles.link}>Lost every device and your code? Reset your encryption key</Text>
      </Pressable>
    </Sheet>
  );
}

function ResetSheet() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Sheet title="Reset encryption key?" onClose={() => setDialog(null)}>
      <Text style={styles.muted}>
        A new key replaces the old one. Encrypted messages sent before now can no longer be read on any device, your
        other devices will need to be unlocked again, and the people you talk to will see that your security code
        changed.
      </Text>
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="Current password"
        placeholderTextColor={colors.faint}
        secureTextEntry
        autoComplete="current-password"
        accessibilityLabel="Current password"
        style={styles.input}
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Button
        label="Reset key"
        danger
        disabled={busy || !password}
        onPress={() => {
          setBusy(true);
          setError("");
          dmE2ee
            .resetKey(password)
            .then(() => setDialog(null))
            .catch((caught) => setError(errorText(caught, "Could not reset your key.")))
            .finally(() => setBusy(false));
        }}
      />
    </Sheet>
  );
}

function SafetySheet({ peer }: { peer: Peer }) {
  const { state, info, pin } = useConversationInfo(peer.id);
  return (
    <Sheet title="End-to-end encryption" onClose={() => setDialog(null)}>
      {info?.encrypted && info.safetyNumber ? (
        <>
          <Text style={styles.muted}>
            Messages with {peer.username} are end-to-end encrypted. To be sure nobody is in the middle, compare this
            security code with the one {peer.username} sees, in person or on a call.
          </Text>
          <Text selectable style={styles.code}>
            {info.safetyNumber.replace(/((?:\d{5} ){3}\d{5}) /g, "$1\n")}
          </Text>
          {!pin?.verified && (
            <Button
              label="Mark as verified"
              primary
              onPress={() => {
                void dmE2ee.acknowledgeKeyChange(peer.id, true);
                setDialog(null);
              }}
            />
          )}
          {pin?.changed && <Button label="Dismiss the change notice" onPress={() => void dmE2ee.acknowledgeKeyChange(peer.id)} />}
        </>
      ) : (
        <Text style={styles.muted}>
          {state.status === "ready"
            ? `${peer.username} hasn't set up encryption yet, so messages with them are stored readable by DeCave.`
            : "Unlock encrypted messages on this phone to see the security code."}
        </Text>
      )}
    </Sheet>
  );
}

function ApproveSheet() {
  const state = useDmE2ee();
  const approval = state.approvals[0];
  const [error, setError] = useState("");
  if (!approval) return null;
  const answer = (approve: boolean) => {
    setError("");
    dmE2ee.answerApproval(approval.id, approve).catch((caught) => setError(errorText(caught, "Could not answer.")));
  };
  return (
    <Sheet title="Approve a new device?" onClose={() => answer(false)}>
      <Text style={styles.muted}>
        <Text style={styles.body}>{approval.deviceLabel}</Text> wants to read your encrypted messages. Only approve it if
        you just signed in there and it shows this code:
      </Text>
      <Text selectable style={styles.code}>
        {approval.code}
      </Text>
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Button label="Approve" primary onPress={() => answer(true)} />
      <Button label="Decline" onPress={() => answer(false)} />
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
    backgroundColor: colors.panel,
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
  const verdict = useCallVerdict(connectionId);
  if (!verdict || verdict === "unverified") return null;
  const label =
    verdict === "verified"
      ? "End-to-end encrypted: this connection is verified with their account key."
      : "This connection failed its encryption check and was not connected.";
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
