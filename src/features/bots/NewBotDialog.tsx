// "New bot": start from a template, describe it to the AI helper, start from
// scratch, or import an exported bot file.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { BotRule } from "../../../shared/bots/types.ts";
import { i18next } from "../../i18n/index.ts";
import { useDialogA11y } from "../shared/useDialogA11y";
import { BotApiError, type BotTemplateSummary, type BotsApi, type BuilderBot } from "./api";
import { DescribeBox } from "./DescribeBox";

export type Created = {
  bot: BuilderBot;
  generated?: { rules: BotRule[]; unsupported: string[] };
  notice?: string;
};

type Props = {
  api: BotsApi;
  templates: BotTemplateSummary[];
  ai: { available: boolean; remaining: number };
  onAiRemaining: (remaining: number) => void;
  onCreated: (created: Created) => void;
  onClose: () => void;
};

const TEMPLATE_ICONS: Record<string, string> = {
  welcome: "👋",
  reactionRoles: "✅",
  polls: "📊",
  reminders: "⏰",
  dice: "🎲",
};

const MAX_IMPORT_BYTES = 256 * 1024;

function messageFor(caught: unknown): string {
  if (caught instanceof BotApiError) {
    // 422: the AI answer was unusable; rule errors come from an import file.
    if (caught.status === 422) return i18next.t("bots.page.buildFailed");
    if (caught.errors.length)
      return i18next.t("bots.newBot.fileProblems", {
        count: caught.errors.length,
        path: caught.errors[0].path,
        message: caught.errors[0].message,
      });
  }
  return caught instanceof Error ? caught.message : i18next.t("bots.newBot.genericError");
}

/** A short bot name from the first words of a description. */
function nameFrom(description: string): string {
  const words = description
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(" ");
  return (words ? `${words[0].toUpperCase()}${words.slice(1)}` : i18next.t("bots.section.newBot")).slice(0, 32);
}

export function NewBotDialog({ api, templates, ai, onAiRemaining, onCreated, onClose }: Props) {
  const { t } = useTranslation(["bots"]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [scratchName, setScratchName] = useState("");
  const ref = useDialogA11y<HTMLDivElement>(busy ? null : onClose);

  const attempt = async (key: string, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setError("");
    try {
      await work();
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy("");
    }
  };

  const importFile = (file: File) =>
    attempt("import", async () => {
      if (file.size > MAX_IMPORT_BYTES) throw new Error(t("bots.newBot.fileTooLarge"));
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new Error(t("bots.newBot.fileInvalid"));
      }
      const { bot, unresolved } = await api.importBot(parsed);
      onCreated({
        bot,
        notice: unresolved.length
          ? t("bots.newBot.importedUnresolved", { names: unresolved.join(", ") })
          : t("bots.newBot.imported"),
      });
    });

  return (
    <div className="dcx-confirm-overlay bb-dialog-overlay">
      <div ref={ref} className="bb-dialog" role="dialog" aria-modal="true" aria-labelledby="bb-new-title" tabIndex={-1}>
        <header className="bb-dialog-head">
          <h2 id="bb-new-title">{t("bots.section.newBot")}</h2>
          <button
            type="button"
            className="dcx-btn dcx-btn-sm dcx-btn-ghost"
            aria-label={t("bots.newBot.close")}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {error && <p className="dcx-notice dcx-notice-error">{error}</p>}

        <section className="bb-new-section">
          <h3>{t("bots.newBot.templates")}</h3>
          <div className="bb-templates">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                className="bb-template-card"
                disabled={Boolean(busy)}
                onClick={() =>
                  attempt(`template:${template.id}`, async () => {
                    onCreated({
                      bot: await api.create(template.name, template.id),
                      notice: t("bots.newBot.createdFromTemplate"),
                    });
                  })
                }
              >
                <span className="bb-template-icon" aria-hidden="true">
                  {TEMPLATE_ICONS[template.id] ?? "🤖"}
                </span>
                <strong>{busy === `template:${template.id}` ? t("bots.newBot.creating") : template.name}</strong>
                <small>{template.description}</small>
              </button>
            ))}
          </div>
        </section>

        {ai.available && (
          <section className="bb-new-section">
            <h3>{t("bots.newBot.describe")}</h3>
            <DescribeBox
              remaining={ai.remaining}
              placeholder={t("bots.newBot.describePlaceholder")}
              onSubmit={(description) =>
                attempt("describe", async () => {
                  let result;
                  try {
                    result = await api.generate(description);
                  } catch (caught) {
                    if (caught instanceof BotApiError && caught.status === 429) onAiRemaining(0);
                    throw caught;
                  }
                  onAiRemaining(result.remainingToday);
                  const bot = await api.create(nameFrom(description));
                  onCreated({ bot, generated: { rules: result.rules, unsupported: result.unsupported } });
                })
              }
            />
          </section>
        )}

        <section className="bb-new-section bb-new-row">
          <form
            className="bb-scratch"
            onSubmit={(e) => {
              e.preventDefault();
              const name = scratchName.trim();
              if (name) void attempt("scratch", async () => onCreated({ bot: await api.create(name) }));
            }}
          >
            <h3>{t("bots.newBot.scratch")}</h3>
            <span className="bb-inline">
              <input
                className="dcx-input"
                aria-label={t("bots.newBot.name")}
                placeholder={t("bots.newBot.name")}
                maxLength={32}
                value={scratchName}
                onChange={(e) => setScratchName(e.target.value)}
              />
              <button type="submit" className="dcx-btn dcx-btn-sm" disabled={!scratchName.trim() || Boolean(busy)}>
                {t("bots.newBot.create")}
              </button>
            </span>
          </form>
          <div className="bb-import">
            <h3>{t("bots.newBot.import")}</h3>
            <label className="dcx-btn dcx-btn-sm">
              {busy === "import" ? t("bots.newBot.importing") : t("bots.newBot.chooseFile")}
              <input
                type="file"
                accept="application/json,.json"
                className="dcx-sr-only"
                disabled={Boolean(busy)}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.currentTarget.value = "";
                  if (file) void importFile(file);
                }}
              />
            </label>
          </div>
        </section>
      </div>
    </div>
  );
}
