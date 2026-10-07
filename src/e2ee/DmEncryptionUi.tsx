// What people see of DM encryption: the lock in a conversation or group header,
// the notice above a conversation, the settings (including how long old
// messages stay readable), and the dialogs for the recovery code, unlocking this
// device, approving a new device, safety numbers and resetting the key.

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { DM_HISTORY_CHOICES } from "../../shared/dm-e2ee-session";
import { dmE2ee, useDmE2ee } from "./dm-e2ee-client";
import { useCallVerdict } from "./call-verification";
import "./dm-encryption.css";

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

export const openDmUnlockDialog = () => setDialog({ kind: "unlock" });

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
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
  const { state, info, pin } = useConversationInfo(peer.id);
  if (!info) return null;
  const encrypted = info.encrypted;
  const label = encrypted ? (pin?.verified ? "Encrypted · verified" : "End-to-end encrypted") : "Not encrypted";
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
  const { state, info, pin } = useConversationInfo(peer.id);
  if (state.status === "locked") {
    return (
      <div className="dc-e2ee-notice is-warning" role="status">
        <Icon name="lock" size="sm" />
        <span>Your encrypted messages are locked on this device.</span>
        <button type="button" className="ds-btn ds-btn-sm ds-btn-primary" onClick={() => setDialog({ kind: "unlock" })}>
          Unlock
        </button>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="dc-e2ee-notice is-warning" role="status">
        <Icon name="lock" size="sm" />
        <span>Encryption isn't available right now: {state.error}</span>
        <button
          type="button"
          className="ds-btn ds-btn-sm"
          onClick={() => state.accountId && void dmE2ee.start(state.accountId)}
        >
          Retry
        </button>
      </div>
    );
  }
  if (pin?.changed) {
    return (
      <div className="dc-e2ee-notice is-warning" role="status">
        <Icon name="shield" size="sm" />
        <span>
          {peer.username}'s security code changed. This happens when they reset their encryption key; check with them if
          you didn't expect it.
        </span>
        <button type="button" className="ds-btn ds-btn-sm" onClick={() => setDialog({ kind: "safety", peer })}>
          Verify
        </button>
        <button
          type="button"
          className="ds-btn ds-btn-sm ds-btn-ghost"
          onClick={() => void dmE2ee.acknowledgeKeyChange(peer.id)}
        >
          Dismiss
        </button>
      </div>
    );
  }
  if (info && !info.encrypted) {
    return (
      <div className="dc-e2ee-notice" role="status">
        <Icon name="shield" size="sm" />
        <span>
          Messages with {peer.username} aren't end-to-end encrypted yet. They will be once {peer.username} opens an
          up-to-date DeCave.
        </span>
      </div>
    );
  }
  return null;
}

/** Marks where a conversation's history switches from unencrypted to encrypted. */
/** The lock in a group chat header, once the group is encrypted. */
export function GroupEncryptionBadge({ group }: { group: { e2ee?: boolean } }) {
  const state = useDmE2ee();
  if (!state.available || !group.e2ee) return null;
  const label =
    state.status === "locked"
      ? "End-to-end encrypted. Unlock encrypted messages on this device to read them."
      : "End-to-end encrypted: only members can read messages sent while they're in the group.";
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
  if (mark === "failed") return "This message couldn't be decrypted.";
  if (dmE2ee.getState().status === "locked") {
    return "Encrypted message. Unlock encrypted messages on this device to read it.";
  }
  return kind === "group"
    ? "Encrypted message you can't read: it was sent before you joined, or is older than your account keeps."
    : "Encrypted message older than your account keeps (see Privacy settings).";
}

function historyLabel(days: number | null): string {
  if (days === null) return "Always";
  return days === 365 ? "1 year" : `${days} days`;
}

export function DmEncryptionDivider() {
  return (
    <div className="dc-e2ee-divider" role="separator">
      <Icon name="lock" size="sm" />
      Messages below are end-to-end encrypted. Earlier messages were sent before encryption and are stored readable.
    </div>
  );
}

