import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../../components/Icon";
import { apiErrorMessage, type ApiErrorBody } from "../../i18n/apiError";
import "./pins.css";
import { pinPreview, type PinLabel } from "./pinPreview";

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
  const { t } = useTranslation(["hub"]);
  const pinLabel: PinLabel = (kind, detail) =>
    detail === undefined ? t(`hub.pins.kinds.${kind}`) : t(`hub.pins.kindsWithDetail.${kind}`, { detail });
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
        const data = (await response.json().catch(() => ({}))) as { pins?: PinnedMessage[] } & ApiErrorBody;
        if (cancelled) return;
        if (!response.ok) {
          throw new Error(data.code || data.error ? apiErrorMessage(data, "common.unknown") : t("hub.pins.loadFailed"));
        }
        setPins(Array.isArray(data.pins) ? data.pins : []);
      } catch (err) {
        if (!cancelled) {
          setPins([]);
          setError(err instanceof Error ? err.message : t("hub.pins.loadFailed"));
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
            <span className="ds-kicker">
              {pins && pins.length ? t("hub.pins.titleWithCount", { n: pins.length }) : t("hub.pins.title")}
            </span>
            <h2 id="pins-title">#{roomName}</h2>
          </div>
          <div className="ds-page-header-actions">
            <button
              type="button"
              className="ds-btn ds-btn-ghost ds-icon-btn"
              aria-label={t("hub.pins.close")}
              title={t("hub.pins.close")}
              onClick={onClose}
            >
              <Icon name="close" />
            </button>
          </div>
        </header>
        <div className="pinned-message-list ds-list">
          {pins === null && <p className="pins-status">{t("hub.pins.loading")}</p>}
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
              <h3>{t("hub.pins.empty")}</h3>
              <p>{canUnpin ? t("hub.pins.emptyCanPin") : t("hub.pins.emptyMember")}</p>
            </div>
          )}
          {pins?.map((message) => (
            <article key={message.id} className="ds-row ds-row-boxed pinned-message-card pins-card">
              <span className="pins-avatar">{renderAvatar(message)}</span>
              <div className="ds-row-copy">
                <strong className="ds-row-title">
                  {message.username} <small className="ds-row-meta">{formatTime(message.timestamp)}</small>
                </strong>
                <span className="ds-row-sub pins-text">{pinPreview(message, expanded === message.id, pinLabel)}</span>
              </div>
              <div className="pins-actions">
                {loadedIds.has(message.id) ? (
                  <button
                    type="button"
                    className="ds-btn ds-btn-sm"
                    onClick={() => onJump(message.id)}
                    title={t("hub.pins.jumpTitle")}
                  >
                    {t("hub.pins.jump")}
                  </button>
                ) : (
                  message.text.length > 280 && (
                    <button
                      type="button"
                      className="ds-btn ds-btn-sm"
                      aria-expanded={expanded === message.id}
                      onClick={() => setExpanded(expanded === message.id ? "" : message.id)}
                    >
                      {expanded === message.id ? t("hub.pins.less") : t("hub.pins.readAll")}
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
                    {busy === message.id ? t("hub.pins.unpinning") : t("hub.pins.unpin")}
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
