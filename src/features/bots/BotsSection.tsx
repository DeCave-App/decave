// Hub settings → Bots: builder bots and token bots in one list, New bot, and
// the bot page. When the server has no bot builder (404), the token-bot panel
// shows unchanged.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import HubBotsPanel from "../../components/HubBotsPanel";
import { BotApiError, createBotsApi, type AuthorizedFetch, type BuilderBot, type BuilderOverview } from "./api";
import { BotPage } from "./BotPage";
import type { BotHub } from "./model.ts";
import { NewBotDialog, type Created } from "./NewBotDialog";
import "./bots.css";

type Room = { id: number; name: string; type: "text" | "voice" | "forum" };

type Props = {
  hubId: number;
  apiBaseUrl: string;
  authorizedFetch: AuthorizedFetch;
  rooms: readonly Room[];
  roles: readonly { id: string; name: string }[];
  /** Shown instead when the bot builder is off on this server. */
  fallback: ReactNode;
  /** Owners and admins also manage token bots here. */
  showTokenBots: boolean;
};

export function BotsSection({ hubId, apiBaseUrl, authorizedFetch, rooms, roles, fallback, showTokenBots }: Props) {
  const api = useMemo(() => createBotsApi(apiBaseUrl, authorizedFetch, hubId), [apiBaseUrl, authorizedFetch, hubId]);
  const [overview, setOverview] = useState<BuilderOverview | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "off" | "error">("loading");
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [opened, setOpened] = useState<Omit<Created, "bot"> | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState("");

  const hub: BotHub = useMemo(
    () => ({
      textRooms: rooms.filter((r) => r.type === "text").map((r) => ({ id: String(r.id), name: r.name })),
      voiceRooms: rooms.filter((r) => r.type === "voice").map((r) => ({ id: String(r.id), name: r.name })),
      roles: roles.map((r) => ({ id: r.id, name: r.name })),
    }),
    [rooms, roles],
  );

  const load = useCallback(async () => {
    try {
      setOverview(await api.overview());
      setState("ready");
    } catch (caught) {
      if (caught instanceof BotApiError && caught.status === 404) return setState("off");
      setError(caught instanceof Error ? caught.message : "Could not load bots.");
      setState((s) => (s === "ready" ? s : "error"));
    }
  }, [api]);

  useEffect(() => {
    setState("loading");
    setOpenId(null);
    void load();
  }, [load]);

  const replaceBot = (bot: BuilderBot) =>
    setOverview((o) => (o ? { ...o, bots: o.bots.map((b) => (b.id === bot.id ? bot : b)) } : o));
  const setAiRemaining = (remaining: number) => setOverview((o) => (o ? { ...o, aiRemainingToday: remaining } : o));

  if (state === "off") return <>{fallback}</>;
  if (state === "loading") return <p className="dcx-hint">Loading bots…</p>;
  if (state === "error" || !overview)
    return (
      <p className="dcx-notice dcx-notice-error">
        {error}{" "}
        <button type="button" className="dcx-btn dcx-btn-sm" onClick={() => void load()}>
          Retry
        </button>
      </p>
    );

  const ai = { available: overview.aiAvailable, remaining: overview.aiRemainingToday };
  const builderBots = overview.bots.filter((b) => b.kind === "builder");
  const open = builderBots.find((b) => b.id === openId);

  if (open)
    return (
      <BotPage
        key={open.id}
        api={api}
        bot={open}
        hub={hub}
        ai={ai}
        onAiRemaining={setAiRemaining}
        generated={opened?.generated}
        notice={opened?.notice}
        onBack={() => {
          setOpenId(null);
          setOpened(null);
          void load();
        }}
        onReload={() => void load()}
        onBotChanged={replaceBot}
        onDeleted={() => {
          setOpenId(null);
          setOpened(null);
          void load();
        }}
      />
    );

  const toggle = async (bot: BuilderBot) => {
    setBusy(bot.id);
    setError("");
    try {
      replaceBot(await api.update(bot.id, { enabled: !bot.enabled }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the bot.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="bb-section">
      <header className="bb-section-head">
        <div>
          <h3>Bots</h3>
          <p className="dcx-hint">Bots answer commands, greet members, hand out roles and more. No code needed.</p>
        </div>
        <button type="button" className="dcx-btn dcx-btn-primary" onClick={() => setCreating(true)}>
          New bot
        </button>
      </header>
      {error && <p className="dcx-notice dcx-notice-error">{error}</p>}

      {builderBots.length === 0 ? (
        <button type="button" className="bb-empty bb-empty-cta" onClick={() => setCreating(true)}>
          <strong>No bots yet</strong>
          <span>Start from a template such as Welcome or Dice. It takes a minute.</span>
        </button>
      ) : (
        <ul className="bb-bot-list">
          {builderBots.map((bot) => (
            <li key={bot.id} className={`bb-bot-card${bot.enabled ? "" : " off"}`}>
              <button type="button" className="bb-bot-open" onClick={() => setOpenId(bot.id)}>
                <span className="bb-avatar" style={{ background: bot.color ?? undefined }} aria-hidden="true">
                  {bot.avatarEmoji || "🤖"}
                </span>
                <span className="bb-bot-copy">
                  <strong>{bot.name}</strong>
                  <small>
                    {bot.rules.length} rule{bot.rules.length === 1 ? "" : "s"}
                    {bot.description ? ` · ${bot.description}` : ""}
                  </small>
                  {bot.pausedReason === "errors" && (
                    <small className="bb-error">Paused after repeated errors — check Activity</small>
                  )}
                </span>
                <span className={`bb-status ${!bot.enabled ? "off" : bot.hasUnpublishedChanges ? "pending" : "saved"}`}>
                  {!bot.enabled ? "Off" : bot.hasUnpublishedChanges ? "Unpublished changes" : "Live"}
                </span>
              </button>
              <label className="dcx-switch" title={bot.enabled ? "Turn off" : "Turn on"}>
                <input
                  type="checkbox"
                  aria-label={`${bot.name} is on`}
                  checked={bot.enabled}
                  disabled={busy === bot.id}
                  onChange={() => void toggle(bot)}
                />
                <span aria-hidden="true" />
              </label>
            </li>
          ))}
        </ul>
      )}

      {showTokenBots && (
        <details className="bb-token-bots" open={overview.bots.some((b) => b.kind === "token")}>
          <summary>Token bots (for developers)</summary>
          <HubBotsPanel hubId={hubId} rooms={[...rooms]} apiBaseUrl={apiBaseUrl} authorizedFetch={authorizedFetch} />
        </details>
      )}

      {creating && (
        <NewBotDialog
          api={api}
          templates={overview.templates}
          ai={ai}
          onAiRemaining={setAiRemaining}
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            setOverview((o) => (o ? { ...o, bots: [created.bot, ...o.bots] } : o));
            setOpened({ generated: created.generated, notice: created.notice });
            setOpenId(created.bot.id);
          }}
        />
      )}
    </div>
  );
}
