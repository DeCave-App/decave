import { useEffect, useMemo, useState } from "react";
import { Icon } from "./Icon";

type Channel = {
  id: number;
  name: string;
  type: "text" | "voice" | "forum";
};

export type BotCapability = "send_messages" | "create_polls" | "create_events";

type BotView = {
  id: string;
  hubId: number;
  name: string;
  description: string;
  enabled: boolean;
  createdAt?: string;
  capabilities: BotCapability[];
  allowedRoomIds: number[];
};

type Props = {
  hubId: number;
  rooms: Channel[];
  apiBaseUrl: string;
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>;
};

const CAPABILITY_DEFINITIONS: Array<{
  id: BotCapability;
  label: string;
  description: string;
}> = [
  {
    id: "send_messages",
    label: "Send messages",
    description: "Post normal bot messages to the rooms you enable.",
  },
  {
    id: "create_polls",
    label: "Create polls",
    description: "Publish structured polls when your integration asks for one.",
  },
  {
    id: "create_events",
    label: "Create events",
    description: "Publish Hub events that appear in the Hub Calendar.",
  },
];

const DEFAULT_CAPABILITIES: BotCapability[] = ["send_messages"];

function isCapability(value: unknown): value is BotCapability {
  return value === "send_messages" || value === "create_polls" || value === "create_events";
}

function normalizedCapabilities(value: unknown): BotCapability[] {
  if (!Array.isArray(value)) return [...DEFAULT_CAPABILITIES];
  return Array.from(new Set(value.filter(isCapability)));
}

function normalizedRoomIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is number => Number.isSafeInteger(item) && item > 0)));
}

function normalizeBot(value: unknown): BotView | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.name !== "string") return null;
  return {
    id: item.id,
    hubId: typeof item.hubId === "number" ? item.hubId : 0,
    name: item.name,
    description: typeof item.description === "string" ? item.description : "",
    enabled: item.enabled === true,
    createdAt: typeof item.createdAt === "string" ? item.createdAt : undefined,
    capabilities: normalizedCapabilities(item.capabilities),
    allowedRoomIds: normalizedRoomIds(item.allowedRoomIds),
  };
}

function responseError(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && typeof (value as Record<string, unknown>).error === "string") {
    return String((value as Record<string, unknown>).error);
  }
  return fallback;
}

