// Typed calls to the bot builder routes (worker/routes/bot-builder.ts), the
// same ones web's src/features/bots/api.ts makes.

import { t } from "i18next";
import type { BotRuleError } from "../../../shared/bots/schema";
import type { BotRule } from "../../../shared/bots/types";
import { apiErrorText, apiFetch } from "./api";
import { translateRuleErrors, type BotCapability, type SampleEvent } from "./bot-builder-model";

export type BuilderRule = { id: string; enabled: boolean; draft: BotRule; published: BotRule | null };

export type BuilderBot = {
  id: string;
  kind: "builder" | "token";
  name: string;
  description: string;
  color: string | null;
  avatarEmoji: string | null;
  enabled: boolean;
  capabilities: BotCapability[];
  allowedRoomIds: number[];
  hasUnpublishedChanges: boolean;
  pausedReason: "errors" | null;
  rules: BuilderRule[];
  createdAt: string;
};

export type BuilderOverview = {
  bots: BuilderBot[];
  templates: { id: string; name: string; description: string }[];
  aiAvailable: boolean;
  aiRemainingToday: number;
};

export type BuilderRun = {
  id: number;
  bot_id: string;
  rule_id: string | null;
  trigger: string;
  status: "ok" | "error" | "limited" | "skipped";
  detail: string;
  notice?: unknown;
  created_at: string;
};

export type DryRunStep = { ruleId: string; action: string; description: string; ok: boolean; reason?: string; reasonNotice?: unknown; descriptionNotice?: unknown };
export type PublishError = BotRuleError & { ruleId: string };
export type GenerateResult = { rules: BotRule[]; unsupported: string[]; remainingToday: number };

/** A failed call: `errors` carries per-field rule errors when the server sent them. */
export class BotApiError extends Error {
  readonly status: number;
  readonly errors: BotRuleError[];
  constructor(status: number, message: string, errors: BotRuleError[] = []) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

export type BotsApi = ReturnType<typeof createBotsApi>;

export function createBotsApi(token: string, hubId: number) {
  const base = `/api/servers/${hubId}/bot-builder`;
  const call = async <T>(path: string, method = "GET", body?: unknown): Promise<T> => {
    const response = await apiFetch(
      `${base}${path}`,
      {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      token,
    );
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const errors = Array.isArray(data.errors) ? translateRuleErrors(data.errors as BotRuleError[]) : [];
      const message =
        typeof data.error !== "string" && typeof data.code !== "string" && errors.length
          ? t("bots.api.problems", { count: errors.length })
          : apiErrorText(data, t("bots.newBot.genericError"));
      throw new BotApiError(response.status, message, errors);
    }
    return data as T;
  };
  const bot = (botId: string) => `/${encodeURIComponent(botId)}`;
  const rule = (botId: string, ruleId: string) => `${bot(botId)}/rules/${encodeURIComponent(ruleId)}`;

  return {
    overview: () => call<BuilderOverview>(""),
    create: (name: string, templateId?: string) => call<BuilderBot>("", "POST", { name, templateId }),
    update: (botId: string, patch: Partial<Pick<BuilderBot, "name" | "description" | "color" | "avatarEmoji" | "enabled" | "capabilities" | "allowedRoomIds">>) =>
      call<BuilderBot>(bot(botId), "PATCH", patch),
    remove: (botId: string) => call<{ success: true }>(bot(botId), "DELETE"),
    saveRule: (botId: string, ruleId: string | null, draft: BotRule) => call<{ ruleId: string }>(rule(botId, ruleId ?? "new"), "PUT", draft),
    deleteRule: (botId: string, ruleId: string) => call<{ success: true }>(rule(botId, ruleId), "DELETE"),
    setRuleEnabled: (botId: string, ruleId: string, enabled: boolean) => call<{ success: true }>(rule(botId, ruleId), "PATCH", { enabled }),
    reorder: (botId: string, ruleIds: string[]) => call<{ success: true }>(`${bot(botId)}/rules/order`, "POST", { ruleIds }),
    publish: (botId: string) => call<BuilderBot>(`${bot(botId)}/publish`, "POST", {}),
    runs: (botId: string, errorsOnly: boolean) => call<{ runs: BuilderRun[] }>(`${bot(botId)}/runs${errorsOnly ? "?errors=1" : ""}`),
    exportBot: (botId: string) => call<Record<string, unknown>>(`${bot(botId)}/export`),
    importBot: (file: unknown) => call<{ bot: BuilderBot; unresolved: string[] }>("/import", "POST", file),
    test: (botId: string, ruleId: string, event: SampleEvent & { roomId?: string }) =>
      call<{ steps: DryRunStep[] }>(`${bot(botId)}/test`, "POST", { ruleId, event }),
    generate: (description: string, ruleId?: string) => call<GenerateResult>("/generate", "POST", { description, ruleId }),
  };
}
