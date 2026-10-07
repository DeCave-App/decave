import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "../../components/Icon";
import "./pins.css";
import { pinPreview } from "./pinPreview";

export { pinPreview };

export type PinnedMessage = {
  id: string;
  username: string;
  avatarUrl?: string | null;
  text: string;
  timestamp: string;
  channelId: number;
  attachment?: { name: string; mimeType: string } | null;
};

type Props = {
  apiBase: string;
  roomId: number;
  roomName: string;
  canUnpin: boolean;
  /** Ids of messages currently loaded in the room, so "Jump" can scroll to them. */
  loadedIds: ReadonlySet<string>;
  renderAvatar: (message: PinnedMessage) => ReactNode;
  formatTime: (iso: string) => string;
  onJump: (messageId: string) => void;
  onUnpin: (message: PinnedMessage) => Promise<void> | void;
  onClose: () => void;
};

/** Every pinned message in a room, loaded from the server (not only the ones on screen). */
export function PinnedMessagesPanel({
  apiBase,
  roomId,
  roomName,
  canUnpin,
  loadedIds,
  renderAvatar,
  formatTime,
  onJump,
  onUnpin,
  onClose,
}: Props) {
  const [pins, setPins] = useState<PinnedMessage[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [expanded, setExpanded] = useState("");

  useEffect(() => {
    let cancelled = false;
    setPins(null);
    setError("");
    void (async () => {
      try {
        const response = await fetch(`${apiBase}/api/channels/${roomId}/pins`, {
          credentials: "include",
          cache: "no-store",
        });
        const data = (await response.json().catch(() => ({}))) as { pins?: PinnedMessage[]; error?: string };
        if (cancelled) return;
        if (!response.ok) throw new Error(data.error || "Could not load pinned messages.");
        setPins(Array.isArray(data.pins) ? data.pins : []);
      } catch (err) {
        if (!cancelled) {
          setPins([]);
          setError(err instanceof Error ? err.message : "Could not load pinned messages.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, roomId]);

  const unpin = async (message: PinnedMessage) => {
    setBusy(message.id);
    try {
      await onUnpin(message);
      setPins((current) => (current ?? []).filter((item) => item.id !== message.id));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal pinned-messages-modal pins-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pins-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ds-page-header">
          <div className="ds-page-header-copy">
            <span className="ds-kicker">Pinned messages{pins && pins.length ? ` · ${pins.length}` : ""}</span>
            <h2 id="pins-title">#{roomName}</h2>
          </div>
          <div className="ds-page-header-actions">
            <button
              type="button"
              className="ds-btn ds-btn-ghost ds-icon-btn"
              aria-label="Close"
              title="Close"
              onClick={onClose}
            >
              <Icon name="close" />
            </button>
          </div>
        </header>
        <div className="pinned-message-list ds-list">
          {pins === null && <p className="pins-status">Loading…</p>}
          {error && (
            <p className="pins-status pins-error" role="alert">
              {error}
            </p>
          )}
          {pins && pins.length === 0 && !error && (
            <div className="ds-empty">
              <span className="ds-empty-icon">
                <Icon name="pin" />
              </span>
              <h3>No pinned messages yet</h3>
              <p>
                {canUnpin
                  ? "Pin an important message from its menu so everyone can find it here."
                  : "Admins can pin important messages so everyone can find them here."}
              </p>
            </div>
          )}
          {pins?.map((message) => (
            <article key={message.id} className="ds-row ds-row-boxed pinned-message-card pins-card">
              <span className="pins-avatar">{renderAvatar(message)}</span>
              <div className="ds-row-copy">
                <strong className="ds-row-title">
                  {message.username} <small className="ds-row-meta">{formatTime(message.timestamp)}</small>
                </strong>
                <span className="ds-row-sub pins-text">{pinPreview(message, expanded === message.id)}</span>
              </div>
              <div className="pins-actions">
                {loadedIds.has(message.id) ? (
                  <button
                    type="button"
                    className="ds-btn ds-btn-sm"
                    onClick={() => onJump(message.id)}
                    title="Show this message in the room"
                  >
                    Jump
                  </button>
                ) : (
                  message.text.length > 280 && (
                    <button
                      type="button"
                      className="ds-btn ds-btn-sm"
                      aria-expanded={expanded === message.id}
                      onClick={() => setExpanded(expanded === message.id ? "" : message.id)}
                    >
                      {expanded === message.id ? "Less" : "Read all"}
                    </button>
                  )
                )}
                {canUnpin && (
                  <button
                    type="button"
                    className="ds-btn ds-btn-sm ds-btn-ghost"
                    disabled={busy === message.id}
                    onClick={() => void unpin(message)}
                  >
                    {busy === message.id ? "Unpinning…" : "Unpin"}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