export default function HubBotsPanel({ hubId, rooms, apiBaseUrl, authorizedFetch }: Props) {
  const [bots, setBots] = useState<BotView[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newCapabilities, setNewCapabilities] = useState<BotCapability[]>(DEFAULT_CAPABILITIES);
  const [revealedToken, setRevealedToken] = useState("");
  const [revealedTokenBotName, setRevealedTokenBotName] = useState("");
  const [expandedBotId, setExpandedBotId] = useState<string | null>(null);

  const textRooms = useMemo(() => rooms.filter((room) => room.type === "text"), [rooms]);

  const api = (path: string, init?: RequestInit) => authorizedFetch(`${apiBaseUrl.replace(/\/$/, "")}${path}`, init);

  const load = async () => {
    setError("");
    try {
      const response = await api(`/api/servers/${hubId}/bots`);
      const data: unknown = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(data)) {
        throw new Error(responseError(data, "Could not load Hub bots."));
      }
      setBots(data.map(normalizeBot).filter((bot): bot is BotView => Boolean(bot)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Hub bots.");
    }
  };

  useEffect(() => {
    void load();
  }, [hubId]);

  const resetCreateForm = () => {
    setNewName("");
    setNewDescription("");
    setNewCapabilities([...DEFAULT_CAPABILITIES]);
  };

  const toggleCapability = (capability: BotCapability) => {
    setNewCapabilities((current) =>
      current.includes(capability) ? current.filter((item) => item !== capability) : [...current, capability],
    );
  };

  const createBot = async () => {
    const name = newName.trim().slice(0, 32);
    const description = newDescription.trim().slice(0, 180);
    if (!name || newCapabilities.length === 0 || busy) return;
    setBusy("create");
    setError("");
    setNotice("");
    setRevealedToken("");
    try {
      const response = await api(`/api/servers/${hubId}/bots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, capabilities: newCapabilities }),
      });
      const data: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(data, "Could not create Hub bot."));
      const created = normalizeBot(data);
      const token =
        data && typeof data === "object" && typeof (data as Record<string, unknown>).token === "string"
          ? String((data as Record<string, unknown>).token)
          : "";
      if (token) {
        setRevealedToken(token);
        setRevealedTokenBotName(name);
      }
      setCreateOpen(false);
      resetCreateForm();
      if (created) setExpandedBotId(created.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create Hub bot.");
    } finally {
      setBusy("");
    }
  };

  const updateBot = async (
    bot: BotView,
    patch: { enabled?: boolean; capabilities?: BotCapability[] },
    busyKey: string,
  ) => {
    setBusy(busyKey);
    setError("");
    setNotice("");
    try {
      const response = await api(`/api/servers/${hubId}/bots/${encodeURIComponent(bot.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(data, "Could not update this bot."));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update this bot.");
    } finally {
      setBusy("");
    }
  };

  const toggleRoom = async (bot: BotView, roomId: number, enabled: boolean) => {
    const key = `${bot.id}:room:${roomId}`;
    setBusy(key);
    setError("");
    setNotice("");
    setBots((current) =>
      current.map((item) =>
        item.id !== bot.id
          ? item
          : {
              ...item,
              allowedRoomIds: enabled
                ? Array.from(new Set([...item.allowedRoomIds, roomId]))
                : item.allowedRoomIds.filter((id) => id !== roomId),
            },
      ),
    );
    try {
      const response = await api(`/api/servers/${hubId}/bots/${encodeURIComponent(bot.id)}/channels/${roomId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(data, "Could not update the bot room."));
    } catch (err) {
      await load();
      setError(err instanceof Error ? err.message : "Could not update the bot room.");
    } finally {
      setBusy("");
    }
  };

  const rotateToken = async (bot: BotView) => {
    if (!window.confirm(`Rotate the token for “${bot.name}”? The current token will stop working immediately.`)) return;
    setBusy(`${bot.id}:rotate`);
    setError("");
    setNotice("");
    try {
      const response = await api(`/api/servers/${hubId}/bots/${encodeURIComponent(bot.id)}/token`, { method: "POST" });
      const data: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(data, "Could not rotate this bot token."));
      const token =
        data && typeof data === "object" && typeof (data as Record<string, unknown>).token === "string"
          ? String((data as Record<string, unknown>).token)
          : "";
      if (!token) throw new Error("The new token was not returned.");
      setRevealedToken(token);
      setRevealedTokenBotName(bot.name);
      setNotice("The old token is no longer valid.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rotate this bot token.");
    } finally {
      setBusy("");
    }
  };

  const deleteBot = async (bot: BotView) => {
    if (!window.confirm(`Delete bot “${bot.name}”? Its token will stop working immediately.`)) return;
    setBusy(`${bot.id}:delete`);
    setError("");
    try {
      const response = await api(`/api/servers/${hubId}/bots/${encodeURIComponent(bot.id)}`, { method: "DELETE" });
      const data: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(data, "Could not delete this bot."));
      if (expandedBotId === bot.id) setExpandedBotId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete this bot.");
    } finally {
      setBusy("");
    }
  };

  const copyText = async (value: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(successMessage);
    } catch {
      setError("Copy was blocked by the browser. Select the text and copy it manually.");
    }
  };

  const apiExample = `POST /api/bots/messages\nAuthorization: Bot YOUR_TOKEN\nContent-Type: application/json\n\n{"action":"send_message","roomId":123,"text":"Ready up!"}`;

  return (
    <section className="decave-bots-section">
      <div className="decave-bots-heading">
        <div>
          <strong>Hub Bots</strong>
          <small>Give each bot only the actions and text rooms it needs.</small>
        </div>
        <button
          type="button"
          className={createOpen ? "ds-btn ds-btn-sm" : "ds-btn ds-btn-sm ds-btn-primary"}
          onClick={() => {
            setCreateOpen((current) => !current);
            setError("");
          }}
        >
          {createOpen ? (
            <>
              <Icon name="close" />
              Close form
            </>
          ) : (
            <>
              <Icon name="plus" />
              Create bot
            </>
          )}
        </button>
      </div>

      <div className="decave-bots-security-note">
        <span>
          <Icon name="shield" />
        </span>
        <div>
          <strong>Server-side tokens</strong>
          <small>
            Keep a bot token in your server environment. Never put it in browser code, a public repository, or a Hub
            message.
          </small>
        </div>
      </div>

      {createOpen && (
        <div className="decave-bot-create-card">
          <div className="decave-bot-create-head">
            <div>
              <strong>Create a Hub bot</strong>
              <small>New bots start with no room access until you enable one.</small>
            </div>
            <span>1 / 2</span>
          </div>
          <label className="ds-field">
            Bot name
            <input
              className="ds-input"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              maxLength={32}
              placeholder="Raid notifier"
              autoFocus
            />
          </label>
          <label className="ds-field">
            Description <span>(optional)</span>
            <textarea
              className="ds-input"
              value={newDescription}
              onChange={(event) => setNewDescription(event.target.value)}
              maxLength={180}
              rows={2}
              placeholder="Posts raid reminders in selected rooms."
            />
          </label>
          <div className="decave-bot-capability-title">Allowed actions</div>
          <div className="decave-bot-capability-list">
            {CAPABILITY_DEFINITIONS.map((capability) => {
              const checked = newCapabilities.includes(capability.id);
              return (
                <label key={capability.id} className={checked ? "selected" : ""}>
                  <input type="checkbox" checked={checked} onChange={() => toggleCapability(capability.id)} />
                  <span>
                    <strong>{capability.label}</strong>
                    <small>{capability.description}</small>
                  </span>
                </label>
              );
            })}
          </div>
          <div className="decave-bot-create-actions">
            <small>
              {newCapabilities.length ? "You can choose rooms after creation." : "Select at least one action."}
            </small>
            <button
              type="button"
              className="ds-btn ds-btn-primary"
              disabled={busy === "create" || !newName.trim() || newCapabilities.length === 0}
              onClick={() => void createBot()}
            >
              {busy === "create" ? "Creating…" : "Create and show token"}
            </button>
          </div>
        </div>
      )}

      {revealedToken && (
        <div className="decave-bot-token-card">
          <div>
            <strong>Save {revealedTokenBotName}’s token now</strong>
            <small>
              It is shown only after creation or rotation. Anyone with this token can use the enabled bot actions.
            </small>
          </div>
          <code>{revealedToken}</code>
          <div>
            <button
              type="button"
              className="ds-btn ds-btn-sm ds-btn-primary"
              onClick={() => void copyText(revealedToken, "Token copied.")}
            >
              <Icon name="copy" />
              Copy token
            </button>
            <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={() => setRevealedToken("")}>
              Hide token
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="decave-bots-error ds-notice danger" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="decave-bots-notice ds-notice ok" role="status">
          {notice}
        </div>
      )}

      {bots.length === 0 ? (
        <div className="decave-bots-empty">
          <strong>No bots in this Hub yet.</strong>
          <span>Create one when you need notifications, polls, or scheduled events.</span>
        </div>
      ) : (
        <div className="decave-bots-list">
          {bots.map((bot) => {
            const expanded = expandedBotId === bot.id;
            const enabledRooms = bot.allowedRoomIds.length;
            return (
              <article key={bot.id} className={`decave-bot-card${expanded ? " expanded" : ""}`}>
                <button
                  type="button"
                  className="decave-bot-card-head"
                  onClick={() => setExpandedBotId((current) => (current === bot.id ? null : bot.id))}
                  aria-expanded={expanded}
                >
                  <span className="decave-bot-avatar">
                    <Icon name="zap" />
                  </span>
                  <span className="decave-bot-title-copy">
                    <strong>
                      {bot.name}
                      <em>BOT</em>
                    </strong>
                    <small>{bot.description || "Hub integration bot"}</small>
                  </span>
                  <span className={`decave-bot-status ${bot.enabled ? "enabled" : "disabled"}`}>
                    {bot.enabled ? "Enabled" : "Disabled"}
                  </span>
                  <b>
                    <Icon name={expanded ? "chevron-up" : "chevron-down"} size="sm" />
                  </b>
                </button>

                {expanded && (
                  <div className="decave-bot-card-body">
                    <div className="decave-bot-summary">
                      <span>
                        {bot.capabilities.length} action{bot.capabilities.length === 1 ? "" : "s"}
                      </span>
                      <span>
                        {enabledRooms} room{enabledRooms === 1 ? "" : "s"} enabled
                      </span>
                      <span>Token never shown in lists</span>
                    </div>

                    <div className="decave-bot-subhead">
                      <strong>Allowed actions</strong>
                      <small>Requests using an unchecked action are rejected.</small>
                    </div>
                    <div className="decave-bot-capability-list">
                      {CAPABILITY_DEFINITIONS.map((capability) => {
                        const checked = bot.capabilities.includes(capability.id);
                        const key = `${bot.id}:capability:${capability.id}`;
                        return (
                          <label key={capability.id} className={checked ? "selected" : ""}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={busy === key || (checked && bot.capabilities.length === 1)}
                              title={
                                checked && bot.capabilities.length === 1
                                  ? "Keep at least one action enabled"
                                  : undefined
                              }
                              onChange={() =>
                                void updateBot(
                                  bot,
                                  {
                                    capabilities: checked
                                      ? bot.capabilities.filter((item) => item !== capability.id)
                                      : [...bot.capabilities, capability.id],
                                  },
                                  key,
                                )
                              }
                            />
                            <span>
                              <strong>{capability.label}</strong>
                              <small>{capability.description}</small>
                            </span>
                          </label>
                        );
                      })}
                    </div>

                    <div className="decave-bot-subhead">
                      <strong>Enabled text rooms</strong>
                      <small>Calls for every other room are blocked, including private rooms.</small>
                    </div>
                    <div className="decave-bot-room-list">
                      {textRooms.length === 0 ? (
                        <div className="decave-bot-no-rooms">There are no text rooms available for this bot.</div>
                      ) : (
                        textRooms.map((room) => {
                          const checked = bot.allowedRoomIds.includes(room.id);
                          const key = `${bot.id}:room:${room.id}`;
                          return (
                            <label key={room.id} className={checked ? "selected" : ""}>
                              <span>
                                <Icon name="hash" size="sm" /> {room.name}
                              </span>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={busy === key}
                                onChange={(event) => void toggleRoom(bot, room.id, event.target.checked)}
                              />
                            </label>
                          );
                        })
                      )}
                    </div>

                    <div className="decave-bot-api-card">
                      <div>
                        <strong>How to call this bot</strong>
                        <small>
                          Use the token only from a trusted server. Replace the room ID and choose an action you enabled
                          above.
                        </small>
                      </div>
                      <code>{apiExample}</code>
                      <button
                        type="button"
                        className="ds-btn ds-btn-sm"
                        onClick={() => void copyText(apiExample, "API example copied.")}
                      >
                        <Icon name="copy" />
                        Copy API example
                      </button>
                    </div>

                    <div className="decave-bot-actions">
                      <button
                        type="button"
                        className="ds-btn ds-btn-sm"
                        disabled={busy === `${bot.id}:enabled`}
                        onClick={() => void updateBot(bot, { enabled: !bot.enabled }, `${bot.id}:enabled`)}
                      >
                        {bot.enabled ? "Disable bot" : "Enable bot"}
                      </button>
                      <button
                        type="button"
                        className="ds-btn ds-btn-sm"
                        disabled={busy === `${bot.id}:rotate`}
                        onClick={() => void rotateToken(bot)}
                      >
                        Rotate token
                      </button>
                      <button
                        type="button"
                        className="ds-btn ds-btn-sm ds-btn-danger"
                        disabled={busy === `${bot.id}:delete`}
                        onClick={() => void deleteBot(bot)}
                      >
                        Delete bot
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