/** Settings → Privacy: this device's encryption status and key controls. */
export function DmEncryptionSettings() {
  const state = useDmE2ee();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const status =
    state.status === "ready"
      ? "This device can read and send end-to-end encrypted messages."
      : state.status === "locked"
        ? "Locked: approve this device from another one, or enter your recovery code."
        : state.status === "error"
          ? `Unavailable: ${state.error}`
          : "Starting…";
  return (
    <div className="dc-e2ee-settings">
      <p className="ds-text-muted">
        Direct messages and group chats are end-to-end encrypted once everyone in them uses an up-to-date DeCave: only
        the people in the conversation can read them, not DeCave. Your devices share one key, which changes every month.
        Keep your recovery code somewhere safe: without it or another signed-in device, encrypted history can't be
        recovered.
      </p>
      <p>
        <strong>Status:</strong> {status}
      </p>
      {state.keyId && (
        <p className="ds-text-muted">
          Key ID: <code>{state.keyId}</code>
        </p>
      )}
      <div className="dc-e2ee-actions">
        {state.status === "locked" && (
          <button type="button" className="ds-btn ds-btn-primary" onClick={() => setDialog({ kind: "unlock" })}>
            Unlock on this device
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
                setError(errorText(caught, "Could not create a new recovery code."));
              } finally {
                setBusy(false);
              }
            }}
          >
            Create a new recovery code
          </button>
        )}
        {(state.status === "ready" || state.status === "locked") && (
          <button type="button" className="ds-btn ds-btn-danger" onClick={() => setDialog({ kind: "reset" })}>
            Reset encryption key
          </button>
        )}
      </div>
      {state.status === "ready" && (
        <label className="dc-e2ee-history">
          <span>
            <strong>Keep old encrypted messages readable</strong>
            <small className="ds-text-muted">
              Shorter means a stolen device or recovery code can read less of your past. Older encrypted messages become
              unreadable on all your devices. The other person's devices follow their own setting.
            </small>
          </span>
          <select
            value={state.historyDays === null ? "always" : String(state.historyDays)}
            disabled={busy}
            onChange={async (event) => {
              const days = event.target.value === "always" ? null : Number(event.target.value);
              if (
                days !== null &&
                !window.confirm(
                  `Encrypted messages older than ${historyLabel(days)} will become unreadable on all your devices. This can't be undone. Continue?`,
                )
              )
                return;
              setBusy(true);
              setError("");
              try {
                await dmE2ee.setHistoryDays(days);
              } catch (caught) {
                setError(errorText(caught, "Could not save the setting."));
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
            <button type="button" className="ds-btn ds-btn-ghost ds-icon-btn" aria-label="Close" onClick={onClose}>
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
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <Modal title="Save your recovery code">
      <p className="ds-text-muted">
        Your direct messages are now end-to-end encrypted. This code is the only way to read them on a new device when
        none of your other devices is around. DeCave can't show it again or recover it for you.
      </p>
      <div className="dc-e2ee-code" aria-label="Recovery code">
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
          <Icon name="copy" size="sm" /> {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <label className="dc-e2ee-check">
        <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />I saved it
        somewhere safe, like a password manager.
      </label>
      <div className="ds-modal-actions">
        <button
          type="button"
          className="ds-btn ds-btn-primary"
          disabled={!saved}
          onClick={() => dmE2ee.acknowledgeRecoveryCode()}
        >
          Done
        </button>
      </div>
    </Modal>
  );
}

function UnlockDialog() {
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
    <Modal title="Unlock encrypted messages" onClose={close}>
      <p className="ds-text-muted">
        This device doesn't have your encryption key yet. Approve it from the DeCave app on your phone (or another
        device that's signed in right now), or use your recovery code.
      </p>
      <section className="dc-e2ee-section">
        <h3>Use your phone</h3>
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
                setError(errorText(caught, "Could not ask your other devices."));
              } finally {
                setBusy(false);
              }
            }}
          >
            Ask my signed-in devices
          </button>
        )}
        {link?.state === "waiting" && (
          <>
            <p>Approve this on your other device and check that it shows the same code:</p>
            <div className="dc-e2ee-code">{link.code}</div>
            <p className="ds-text-muted">Waiting for approval…</p>
          </>
        )}
        {link && link.state !== "waiting" && (
          <p className="ds-notice danger">
            {link.state === "denied"
              ? "The request was declined."
              : link.state === "expired"
                ? "The request expired."
                : "Something went wrong. Try again."}{" "}
            <button type="button" className="ds-btn ds-btn-sm" onClick={() => dmE2ee.cancelLink()}>
              Start over
            </button>
          </p>
        )}
      </section>
      <section className="dc-e2ee-section">
        <h3>Use your recovery code</h3>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            setBusy(true);
            try {
              await dmE2ee.unlockWithRecoveryCode(code);
            } catch (caught) {
              setError(errorText(caught, "That recovery code didn't work."));
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            className="ds-input dc-e2ee-code-input"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
            autoComplete="off"
            spellCheck={false}
            aria-label="Recovery code"
          />
          <button type="submit" className="ds-btn" disabled={busy || code.trim().length < 32}>
            Unlock
          </button>
        </form>
      </section>
      {error && <p className="ds-notice danger">{error}</p>}
      <p className="ds-text-muted dc-e2ee-footnote">
        Lost every device and your code?{" "}
        <button type="button" className="dc-e2ee-link" onClick={() => setDialog({ kind: "reset" })}>
          Reset your encryption key
        </button>
      </p>
    </Modal>
  );
}

