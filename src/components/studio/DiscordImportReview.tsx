import { useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  buildDiscordImportDryRun,
  type DiscordImportApplyResult,
  type DiscordImportDryRun,
  type DiscordImportExistingRole,
  type DiscordImportExistingRoom,
  type DiscordImportPreview,
  type DiscordImportRollbackResult,
} from "../../../shared/discord-template";

// The shape of a Discord Server Template link, the same in every language.
const TEMPLATE_URL_SHAPE = "https://discord.new/xxxxxxxx";

export type DiscordImportReviewProps = {
  preview: DiscordImportPreview | null;
  existingRooms?: readonly DiscordImportExistingRoom[];
  existingRoles?: readonly DiscordImportExistingRole[];
  busy?: boolean;
  error?: string;
  onLoad: (value: string) => void;
  onClear: () => void;
  onApply?: (dryRun: DiscordImportDryRun) => Promise<DiscordImportApplyResult | void> | DiscordImportApplyResult | void;
  onRollback?: (
    result: DiscordImportApplyResult,
  ) => Promise<DiscordImportRollbackResult | void> | DiscordImportRollbackResult | void;
};

/**
 * Review-first import UI. It does not create anything while loading a preview;
 * applying is explicit, and the optional rollback callback receives only the
 * entities created by that apply operation.
 */
export function DiscordImportReview({
  preview,
  existingRooms = [],
  existingRoles = [],
  busy = false,
  error = "",
  onLoad,
  onClear,
  onApply,
  onRollback,
}: DiscordImportReviewProps) {
  const { t } = useTranslation(["admin"]);
  const [url, setUrl] = useState("");
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState("");
  const [applied, setApplied] = useState<DiscordImportApplyResult | null>(null);
  const [rollbackResult, setRollbackResult] = useState<DiscordImportRollbackResult | null>(null);
  const dryRun = useMemo(
    () => (preview ? buildDiscordImportDryRun(preview, existingRooms, existingRoles) : null),
    [existingRoles, existingRooms, preview],
  );

  const apply = async () => {
    if (!dryRun || !onApply || applyBusy) return;
    setApplyBusy(true);
    setApplyError("");
    setRollbackResult(null);
    try {
      const result = await onApply(dryRun);
      if (result) setApplied(result);
    } catch (reason) {
      setApplyError(reason instanceof Error ? reason.message : t("admin.discordImport.applyFailed"));
    } finally {
      setApplyBusy(false);
    }
  };

  const rollback = async () => {
    if (!applied || !onRollback || applyBusy) return;
    setApplyBusy(true);
    setApplyError("");
    try {
      const result = await onRollback(applied);
      if (result) setRollbackResult(result);
      if (result && result.retainedRoomIds.length === 0 && result.retainedRoleIds.length === 0) setApplied(null);
    } catch (reason) {
      setApplyError(reason instanceof Error ? reason.message : t("admin.discordImport.rollbackFailed"));
    } finally {
      setApplyBusy(false);
    }
  };

  return (
    <section className="dc-discord-import dc-discord-import-review" aria-label={t("admin.discordImport.label")}>
      <div className="dc-discord-import-head">
        <div>
          <span>{t("admin.discordImport.kicker")}</span>
          <strong>{t("admin.discordImport.title")}</strong>
        </div>
        <small>{t("admin.discordImport.noLogin")}</small>
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
      {preview && dryRun && (
        <div className="dc-discord-import-preview">
          <div className="dc-discord-import-preview-title">
            <strong>{preview.name}</strong>
            <button
              type="button"
              onClick={() => {
                setApplied(null);
                setRollbackResult(null);
                onClear();
              }}
            >
              {t("admin.discordImport.clear")}
            </button>
          </div>
          <p>{preview.description}</p>
          <div className="dc-discord-import-stats">
            <span>
              <Trans
                t={t}
                i18nKey="admin.discordImport.rooms"
                count={dryRun.summary.rooms}
                values={{ count: dryRun.summary.rooms }}
                components={{ b: <b /> }}
              />
            </span>
            <span>
              <Trans
                t={t}
                i18nKey="admin.discordImport.roles"
                count={dryRun.summary.roles}
                values={{ count: dryRun.summary.roles }}
                components={{ b: <b /> }}
              />
            </span>
            <span>
              <Trans
                t={t}
                i18nKey="admin.discordImport.conflicts"
                count={dryRun.summary.conflicts}
                values={{ count: dryRun.summary.conflicts }}
                components={{ b: <b /> }}
              />
            </span>
            <span>
              <Trans
                t={t}
                i18nKey="admin.discordImport.unsupported"
                count={dryRun.summary.unsupported}
                values={{ count: dryRun.summary.unsupported }}
                components={{ b: <b /> }}
              />
            </span>
          </div>
          {dryRun.conflicts.length > 0 && (
            <div className="dc-discord-import-review-list">
              <strong>{t("admin.discordImport.kept")}</strong>
              {dryRun.conflicts.slice(0, 12).map((conflict) => (
                <span key={`${conflict.kind}-${conflict.existingId}`}>
                  {conflict.kind === "room"
                    ? conflict.category
                      ? t("admin.discordImport.conflictRoomIn", { name: conflict.name, category: conflict.category })
                      : t("admin.discordImport.conflictRoom", { name: conflict.name })
                    : conflict.category
                      ? t("admin.discordImport.conflictRoleIn", { name: conflict.name, category: conflict.category })
                      : t("admin.discordImport.conflictRole", { name: conflict.name })}
                </span>
              ))}
            </div>
          )}
          {dryRun.unsupported.length > 0 && (
            <small className="dc-discord-import-warning">
              {t("admin.discordImport.notImported", { items: dryRun.unsupported.join(", ") })}
            </small>
          )}
          <small className="dc-discord-import-note">{t("admin.discordImport.note")}</small>
          {applyError && (
            <p className="dc-discord-import-error" role="alert">
              {applyError}
            </p>
          )}
          {rollbackResult && (
            <p className="dc-discord-import-note" role="status">
              {t("admin.discordImport.rollback", {
                rooms: t("admin.discordImport.rollbackRooms", { count: rollbackResult.deletedRoomIds.length }),
                roles: t("admin.discordImport.rollbackRoles", { count: rollbackResult.deletedRoleIds.length }),
              })}{" "}
              {rollbackResult.retainedRoomIds.length + rollbackResult.retainedRoleIds.length > 0
                ? t("admin.discordImport.rollbackKept")
                : ""}
            </p>
          )}
          <div className="dc-discord-import-review-actions">
            {!applied && onApply && (
              <button type="button" className="modal-primary" disabled={applyBusy} onClick={() => void apply()}>
                {applyBusy ? t("admin.discordImport.applying") : t("admin.discordImport.apply")}
              </button>
            )}
            {applied && onRollback && (
              <button type="button" className="modal-secondary" disabled={applyBusy} onClick={() => void rollback()}>
                {applyBusy ? t("admin.discordImport.rollingBack") : t("admin.discordImport.undo")}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
