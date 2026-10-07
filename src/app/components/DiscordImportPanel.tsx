import { useState } from "react";
import type { DiscordImportPreview } from "../../../shared/discord-template";

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
  const [url, setUrl] = useState("");
  return (
    <div className="dc-discord-import">
      <div className="dc-discord-import-head">
        <div>
          <span>STRUCTURE IMPORT</span>
          <strong>Already have a Discord server?</strong>
        </div>
        <small>No Discord login or message history is needed.</small>
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
      {preview && (
        <div className="dc-discord-import-preview">
          <div className="dc-discord-import-preview-title">
            <strong>{preview.name}</strong>
            <button type="button" onClick={onClear}>
              Clear import
            </button>
          </div>
          <p>{preview.description}</p>
          <div className="dc-discord-import-stats">
            <span>
              <b>{preview.categories}</b> categories
            </span>
            <span>
              <b>{preview.rooms.filter((room) => room.type === "text").length}</b> text
            </span>
            <span>
              <b>{preview.rooms.filter((room) => room.type === "forum").length}</b> forums
            </span>
            <span>
              <b>{preview.rooms.filter((room) => room.type === "voice").length}</b> voice
            </span>
            <span>
              <b>{preview.roles.length}</b> roles
            </span>
          </div>
          {preview.unsupported.length > 0 && (
            <small className="dc-discord-import-warning">Not imported: {preview.unsupported.join(", ")}</small>
          )}
          <small className="dc-discord-import-note">
            Users, historical messages, bots, integrations, and Discord permissions are not imported. Roles are
            recreated as names and colors only.
          </small>
        </div>
      )}
    </div>
  );
}