function ResetDialog() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title="Reset encryption key?" onClose={() => setDialog(null)}>
      <p className="ds-text-muted">
        A new key replaces the old one. Encrypted messages sent before now can no longer be read on any device, your
        other devices will need to be unlocked again, and the people you talk to will see that your security code
        changed.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await dmE2ee.resetKey(password);
            setDialog(null);
          } catch (caught) {
            setError(errorText(caught, "Could not reset your key."));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="ds-field">
          Current password
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
            Cancel
          </button>
          <button type="submit" className="ds-btn ds-btn-danger" disabled={busy || !password}>
            Reset key
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SafetyNumberDialog({ peer }: { peer: Peer }) {
  const { state, info, pin } = useConversationInfo(peer.id);
  return (
    <Modal title="End-to-end encryption" onClose={() => setDialog(null)}>
      {info?.encrypted && info.safetyNumber ? (
        <>
          <p className="ds-text-muted">
            Messages with {peer.username} are end-to-end encrypted. To be sure nobody is in the middle, compare this
            security code with the one {peer.username} sees, in person or on a call.
          </p>
          <div className="dc-e2ee-code dc-e2ee-safety" aria-label={`Security code ${info.safetyNumber}`}>
            {info.safetyNumber.split(" ").map((group, index) => (
              <span key={index}>{group}</span>
            ))}
          </div>
          <div className="ds-modal-actions">
            <button type="button" className="ds-btn" onClick={() => setDialog(null)}>
              Close
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
                Mark as verified
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="ds-text-muted">
          {state.status === "ready"
            ? `${peer.username} hasn't set up encryption yet, so messages with them are stored readable by DeCave.`
            : "Unlock encrypted messages on this device to see the security code."}
        </p>
      )}
    </Modal>
  );
}

function ApproveDeviceDialog() {
  const state = useDmE2ee();
  const approval = state.approvals[0];
  const [error, setError] = useState("");
  if (!approval) return null;
  const answer = async (approve: boolean) => {
    setError("");
    try {
      await dmE2ee.answerApproval(approval.id, approve);
    } catch (caught) {
      setError(errorText(caught, "Could not answer the request."));
    }
  };
  return (
    <Modal title="Approve a new device?" onClose={() => void answer(false)}>
      <p className="ds-text-muted">
        <strong>{approval.deviceLabel}</strong> wants to read your encrypted messages. Only approve it if you just
        signed in there and it shows this code:
      </p>
      <div className="dc-e2ee-code">{approval.code}</div>
      {error && <p className="ds-notice danger">{error}</p>}
      <div className="ds-modal-actions">
        <button type="button" className="ds-btn" onClick={() => void answer(false)}>
          Decline
        </button>
        <button type="button" className="ds-btn ds-btn-primary" onClick={() => void answer(true)}>
          Approve
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
  const verdict = useCallVerdict(connectionId);
  if (!verdict || verdict === "unverified") return null;
  const label =
    verdict === "verified"
      ? "End-to-end encrypted: this connection is verified with their account key."
      : "This connection failed its encryption check and was not connected.";
  return (
    <span className={`dc-e2ee-call-mark is-${verdict}`} title={label} aria-label={label} role="img">
      <Icon name={verdict === "verified" ? "lock" : "shield"} size="sm" />
    </span>
  );
}
