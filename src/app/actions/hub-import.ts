// Importing a Discord server template into a Hub: preview, then apply.

import type { Dispatch, SetStateAction } from "react";
import {
  extractDiscordTemplateCode,
  type DiscordImportApplyResult,
  type DiscordImportDryRun,
  type DiscordImportPreview,
} from "../../../shared/discord-template";
import type { Server, ApiError } from "../types";
import { HTTP_URL } from "../env";

export type HubImportActionsDeps = {
  setHubImportPreview: Dispatch<SetStateAction<DiscordImportPreview | null>>;
  setHubImportBusy: Dispatch<SetStateAction<boolean>>;
  setHubImportError: Dispatch<SetStateAction<string>>;
  currentServer: Server;
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  loadServers: () => Promise<Server[] | null>;
};

/** Called once per render with that render's values. */
export function createHubImportActions(deps: HubImportActionsDeps) {
  const { setHubImportPreview, setHubImportBusy, setHubImportError, currentServer, authorizedFetch, loadServers } =
    deps;

  const loadHubImportPreview = async (value: string) => {
    const code = extractDiscordTemplateCode(value);
    if (!code) {
      setHubImportError("Enter a supported Discord Server Template URL.");
      setHubImportPreview(null);
      return;
    }
    setHubImportBusy(true);
    setHubImportError("");
    try {
      const sourceResponse = await authorizedFetch(`${HTTP_URL}/api/discord/templates/${encodeURIComponent(code)}`);
      const source = (await sourceResponse.json()) as DiscordImportPreview & ApiError;
      if (!sourceResponse.ok) throw new Error(source.error || "Discord template could not be retrieved.");
      const previewResponse = await authorizedFetch(`${HTTP_URL}/api/servers/${currentServer.id}/import/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discordImport: source }),
      });
      const preview = (await previewResponse.json()) as DiscordImportPreview & ApiError;
      if (!previewResponse.ok) throw new Error(preview.error || "The Hub structure could not be previewed.");
      setHubImportPreview(source);
    } catch (error) {
      setHubImportError(error instanceof Error ? error.message : "The Hub structure could not be previewed.");
      setHubImportPreview(null);
    } finally {
      setHubImportBusy(false);
    }
  };

  const applyHubImport = async (dryRun: DiscordImportDryRun): Promise<DiscordImportApplyResult> => {
    const response = await authorizedFetch(`${HTTP_URL}/api/servers/${currentServer.id}/import/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        discordImport: {
          sourceName: dryRun.sourceName,
          sourceCode: dryRun.sourceCode,
          create: dryRun.create,
          conflicts: dryRun.conflicts,
          unsupported: dryRun.unsupported,
        },
        fingerprint: dryRun.fingerprint,
      }),
    });
    const result = (await response.json()) as DiscordImportApplyResult & ApiError;
    if (!response.ok || !result.importId) throw new Error(result.error || "The reviewed import could not be applied.");
    await loadServers();
    return result;
  };

  return {
    loadHubImportPreview,
    applyHubImport,
  };
}
