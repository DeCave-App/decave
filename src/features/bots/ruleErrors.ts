// Rule validation errors (shared/bots/schema.ts) in the UI language. Errors carry
// a bots.validation.* code next to the English message; others stay as sent.

import type { BotRuleError } from "../../../shared/bots/schema.ts";
import { i18next } from "../../i18n/index.ts";

export function translateRuleErrors<T extends BotRuleError>(errors: T[]): T[] {
  return errors.map((error) => {
    const code = error.code;
    if (typeof code !== "string" || !code.startsWith("bots.validation.") || !i18next.exists(code)) return error;
    const message = (i18next.t as unknown as (key: string, params?: Record<string, unknown>) => string)(
      code,
      error.params,
    );
    return { ...error, message };
  });
}
