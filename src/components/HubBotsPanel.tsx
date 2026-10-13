import { useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { apiErrorMessage } from "../i18n/apiError";
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

// Labels and descriptions are admin.hubBots.capability.<id> in the catalog.
const CAPABILITY_DEFINITIONS: Array<{ id: BotCapability }> = [
  { id: "send_messages" },
  { id: "create_polls" },
  { id: "create_events" },
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

/** The server's error (translated from its code when the catalog knows it), else the fallback. */
function responseError(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && typeof (value as Record<string, unknown>).error === "string") {
    return apiErrorMessage(value as { code?: string; error?: string }, "common.unknown");
  }
  return fallback;
}

export default function HubBotsPanel({ hubId, rooms, apiBaseUrl, authorizedFetch }: Props) {
  const { t } = useTranslation(["admin"]);
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
        throw new Error(responseError(data, t("admin.hubBots.loadFailed")));
      }
      setBots(data.map(normalizeBot).filter((bot): bot is BotView => Boolean(bot)));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.hubBots.loadFailed"));
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
      if (!response.ok) throw new Error(responseError(data, t("admin.hubBots.createFailed")));
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
      setError(err instanceof Error ? err.message : t("admin.hubBots.createFailed"));
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
      if (!response.ok) throw new Error(responseError(data, t("admin.hubBots.updateFailed")));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.hubBots.updateFailed"));
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
      if (!response.ok) throw new Error(responseError(data, t("admin.hubBots.roomFailed")));
    } catch (err) {
      await load();
      setError(err instanceof Error ? err.message : t("admin.hubBots.roomFailed"));
    } finally {
      setBusy("");
    }
  };

  const rotateToken = async (bot: BotView) => {
    if (!window.confirm(t("admin.hubBots.rotateConfirm", { name: bot.name }))) return;
    setBusy(`${bot.id}:rotate`);
    setError("");
    setNotice("");
    try {
      const response = await api(`/api/servers/${hubId}/bots/${encodeURIComponent(bot.id)}/token`, { method: "POST" });
      const data: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(data, t("admin.hubBots.rotateFailed")));
      const token =
        data && typeof data === "object" && typeof (data as Record<string, unknown>).token === "string"
          ? String((data as Record<string, unknown>).token)
          : "";
      if (!token) throw new Error(t("admin.hubBots.tokenMissing"));
      setRevealedToken(token);
      setRevealedTokenBotName(bot.name);
      setNotice(t("admin.hubBots.oldTokenInvalid"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.hubBots.rotateFailed"));
    } finally {
      setBusy("");
    }
  };

  const deleteBot = async (bot: BotView) => {
    if (!window.confirm(t("admin.hubBots.deleteConfirm", { name: bot.name }))) return;
    setBusy(`${bot.id}:delete`);
    setError("");
    try {
      const response = await api(`/api/servers/${hubId}/bots/${encodeURIComponent(bot.id)}`, { method: "DELETE" });
      const data: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(data, t("admin.hubBots.deleteFailed")));
      if (expandedBotId === bot.id) setExpandedBotId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.hubBots.deleteFailed"));
    } finally {
      setBusy("");
    }
  };

  const copyText = async (value: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(successMessage);
    } catch {
      setError(t("admin.hubBots.copyBlocked"));
    }
  };

  const apiExample = `POST /api/bots/messages\nAuthorization: Bot YOUR_TOKEN\nContent-Type: application/json\n\n{"action":"send_message","roomId":123,"text":"Ready up!"}`;

  return (
    <section className="decave-bots-section">
      <div className="decave-bots-heading">
        <div>
          <strong>{t("admin.hubBots.title")}</strong>
          <small>{t("admin.hubBots.intro")}</small>
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
              {t("admin.hubBots.closeForm")}
            </>
          ) : (
            <>
              <Icon name="plus" />
              {t("admin.hubBots.create")}
            </>
          )}
        </button>
      </div>

      <div className="decave-bots-security-note">
        <span>
          <Icon name="shield" />
        </span>
        <div>
          <strong>{t("admin.hubBots.securityTitle")}</strong>
          <small>{t("admin.hubBots.securityBody")}</small>
        </div>
      </div>

      {createOpen && (
        <div className="decave-bot-create-card">
          <div className="decave-bot-create-head">
            <div>
              <strong>{t("admin.hubBots.createTitle")}</strong>
              <small>{t("admin.hubBots.createIntro")}</small>
            </div>
            <span>1 / 2</span>
          </div>
          <label className="ds-field">
            {t("admin.hubBots.name")}
            <input
              className="ds-input"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              maxLength={32}
              placeholder={t("admin.hubBots.namePlaceholder")}
              autoFocus
            />
          </label>
          <label className="ds-field">
            <Trans t={t} i18nKey="admin.hubBots.description" components={{ optional: <span /> }} />
            <textarea
              className="ds-input"
              value={newDescription}
              onChange={(event) => setNewDescription(event.target.value)}
              maxLength={180}
              rows={2}
              placeholder={t("admin.hubBots.descriptionPlaceholder")}
            />
          </label>
          <div className="decave-bot-capability-title">{t("admin.hubBots.allowedActions")}</div>
          <div className="decave-bot-capability-list">
            {CAPABILITY_DEFINITIONS.map((capability) => {
              const checked = newCapabilities.includes(capability.id);
              return (
                <label key={capability.id} className={checked ? "selected" : ""}>
                  <input type="checkbox" checked={checked} onChange={() => toggleCapability(capability.id)} />
                  <span>
                    <strong>{t(`admin.hubBots.capability.${capability.id}.label`)}</strong>
                    <small>{t(`admin.hubBots.capability.${capability.id}.description`)}</small>
                  </span>
                </label>
              );
            })}
          </div>
          <div className="decave-bot-create-actions">
            <small>
              {newCapabilities.length ? t("admin.hubBots.chooseRoomsLater") : t("admin.hubBots.selectAction")}
            </small>
            <button
              type="button"
              className="ds-btn ds-btn-primary"
              disabled={busy === "create" || !newName.trim() || newCapabilities.length === 0}
              onClick={() => void createBot()}
            >
              {busy === "create" ? t("admin.hubBots.creating") : t("admin.hubBots.createAndShow")}
            </button>
          </div>
        </div>
      )}

      {revealedToken && (
        <div className="decave-bot-token-card">
          <div>
            <strong>{t("admin.hubBots.saveToken", { name: revealedTokenBotName })}</strong>
            <small>{t("admin.hubBots.tokenOnce")}</small>
          </div>
          <code>{revealedToken}</code>
          <div>
            <button
              type="button"
              className="ds-btn ds-btn-sm ds-btn-primary"
              onClick={() => void copyText(revealedToken, t("admin.hubBots.tokenCopied"))}
            >
              <Icon name="copy" />
              {t("admin.hubBots.copyToken")}
            </button>
            <button type="button" className="ds-btn ds-btn-sm ds-btn-ghost" onClick={() => setRevealedToken("")}>
              {t("admin.hubBots.hideToken")}
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
          <strong>{t("admin.hubBots.emptyTitle")}</strong>
          <span>{t("admin.hubBots.emptyBody")}</span>
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
                      <em>{t("admin.hubBots.badge")}</em>
                    </strong>
                    <small>{bot.description || t("admin.hubBots.defaultDescription")}</small>
                  </span>
                  <span className={`decave-bot-status ${bot.enabled ? "enabled" : "disabled"}`}>
                    {bot.enabled ? t("admin.hubBots.enabled") : t("admin.hubBots.disabled")}
                  </span>
                  <b>
                    <Icon name={expanded ? "chevron-up" : "chevron-down"} size="sm" />
                  </b>
                </button>

                {expanded && (
                  <div className="decave-bot-card-body">
                    <div className="decave-bot-summary">
                      <span>{t("admin.hubBots.actionCount", { count: bot.capabilities.length })}</span>
                      <span>{t("admin.hubBots.roomCount", { count: enabledRooms })}</span>
                      <span>{t("admin.hubBots.tokenHidden")}</span>
                    </div>

                    <div className="decave-bot-subhead">
                      <strong>{t("admin.hubBots.allowedActions")}</strong>
                      <small>{t("admin.hubBots.uncheckedRejected")}</small>
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
                              title={checked && bot.capabilities.length === 1 ? t("admin.hubBots.keepOne") : undefined}
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
                              <strong>{t(`admin.hubBots.capability.${capability.id}.label`)}</strong>
                              <small>{t(`admin.hubBots.capability.${capability.id}.description`)}</small>
                            </span>
                          </label>
                        );
                      })}
                    </div>

                    <div className="decave-bot-subhead">
                      <strong>{t("admin.hubBots.roomsTitle")}</strong>
                      <small>{t("admin.hubBots.roomsIntro")}</small>
                    </div>
                    <div className="decave-bot-room-list">
                      {textRooms.length === 0 ? (
                        <div className="decave-bot-no-rooms">{t("admin.hubBots.noRooms")}</div>
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
                        <strong>{t("admin.hubBots.howToCall")}</strong>
                        <small>{t("admin.hubBots.howToCallBody")}</small>
                      </div>
                      <code>{apiExample}</code>
                      <button
                        type="button"
                        className="ds-btn ds-btn-sm"
                        onClick={() => void copyText(apiExample, t("admin.hubBots.exampleCopied"))}
                      >
                        <Icon name="copy" />
                        {t("admin.hubBots.copyExample")}
                      </button>
                    </div>

                    <div className="decave-bot-actions">
                      <button
                        type="button"
                        className="ds-btn ds-btn-sm"
                        disabled={busy === `${bot.id}:enabled`}
                        onClick={() => void updateBot(bot, { enabled: !bot.enabled }, `${bot.id}:enabled`)}
                      >
                        {bot.enabled ? t("admin.hubBots.disable") : t("admin.hubBots.enable")}
                      </button>
                      <button
                        type="button"
                        className="ds-btn ds-btn-sm"
                        disabled={busy === `${bot.id}:rotate`}
                        onClick={() => void rotateToken(bot)}
                      >
                        {t("admin.hubBots.rotate")}
                      </button>
                      <button
                        type="button"
                        className="ds-btn ds-btn-sm ds-btn-danger"
                        disabled={busy === `${bot.id}:delete`}
                        onClick={() => void deleteBot(bot)}
                      >
                        {t("admin.hubBots.delete")}
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
