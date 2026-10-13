import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { DiscordImportPreview } from "../../../shared/discord-template";

const TEMPLATE_URL_SHAPE = "https://discord.new/xxxxxxxx";

type PanelStat = "categories" | "text" | "forums" | "voice" | "roles";

export function DiscordImportPanel({
  preview,
  busy,
  error,
  onLoad,
  onClear,
}: {
  preview: DiscordImportPreview | null;
  busy: boolean;
  error: string;
  onLoad: (value: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation(["admin"]);
  const [url, setUrl] = useState("");
  const stat = (key: PanelStat, count: number) => (
    <span>
      <Trans
        t={t}
        i18nKey={`admin.discordImport.panelStats.${key}`}
        count={count}
        values={{ count }}
        components={{ b: <b /> }}
      />
    </span>
  );
  return (
    <div className="dc-discord-import">
      <div className="dc-discord-import-head">
        <div>
          <span>{t("admin.discordImport.kicker")}</span>
          <strong>{t("admin.discordImport.haveServer")}</strong>
        </div>
        <small>{t("admin.discordImport.noDiscordLogin")}</small>
      </div>
      <div className="dc-discord-import-form">
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={TEMPLATE_URL_SHAPE}
          aria-label={t("admin.discordImport.urlLabel")}
        />
        <button type="button" className="modal-secondary" disabled={busy || !url.trim()} onClick={() => onLoad(url)}>
          {busy ? t("admin.discordImport.loading") : t("admin.discordImport.preview")}
        </button>
      </div>
      {error && (
        <p className="dc-discord-import-error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <div className="dc-discord-import-preview">
          <div className="dc-discord-import-preview-title">
            <strong>{preview.name}</strong>
            <button type="button" onClick={onClear}>
              {t("admin.discordImport.clear")}
            </button>
          </div>
          <p>{preview.description}</p>
          <div className="dc-discord-import-stats">
            {stat("categories", preview.categories)}
            {stat("text", preview.rooms.filter((room) => room.type === "text").length)}
            {stat("forums", preview.rooms.filter((room) => room.type === "forum").length)}
            {stat("voice", preview.rooms.filter((room) => room.type === "voice").length)}
            {stat("roles", preview.roles.length)}
          </div>
          {preview.unsupported.length > 0 && (
            <small className="dc-discord-import-warning">
              {t("admin.discordImport.notImported", { items: preview.unsupported.join(", ") })}
            </small>
          )}
          <small className="dc-discord-import-note">{t("admin.discordImport.panelNote")}</small>
        </div>
      )}
    </div>
  );
}
