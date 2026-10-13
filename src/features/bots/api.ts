// Typed calls to the bot builder routes (worker/routes/bot-builder.ts).
import type { BotRuleError } from "../../../shared/bots/schema.ts";
import type { BotRule } from "../../../shared/bots/types.ts";
import { apiErrorMessage, type ApiErrorBody } from "../../i18n/apiError.ts";
import { i18next } from "../../i18n/index.ts";
import type { BotCapability, SampleEvent } from "./model.ts";
import { translateRuleErrors } from "./ruleErrors.ts";

export type AuthorizedFetch = (input: string, init?: RequestInit) => Promise<Response>;

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
  /** "errors" when the bot was turned off after too many failed runs in a row. */
  pausedReason: "errors" | null;
  rules: BuilderRule[];
  createdAt: string;
};

export type BotTemplateSummary = { id: string; name: string; description: string };

export type BuilderOverview = {
  bots: BuilderBot[];
  templates: BotTemplateSummary[];
  aiAvailable: boolean;
  aiRemainingToday: number;
};

export type BotRun = {
  id: number;
  bot_id: string;
  rule_id: string | null;
  trigger: string;
  status: "ok" | "error" | "limited" | "skipped";
  detail: string;
  /** `detail` as a notice to show in the UI language (absent or null for older runs). */
  notice?: unknown;
  created_at: string;
};

export type DryRunStep = {
  ruleId: string;
  action: string;
  description: string;
  ok: boolean;
  reason?: string;
  reasonNotice?: unknown;
  descriptionNotice?: unknown;
};

export type PublishError = BotRuleError & { ruleId: string };

export type BotExport = {
  v: 1;
  name: string;
  description: string;
  color: string | null;
  avatarEmoji: string | null;
  rules: BotRule[];
};

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

export function createBotsApi(apiBaseUrl: string, authorizedFetch: AuthorizedFetch, hubId: number) {
  const base = `${apiBaseUrl.replace(/\/$/, "")}/api/servers/${hubId}/bot-builder`;
  const call = async <T>(path: string, method = "GET", body?: unknown): Promise<T> => {
    const response = await authorizedFetch(`${base}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const errors = Array.isArray(data.errors) ? translateRuleErrors(data.errors as BotRuleError[]) : [];
      // Rule errors without a server message are summed up; otherwise the
      // server's message (translated from its code) or the generic one.
      const message =
        typeof data.error !== "string" && typeof data.code !== "string" && errors.length
          ? i18next.t("bots.api.problems", { count: errors.length })
          : apiErrorMessage(data as ApiErrorBody, "common.unknown");
      throw new BotApiError(response.status, message, errors);
    }
    return data as T;
  };
  const bot = (botId: string) => `/${encodeURIComponent(botId)}`;
  const rule = (botId: string, ruleId: string) => `${bot(botId)}/rules/${encodeURIComponent(ruleId)}`;

  return {
    overview: () => call<BuilderOverview>(""),
    create: (name: string, templateId?: string) => call<BuilderBot>("", "POST", { name, templateId }),
    update: (
      botId: string,
      patch: Partial<
        Pick<
          BuilderBot,
          "name" | "description" | "color" | "avatarEmoji" | "enabled" | "capabilities" | "allowedRoomIds"
        >
      >,
    ) => call<BuilderBot>(bot(botId), "PATCH", patch),
    remove: (botId: string) => call<{ success: true }>(bot(botId), "DELETE"),
    saveRule: (botId: string, ruleId: string | null, draft: BotRule) =>
      call<{ ruleId: string }>(rule(botId, ruleId ?? "new"), "PUT", draft),
    deleteRule: (botId: string, ruleId: string) => call<{ success: true }>(rule(botId, ruleId), "DELETE"),
    setRuleEnabled: (botId: string, ruleId: string, enabled: boolean) =>
      call<{ success: true }>(rule(botId, ruleId), "PATCH", { enabled }),
    reorder: (botId: string, ruleIds: string[]) =>
      call<{ success: true }>(`${bot(botId)}/rules/order`, "POST", { ruleIds }),
    publish: (botId: string) => call<BuilderBot>(`${bot(botId)}/publish`, "POST", {}),
    runs: (botId: string, errorsOnly: boolean) =>
      call<{ runs: BotRun[] }>(`${bot(botId)}/runs${errorsOnly ? "?errors=1" : ""}`),
    exportBot: (botId: string) => call<BotExport>(`${bot(botId)}/export`),
    importBot: (file: unknown) => call<{ bot: BuilderBot; unresolved: string[] }>("/import", "POST", file),
    test: (botId: string, ruleId: string, event: SampleEvent & { roomId?: string }) =>
      call<{ steps: DryRunStep[] }>(`${bot(botId)}/test`, "POST", { ruleId, event }),
    generate: (description: string, ruleId?: string) =>
      call<GenerateResult>("/generate", "POST", { description, ruleId }),
  };
}
