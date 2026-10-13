// Webhook action: calls an admin-configured HTTPS URL through the SSRF guard
// and exposes the status and top-level scalar JSON fields as variables.

import { renderTemplate } from "../../../shared/bots/render";
import { takeBudget } from "../limits";
import { refusal } from "../reasons";
import { guardedFetch, webhookUrlRefusal } from "../webhook";
import { registerAction, type ActionResult } from "./registry";

const MAX_KEYS = 20;
const MAX_STRING = 500;

// Body templates are usually JSON, whose braces would be read as placeholders by
// renderTemplate. Only {name...} spans that start like a variable are rendered
// (the rest stays literal), and values are JSON-escaped so a member's text can't
// break out of the string it is placed in.
const PLACEHOLDER = /{(?=[A-Za-z_])[^{}",]*}/g;

function insideString(text: string, index: number): boolean {
  let inside = false;
  for (let i = 0; i < index; i++) {
    if (text[i] === "\\") i += 1;
    else if (text[i] === '"') inside = !inside;
  }
  return inside;
}

/** Inside a JSON string: escaped text. Outside one: a JSON literal, so a value can't add keys. */
function renderBody(template: string, vars: Record<string, string | number>): string {
  return template.replace(PLACEHOLDER, (match, offset: number) => {
    const rendered = renderTemplate(match, vars);
    if (insideString(template, offset)) return JSON.stringify(rendered).slice(1, -1);
    const raw = vars[match.slice(1, -1).trim()];
    if (typeof raw === "number" && Number.isFinite(raw) && String(raw) === rendered) return rendered;
    return JSON.stringify(rendered);
  });
}

function flatten(json: unknown): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (!json || typeof json !== "object" || Array.isArray(json)) return out;
  let count = 0;
  for (const [key, value] of Object.entries(json as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9_]+$/.test(key) || key === "status") continue;
    if (count >= MAX_KEYS) break;
    if (typeof value === "string") out[`webhook.${key}`] = value.slice(0, MAX_STRING);
    else if (typeof value === "number" && Number.isFinite(value)) out[`webhook.${key}`] = value;
    else if (typeof value === "boolean") out[`webhook.${key}`] = String(value);
    else continue;
    count += 1;
  }
  return out;
}

registerAction("webhook", {
  capability: "webhooks",
  async run(ctx, action): Promise<ActionResult> {
    if (action.type !== "webhook") return { ok: true };
    // Render, then validate the final URL: variables can't smuggle in a bad host.
    const url = renderTemplate(action.url, ctx.vars);
    const problem = webhookUrlRefusal(url);
    if (problem) return { ok: false, ...problem };
    // Dry run: no network call and no budget; the engine logs the step description.
    if (ctx.dryRun) return { ok: true };
    if (!takeBudget(ctx.event.hubId, "webhooks"))
      return { ok: false, ...refusal("bots.run.server.webhookLimit"), limited: true };
    const body = action.method === "POST" ? renderBody(action.body ?? "", ctx.vars) : undefined;
    const result = await guardedFetch(url, { method: action.method, body });
    if (!result.ok) return { ok: false, reason: result.reason, notice: result.notice };
    return { ok: true, vars: { ...flatten(result.json), "webhook.status": result.status } };
  },
});
