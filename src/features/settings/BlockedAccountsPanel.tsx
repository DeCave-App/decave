import { useEffect, useState } from "react";
import { useSettingsT } from "./useSettingsT";

type Block = { userId: string; username: string; createdAt: string };

type Props = {
  apiBase: string;
  /** Called after an unblock so the rest of the app drops the user from its block list. */
  onUnblocked: (userId: string) => void;
  formatDate: (iso: string) => string;
};

/** Settings → Privacy: everyone you have blocked, with Unblock. */
export function BlockedAccountsPanel({ apiBase, onUnblocked, formatDate }: Props) {
  const { t } = useSettingsT();
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${apiBase}/api/safety/blocks`, { credentials: "include" });
        const data = (await response.json().catch(() => ({}))) as { blocks?: Block[] };
        if (!cancelled) setBlocks(response.ok ? (data.blocks ?? []) : []);
        if (!cancelled && !response.ok) setError(t("settings.blocked.loadFailed"));
      } catch {
        if (!cancelled) {
          setBlocks([]);
          setError(t("settings.blocked.loadFailed"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const unblock = async (block: Block) => {
    setBusyId(block.userId);
    setError("");
    try {
      const response = await fetch(`${apiBase}/api/safety/blocks/${encodeURIComponent(block.userId)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error();
      setBlocks((current) => (current ?? []).filter((item) => item.userId !== block.userId));
      onUnblocked(block.userId);
    } catch {
      setError(t("settings.blocked.unblockFailed", { name: block.username }));
    } finally {
      setBusyId("");
    }
  };

  const q = query.trim().toLowerCase();
  const visible = (blocks ?? []).filter((block) => !q || block.username.toLowerCase().includes(q));

  return (
    <div className="dcs-card">
      <div className="dcs-card-row">
        <div className="dcs-card-copy">
          <strong>
            {blocks && blocks.length
              ? t("settings.blocked.titleCount", { count: blocks.length })
              : t("settings.blocked.title")}
          </strong>
          <small>{t("settings.blocked.help")}</small>
        </div>
      </div>
      {blocks === null && <p className="dcs-muted">{t("settings.blocked.loading")}</p>}
      {blocks && blocks.length === 0 && !error && <p className="dcs-muted">{t("settings.blocked.none")}</p>}
      {blocks && blocks.length > 6 && (
        <input
          className="dcx-input dcs-list-filter"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("settings.blocked.find")}
          aria-label={t("settings.blocked.find")}
        />
      )}
      {visible.length > 0 && (
        <ul className="dcs-list">
          {visible.map((block) => (
            <li key={block.userId} className="dcs-list-row">
              <span className="dcs-initial" aria-hidden="true">
                {block.username.charAt(0).toUpperCase()}
              </span>
              <span className="dcs-list-copy">
                <strong>{block.username}</strong>
                <small>{t("settings.blocked.blockedOn", { date: formatDate(block.createdAt) })}</small>
              </span>
              <button
                type="button"
                className="modal-secondary"
                disabled={busyId === block.userId}
                onClick={() => void unblock(block)}
              >
                {busyId === block.userId ? t("settings.blocked.unblocking") : t("settings.blocked.unblock")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="dcs-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
