// The Settings tab: name, avatar, colour, allowed rooms, capabilities, on/off, export and delete.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { TypeToConfirmDialog } from "../shared/TypeToConfirmDialog";
import type { BotsApi, BuilderBot } from "./api";
import { CAPABILITY_LABELS, type BotCapability, type HubRef } from "./model.ts";

type Props = {
  api: BotsApi;
  bot: BuilderBot;
  textRooms: HubRef[];
  onChanged: (bot: BuilderBot) => void;
  onDeleted: () => void;
};

const CAPABILITIES = Object.keys(CAPABILITY_LABELS) as BotCapability[];

function download(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name.replace(/[^\w-]+/g, "-").toLowerCase() || "bot"}.decave-bot.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SettingsTab({ api, bot, textRooms, onChanged, onDeleted }: Props) {
  const { t } = useTranslation(["bots"]);
  const [name, setName] = useState(bot.name);
  const [description, setDescription] = useState(bot.description);
  const [avatar, setAvatar] = useState(bot.avatarEmoji ?? "");
  const [color, setColor] = useState(bot.color ?? "#7c5cff");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setName(bot.name);
    setDescription(bot.description);
    setAvatar(bot.avatarEmoji ?? "");
    setColor(bot.color ?? "#7c5cff");
  }, [bot.id]);

  const update = async (patch: Parameters<BotsApi["update"]>[1], key: string) => {
    setBusy(key);
    setError("");
    try {
      onChanged(await api.update(bot.id, patch));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("bots.settings.saveFailed"));
    } finally {
      setBusy("");
    }
  };

  const lookDirty =
    name.trim() !== bot.name ||
    description.trim() !== bot.description ||
    avatar !== (bot.avatarEmoji ?? "") ||
    color !== (bot.color ?? "#7c5cff");

  const toggleRoom = (id: number) => {
    const next = bot.allowedRoomIds.includes(id)
      ? bot.allowedRoomIds.filter((r) => r !== id)
      : [...bot.allowedRoomIds, id];
    void update({ allowedRoomIds: next }, `room:${id}`);
  };

  const toggleCapability = (id: BotCapability) => {
    const next = bot.capabilities.includes(id) ? bot.capabilities.filter((c) => c !== id) : [...bot.capabilities, id];
    if (next.length) void update({ capabilities: next }, `cap:${id}`);
  };

  return (
    <div className="bb-settings">
      {error && <p className="dcx-notice dcx-notice-error">{error}</p>}
      <section className="dcx-card">
        <div className="dcx-row">
          <div className="dcx-row-copy">
            <strong>{t("bots.settings.on")}</strong>
            <small>{t("bots.settings.onHint")}</small>
          </div>
          <div className="dcx-row-control">
            <label className="dcx-switch">
              <input
                type="checkbox"
                aria-label={t("bots.settings.on")}
                checked={bot.enabled}
                disabled={busy === "enabled"}
                onChange={(e) => void update({ enabled: e.target.checked }, "enabled")}
              />
              <span aria-hidden="true" />
            </label>
          </div>
        </div>
      </section>

      <section className="dcx-card">
        <div className="bb-fields">
          <div className="bb-field">
            <label className="bb-field-label" htmlFor="bb-set-name">
              {t("bots.settings.name")}
            </label>
            <input
              id="bb-set-name"
              className="dcx-input"
              maxLength={32}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="bb-field">
            <label className="bb-field-label" htmlFor="bb-set-avatar">
              {t("bots.settings.avatar")}
            </label>
            <input
              id="bb-set-avatar"
              className="dcx-input bb-emoji"
              maxLength={16}
              value={avatar}
              onChange={(e) => setAvatar(e.target.value.trim())}
            />
          </div>
          <div className="bb-field">
            <label className="bb-field-label" htmlFor="bb-set-color">
              {t("bots.settings.colour")}
            </label>
            <input
              id="bb-set-color"
              className="bb-color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </div>
          <div className="bb-field wide">
            <label className="bb-field-label" htmlFor="bb-set-desc">
              {t("bots.settings.description")}
            </label>
            <input
              id="bb-set-desc"
              className="dcx-input"
              maxLength={180}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <div className="bb-settings-actions">
          <button
            type="button"
            className="dcx-btn dcx-btn-sm dcx-btn-primary"
            disabled={!lookDirty || !name.trim() || busy === "look"}
            onClick={() =>
              void update(
                {
                  name: name.trim(),
                  description: description.trim(),
                  color,
                  ...(avatar ? { avatarEmoji: avatar } : {}),
                },
                "look",
              )
            }
          >
            {t("bots.settings.save")}
          </button>
        </div>
      </section>

      <section className="dcx-card">
        <div className="dcx-card-head">
          <h4>{t("bots.settings.rooms")}</h4>
          <p>{t("bots.settings.roomsHint")}</p>
        </div>
        <div className="bb-chips">
          {textRooms.map((room) => {
            const on = bot.allowedRoomIds.includes(Number(room.id));
            return (
              <button
                key={room.id}
                type="button"
                className={`bb-chip${on ? " on" : ""}`}
                aria-pressed={on}
                disabled={busy === `room:${room.id}`}
                onClick={() => toggleRoom(Number(room.id))}
              >
                #{room.name}
              </button>
            );
          })}
        </div>
      </section>

      <section className="dcx-card">
        <div className="dcx-card-head">
          <h4>{t("bots.settings.capabilities")}</h4>
          <p>{t("bots.settings.capabilitiesHint")}</p>
        </div>
        {CAPABILITIES.map((id) => ({ id, ...CAPABILITY_LABELS[id] })).map((cap) => (
          <div className="dcx-row" key={cap.id}>
            <div className="dcx-row-copy">
              <strong>{cap.label}</strong>
              <small>{cap.description}</small>
            </div>
            <div className="dcx-row-control">
              <label className="dcx-switch">
                <input
                  type="checkbox"
                  aria-label={cap.label}
                  checked={bot.capabilities.includes(cap.id)}
                  disabled={busy === `cap:${cap.id}`}
                  onChange={() => toggleCapability(cap.id)}
                />
                <span aria-hidden="true" />
              </label>
            </div>
          </div>
        ))}
      </section>

      <section className="dcx-card">
        <div className="dcx-row">
          <div className="dcx-row-copy">
            <strong>{t("bots.settings.export")}</strong>
            <small>{t("bots.settings.exportHint")}</small>
          </div>
          <div className="dcx-row-control">
            <button
              type="button"
              className="dcx-btn dcx-btn-sm"
              onClick={async () => {
                try {
                  download(bot.name, await api.exportBot(bot.id));
                } catch (caught) {
                  setError(caught instanceof Error ? caught.message : t("bots.settings.exportFailed"));
                }
              }}
            >
              {t("bots.settings.export")}
            </button>
          </div>
        </div>
        <div className="dcx-row">
          <div className="dcx-row-copy">
            <strong>{t("bots.settings.delete")}</strong>
            <small>{t("bots.settings.deleteHint")}</small>
          </div>
          <div className="dcx-row-control">
            <button type="button" className="dcx-btn dcx-btn-sm dcx-btn-danger" onClick={() => setConfirmDelete(true)}>
              {t("bots.ruleCard.delete")}
            </button>
          </div>
        </div>
      </section>

      {confirmDelete && (
        <TypeToConfirmDialog
          title={t("bots.settings.deleteTitle", { name: bot.name })}
          description={t("bots.settings.deleteDescription")}
          confirmText={bot.name}
          actionLabel={t("bots.settings.delete")}
          busy={busy === "delete"}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            setBusy("delete");
            try {
              await api.remove(bot.id);
              setConfirmDelete(false);
              onDeleted();
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : t("bots.settings.deleteFailed"));
            } finally {
              setBusy("");
            }
          }}
        />
      )}
    </div>
  );
}
