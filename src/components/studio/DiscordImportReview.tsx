import { useMemo, useState } from "react";
import {
  buildDiscordImportDryRun,
  type DiscordImportApplyResult,
  type DiscordImportDryRun,
  type DiscordImportExistingRole,
  type DiscordImportExistingRoom,
  type DiscordImportPreview,
  type DiscordImportRollbackResult,
} from "../../../shared/discord-template";

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
      setApplyError(reason instanceof Error ? reason.message : "The import could not be applied.");
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
      setApplyError(reason instanceof Error ? reason.message : "The import could not be rolled back.");
    } finally {
      setApplyBusy(false);
    }
  };

  return (
    <section className="dc-discord-import dc-discord-import-review" aria-label="Discord structure import">
      <div className="dc-discord-import-head">
        <div>
          <span>STRUCTURE IMPORT</span>
          <strong>Review before adding Discord structure</strong>
        </div>
        <small>No login or message history is needed.</small>
      </div>
      <div className="dc-discord-import-form">
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://discord.new/xxxxxxxx"
          aria-label="Discord Server Template URL"
        />
        <button type="button" className="modal-secondary" disabled={busy || !url.trim()} onClick={() => onLoad(url)}>
          {busy ? "Loading…" : "Preview import"}
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
              Clear import
            </button>
          </div>
          <p>{preview.description}</p>
          <div className="dc-discord-import-stats">
            <span>
              <b>{dryRun.summary.rooms}</b> new rooms
            </span>
            <span>
              <b>{dryRun.summary.roles}</b> new roles
            </span>
            <span>
              <b>{dryRun.summary.conflicts}</b> conflicts skipped
            </span>
            <span>
              <b>{dryRun.summary.unsupported}</b> unsupported
            </span>
          </div>
          {dryRun.conflicts.length > 0 && (
            <div className="dc-discord-import-review-list">
              <strong>Existing records kept</strong>
              {dryRun.conflicts.slice(0, 12).map((conflict) => (
                <span key={`${conflict.kind}-${conflict.existingId}`}>
                  {conflict.kind === "room" ? "Room" : "Role"}: {conflict.name}
                  {conflict.category ? ` · ${conflict.category}` : ""}
                </span>
              ))}
            </div>
          )}
          {dryRun.unsupported.length > 0 && (
            <small className="dc-discord-import-warning">Not imported: {dryRun.unsupported.join(", ")}</small>
          )}
          <small className="dc-discord-import-note">
            Users, historical messages, bots, integrations, and Discord permissions are not imported. Existing DeCave
            records are preserved.
          </small>
          {applyError && (
            <p className="dc-discord-import-error" role="alert">
              {applyError}
            </p>
          )}
          {rollbackResult && (
            <p className="dc-discord-import-note" role="status">
              Rollback removed {rollbackResult.deletedRoomIds.length} empty room(s) and{" "}
              {rollbackResult.deletedRoleIds.length} unused role(s).{" "}
              {rollbackResult.retainedRoomIds.length + rollbackResult.retainedRoleIds.length > 0
                ? "Records with later activity or assignments were kept."
                : ""}
            </p>
          )}
          <div className="dc-discord-import-review-actions">
            {!applied && onApply && (
              <button type="button" className="modal-primary" disabled={applyBusy} onClick={() => void apply()}>
                {applyBusy ? "Applying…" : "Apply reviewed import"}
              </button>
            )}
            {applied && onRollback && (
              <button type="button" className="modal-secondary" disabled={applyBusy} onClick={() => void rollback()}>
                {applyBusy ? "Rolling back…" : "Undo created structure"}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
