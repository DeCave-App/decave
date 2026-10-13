// What people see of DM encryption: the lock in a conversation or group header,
// the notice above a conversation, the settings (including how long old
// messages stay readable), and the dialogs for the recovery code, unlocking this
// device, approving a new device, safety numbers and resetting the key.

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Icon } from "../components/Icon";
import { DM_HISTORY_CHOICES } from "../../shared/dm-e2ee-session";
import { dmE2ee, useDmE2ee } from "./dm-e2ee-client";
import { useCallVerdict } from "./call-verification";
import { i18next } from "../i18n";
import { deviceName } from "../i18n/sessionDevice";
import { e2eeErrorText, e2eeStateErrorText } from "./errorText";
import "./dm-encryption.css";

// t() for the helpers below that run outside components.
const dmT = i18next.getFixedT(null, ["dm"]);

type Peer = { id: string; username: string };

// Which encryption dialog is open, shared by every component in this file.
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

// The recovery code's shape, the same in every language.
const RECOVERY_CODE_SHAPE = "XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX";

export const openDmUnlockDialog = () => setDialog({ kind: "unlock" });

function errorText(error: unknown, fallback: string): string {
  return e2eeErrorText(error, fallback);
}

/** Whether a conversation is encrypted, and its safety number. Refreshes when keys change. */
function useConversationInfo(peerId: string) {
  const state = useDmE2ee();
  const pin = state.pins[peerId];
  const [info, setInfo] = useState<{ encrypted: boolean; safetyNumber: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    if (state.status !== "ready" && state.status !== "locked") return;
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

/** The lock button in a DM header. */
export function DmEncryptionBadge({ peer }: { peer: Peer }) {
  const { t } = useTranslation(["dm"]);
  const { state, info, pin } = useConversationInfo(peer.id);
  if (!info) return null;
  const encrypted = info.encrypted;
  const label = encrypted
    ? pin?.verified
      ? t("dm.e2ee.badge.verified")
      : t("dm.e2ee.badge.encrypted")
    : t("dm.e2ee.badge.notEncrypted");
  return (
    <button
      type="button"
      className={`dc-dm-head-action dc-e2ee-badge ${encrypted ? "is-encrypted" : "is-plain"}`}
      title={label}
      aria-label={label}
      onClick={() => {
        if (state.status === "locked") setDialog({ kind: "unlock" });
        else setDialog({ kind: "safety", peer });
      }}
    >
      <Icon name={encrypted ? "lock" : "shield"} />
    </button>
  );
}

/** The notice above a DM conversation, when there is something to say. */
export function DmEncryptionNotice({ peer }: { peer: Peer }) {
  const { t } = useTranslation(["dm"]);
  const { state, info, pin } = useConversationInfo(peer.id);
  if (state.status === "locked") {
    return (
      <div className="dc-e2ee-notice is-warning" role="status">
        <Icon name="lock" size="sm" />
        <span>{t("dm.e2ee.notice.locked")}</span>
        <button type="button" className="ds-btn ds-btn-sm ds-btn-primary" onClick={() => setDialog({ kind: "unlock" })}>
          {t("dm.e2ee.notice.unlock")}
        </button>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="dc-e2ee-notice is-warning" role="status">
        <Icon name="lock" size="sm" />
        <span>{t("dm.e2ee.notice.unavailable", { error: e2eeStateErrorText(state) })}</span>
        <button
          type="button"
          className="ds-btn ds-btn-sm"
          onClick={() => state.accountId && void dmE2ee.start(state.accountId)}
        >
          {t("dm.e2ee.notice.retry")}
        </button>
      </div>
    );
  }
  if (pin?.changed) {
    return (
      <div className="dc-e2ee-notice is-warning" role="status">
        <Icon name="shield" size="sm" />
        <span>{t("dm.e2ee.notice.codeChanged", { name: peer.username })}</span>
        <button type="button" className="ds-btn ds-btn-sm" onClick={() => setDialog({ kind: "safety", peer })}>
          {t("dm.e2ee.notice.verify")}
        </button>
        <button
          type="button"
          className="ds-btn ds-btn-sm ds-btn-ghost"
          onClick={() => void dmE2ee.acknowledgeKeyChange(peer.id)}
        >
          {t("dm.e2ee.notice.dismiss")}
        </button>
      </div>
    );
  }
  if (info && !info.encrypted) {
    return (
      <div className="dc-e2ee-notice" role="status">
        <Icon name="shield" size="sm" />
        <span>{t("dm.e2ee.notice.notYetEncrypted", { name: peer.username })}</span>
      </div>
    );
  }
  return null;
}

/** Marks where a conversation's history switches from unencrypted to encrypted. */
/** The lock in a group chat header, once the group is encrypted. */
export function GroupEncryptionBadge({ group }: { group: { e2ee?: boolean } }) {
  const { t } = useTranslation(["dm"]);
  const state = useDmE2ee();
  if (!state.available || !group.e2ee) return null;
  const label = state.status === "locked" ? t("dm.e2ee.groupBadge.locked") : t("dm.e2ee.groupBadge.ready");
  return (
    <button
      type="button"
      className="dc-dm-head-action dc-e2ee-badge is-encrypted"
      title={label}
      aria-label={label}
      onClick={() => {
        if (state.status === "locked") setDialog({ kind: "unlock" });
      }}
    >
      <Icon name="lock" />
    </button>
  );
}

/** What to show instead of an encrypted message this device can't read. */
export function unreadableMessageText(mark: "locked" | "failed", kind: "dm" | "group"): string {
  const t = dmT;
  if (mark === "failed") return t("dm.e2ee.unreadable.failed");
  if (dmE2ee.getState().status === "locked") {
    return t("dm.e2ee.unreadable.locked");
  }
  return kind === "group" ? t("dm.e2ee.unreadable.group") : t("dm.e2ee.unreadable.dm");
}

export function DmEncryptionDivider() {
  const { t } = useTranslation(["dm"]);
  return (
    <div className="dc-e2ee-divider" role="separator">
      <Icon name="lock" size="sm" />
      {t("dm.e2ee.divider")}
    </div>
  );
}

/** Settings → Privacy & encryption: this device's encryption status and key controls. */
export function DmEncryptionSettings() {
  const { t } = useTranslation(["settings"]);
  const state = useDmE2ee();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const historyLabel = (days: number | null): string =>
    days === null
      ? t("settings.encryption.history.always")
      : days === 365
        ? t("settings.encryption.history.year")
        : t("settings.encryption.history.days", { count: days });
  const status =
    state.status === "ready"
      ? t("settings.encryption.status.ready")
      : state.status === "locked"
        ? t("settings.encryption.status.locked")
        : state.status === "error"
          ? t("settings.encryption.status.error", { error: e2eeStateErrorText(state) })
          : t("settings.encryption.status.starting");
  return (
    <div className="dc-e2ee-settings">
      <p className="ds-text-muted">{t("settings.encryption.intro")}</p>
      <p>
        <strong>{t("settings.encryption.statusLabel")}</strong> {status}
      </p>
      {state.keyId && (
        <p className="ds-text-muted">
          {t("settings.encryption.keyId")} <code>{state.keyId}</code>
        </p>
      )}
      <div className="dc-e2ee-actions">
        {state.status === "locked" && (
          <button type="button" className="ds-btn ds-btn-primary" onClick={() => setDialog({ kind: "unlock" })}>
            {t("settings.encryption.unlock")}
          </button>
        )}
        {state.status === "ready" && (
          <button
            type="button"
            className="ds-btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await dmE2ee.replaceRecoveryCode();
              } catch (caught) {
                setError(errorText(caught, t("settings.encryption.newCodeFailed")));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("settings.encryption.newCode")}
          </button>
        )}
        {(state.status === "ready" || state.status === "locked") && (
          <button type="button" className="ds-btn ds-btn-danger" onClick={() => setDialog({ kind: "reset" })}>
            {t("settings.encryption.reset")}
          </button>
        )}
      </div>
      {state.status === "ready" && (
        <label className="dc-e2ee-history">
          <span>
            <strong>{t("settings.encryption.historyTitle")}</strong>
            <small className="ds-text-muted">{t("settings.encryption.historyHelp")}</small>
          </span>
          <select
            value={state.historyDays === null ? "always" : String(state.historyDays)}
            disabled={busy}
            onChange={async (event) => {
              const days = event.target.value === "always" ? null : Number(event.target.value);
              if (
                days !== null &&
                !window.confirm(t("settings.encryption.historyConfirm", { when: historyLabel(days) }))
              )
                return;
              setBusy(true);
              setError("");
              try {
                await dmE2ee.setHistoryDays(days);
              } catch (caught) {
                setError(errorText(caught, t("settings.encryption.historyFailed")));
              } finally {
                setBusy(false);
              }
            }}
          >
            {DM_HISTORY_CHOICES.map((days) => (
              <option key={String(days)} value={days === null ? "always" : String(days)}>
                {historyLabel(days)}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <p className="ds-notice danger">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- dialogs

function Modal({ title, onClose, children }: { title: string; onClose?: () => void; children: ReactNode }) {
  const { t } = useTranslation(["dm"]);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal dc-social-modal dc-e2ee-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ds-modal-head">
          <h2>{title}</h2>
          {onClose && (
            <button
              type="button"
              className="ds-btn ds-btn-ghost ds-icon-btn"
              aria-label={t("dm.e2ee.modal.close")}
              onClick={onClose}
            >
              <Icon name="close" />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

function RecoveryCodeDialog({ code }: { code: string }) {
  const { t } = useTranslation(["dm"]);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <Modal title={t("dm.e2ee.recovery.title")}>
      <p className="ds-text-muted">{t("dm.e2ee.recovery.intro")}</p>
      <div className="dc-e2ee-code" aria-label={t("dm.e2ee.recovery.codeLabel")}>
        {code}
      </div>
      <div className="dc-e2ee-actions">
        <button
          type="button"
          className="ds-btn"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(code)
              .then(() => setCopied(true))
              .catch(() => undefined);
          }}
        >
          <Icon name="copy" size="sm" /> {copied ? t("dm.e2ee.recovery.copied") : t("dm.e2ee.recovery.copy")}
        </button>
      </div>
      <label className="dc-e2ee-check">
        <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
        {t("dm.e2ee.recovery.savedConfirm")}
      </label>
      <div className="ds-modal-actions">
        <button
          type="button"
          className="ds-btn ds-btn-primary"
          disabled={!saved}
          onClick={() => dmE2ee.acknowledgeRecoveryCode()}
        >
          {t("dm.e2ee.recovery.done")}
        </button>
      </div>
    </Modal>
  );
}

function UnlockDialog() {
  const { t } = useTranslation(["dm"]);
  const state = useDmE2ee();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const link = state.link;
  const close = () => {
    if (link?.state === "waiting") dmE2ee.cancelLink();
    setDialog(null);
  };
  useEffect(() => {
    if (state.status === "ready") setDialog(null);
  }, [state.status]);
  return (
    <Modal title={t("dm.e2ee.unlock.title")} onClose={close}>
      <p className="ds-text-muted">{t("dm.e2ee.unlock.intro")}</p>
      <section className="dc-e2ee-section">
        <h3>{t("dm.e2ee.unlock.phoneHeading")}</h3>
        {!link && (
          <button
            type="button"
            className="ds-btn ds-btn-primary"
            disabled={busy}
            onClick={async () => {
              setError("");
              setBusy(true);
              try {
                await dmE2ee.requestLink();
              } catch (caught) {
                setError(errorText(caught, t("dm.e2ee.unlock.askFailed")));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("dm.e2ee.unlock.askDevices")}
          </button>
        )}
        {link?.state === "waiting" && (
          <>
            <p>{t("dm.e2ee.unlock.compareCode")}</p>
            <div className="dc-e2ee-code">{link.code}</div>
            <p className="ds-text-muted">{t("dm.e2ee.unlock.waiting")}</p>
          </>
        )}
        {link && link.state !== "waiting" && (
          <p className="ds-notice danger">
            {link.state === "denied"
              ? t("dm.e2ee.unlock.declined")
              : link.state === "expired"
                ? t("dm.e2ee.unlock.expired")
                : t("dm.e2ee.unlock.failed")}{" "}
            <button type="button" className="ds-btn ds-btn-sm" onClick={() => dmE2ee.cancelLink()}>
              {t("dm.e2ee.unlock.startOver")}
            </button>
          </p>
        )}
      </section>
      <section className="dc-e2ee-section">
        <h3>{t("dm.e2ee.unlock.codeHeading")}</h3>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            setBusy(true);
            try {
              await dmE2ee.unlockWithRecoveryCode(code);
            } catch (caught) {
              setError(errorText(caught, t("dm.e2ee.unlock.codeFailed")));
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            className="ds-input dc-e2ee-code-input"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder={RECOVERY_CODE_SHAPE}
            autoComplete="off"
            spellCheck={false}
            aria-label={t("dm.e2ee.unlock.codeLabel")}
          />
          <button type="submit" className="ds-btn" disabled={busy || code.trim().length < 32}>
            {t("dm.e2ee.unlock.submit")}
          </button>
        </form>
      </section>
      {error && <p className="ds-notice danger">{error}</p>}
      <p className="ds-text-muted dc-e2ee-footnote">
        {t("dm.e2ee.unlock.lostEverything")}{" "}
        <button type="button" className="dc-e2ee-link" onClick={() => setDialog({ kind: "reset" })}>
          {t("dm.e2ee.unlock.resetLink")}
        </button>
      </p>
    </Modal>
  );
}

function ResetDialog() {
  const { t } = useTranslation(["dm"]);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title={t("dm.e2ee.reset.title")} onClose={() => setDialog(null)}>
      <p className="ds-text-muted">{t("dm.e2ee.reset.intro")}</p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await dmE2ee.resetKey(password);
            setDialog(null);
          } catch (caught) {
            setError(errorText(caught, t("dm.e2ee.reset.failed")));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="ds-field">
          {t("dm.e2ee.reset.password")}
          <input
            className="ds-input"
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && <p className="ds-notice danger">{error}</p>}
        <div className="ds-modal-actions">
          <button type="button" className="ds-btn" onClick={() => setDialog(null)}>
            {t("dm.e2ee.reset.cancel")}
          </button>
          <button type="submit" className="ds-btn ds-btn-danger" disabled={busy || !password}>
            {t("dm.e2ee.reset.submit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SafetyNumberDialog({ peer }: { peer: Peer }) {
  const { t } = useTranslation(["dm"]);
  const { state, info, pin } = useConversationInfo(peer.id);
  return (
    <Modal title={t("dm.e2ee.safety.title")} onClose={() => setDialog(null)}>
      {info?.encrypted && info.safetyNumber ? (
        <>
          <p className="ds-text-muted">{t("dm.e2ee.safety.intro", { name: peer.username })}</p>
          <div
            className="dc-e2ee-code dc-e2ee-safety"
            aria-label={t("dm.e2ee.safety.codeLabel", { code: info.safetyNumber })}
          >
            {info.safetyNumber.split(" ").map((group, index) => (
              <span key={index}>{group}</span>
            ))}
          </div>
          <div className="ds-modal-actions">
            <button type="button" className="ds-btn" onClick={() => setDialog(null)}>
              {t("dm.e2ee.safety.close")}
            </button>
            {!pin?.verified && (
              <button
                type="button"
                className="ds-btn ds-btn-primary"
                onClick={() => {
                  void dmE2ee.acknowledgeKeyChange(peer.id, true);
                  setDialog(null);
                }}
              >
                {t("dm.e2ee.safety.markVerified")}
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="ds-text-muted">
          {state.status === "ready"
            ? t("dm.e2ee.safety.peerNotSetUp", { name: peer.username })
            : t("dm.e2ee.safety.unlockToSee")}
        </p>
      )}
    </Modal>
  );
}

function ApproveDeviceDialog() {
  const { t } = useTranslation(["dm"]);
  const state = useDmE2ee();
  const approval = state.approvals[0];
  const [error, setError] = useState("");
  if (!approval) return null;
  const answer = async (approve: boolean) => {
    setError("");
    try {
      await dmE2ee.answerApproval(approval.id, approve);
    } catch (caught) {
      setError(errorText(caught, t("dm.e2ee.approve.failed")));
    }
  };
  return (
    <Modal title={t("dm.e2ee.approve.title")} onClose={() => void answer(false)}>
      <p className="ds-text-muted">
        <Trans
          t={t}
          i18nKey="dm.e2ee.approve.intro"
          values={{ device: deviceName(approval.deviceLabel, approval.device) }}
          components={{ strong: <strong /> }}
        />
      </p>
      <div className="dc-e2ee-code">{approval.code}</div>
      {error && <p className="ds-notice danger">{error}</p>}
      <div className="ds-modal-actions">
        <button type="button" className="ds-btn" onClick={() => void answer(false)}>
          {t("dm.e2ee.approve.decline")}
        </button>
        <button type="button" className="ds-btn ds-btn-primary" onClick={() => void answer(true)}>
          {t("dm.e2ee.approve.approve")}
        </button>
      </div>
    </Modal>
  );
}

/** Mounted once by the app shell. */
export function DmEncryptionDialogs() {
  const state = useDmE2ee();
  const open = useDialog();
  if (state.pendingRecoveryCode) return <RecoveryCodeDialog code={state.pendingRecoveryCode} />;
  if (open?.kind === "reset") return <ResetDialog />;
  if (open?.kind === "unlock") return <UnlockDialog />;
  if (open?.kind === "safety") return <SafetyNumberDialog peer={open.peer} />;
  if (state.status === "ready" && state.approvals.length) return <ApproveDeviceDialog />;
  return null;
}

/** A small lock next to a voice participant whose connection was checked against their key. */
export function CallVerificationMark({ connectionId }: { connectionId: string }) {
  const { t } = useTranslation(["dm"]);
  const verdict = useCallVerdict(connectionId);
  if (!verdict || verdict === "unverified") return null;
  const label = verdict === "verified" ? t("dm.e2ee.call.verified") : t("dm.e2ee.call.failed");
  return (
    <span className={`dc-e2ee-call-mark is-${verdict}`} title={label} aria-label={label} role="img">
      <Icon name={verdict === "verified" ? "lock" : "shield"} size="sm" />
    </span>
  );
}
