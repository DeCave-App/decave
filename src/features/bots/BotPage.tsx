// One builder bot: header with Publish, and the Rules / Test / Activity / Settings tabs.
import { useEffect, useMemo, useRef, useState } from "react";
import type { BotRule } from "../../../shared/bots/types.ts";
import { ActivityTab } from "./ActivityTab";
import { BotApiError, type BotsApi, type BuilderBot, type PublishError } from "./api";
import { CAPABILITY_LABELS, missingCapabilities, namesFor, ruleLabel, type BotHub } from "./model.ts";
import { RulesTab } from "./RulesTab";
import { SettingsTab } from "./SettingsTab";
import { TestTab } from "./TestTab";
import { useRuleDrafts } from "./useRuleDrafts";

type Tab = "rules" | "test" | "activity" | "settings";
const TABS: { id: Tab; label: string }[] = [
  { id: "rules", label: "Rules" },
  { id: "test", label: "Test" },
  { id: "activity", label: "Activity" },
  { id: "settings", label: "Settings" },
];

type Props = {
  api: BotsApi;
  bot: BuilderBot;
  hub: BotHub;
  ai: { available: boolean; remaining: number };
  onAiRemaining: (remaining: number) => void;
  /** AI drafts from "Describe it" to open as unsaved generated rules. */
  generated?: { rules: BotRule[]; unsupported: string[] };
  notice?: string;
  onBack: () => void;
  onReload: () => void;
  onBotChanged: (bot: BuilderBot) => void;
  onDeleted: () => void;
};

export function BotPage(props: Props) {
  const { api, bot, hub, ai } = props;
  const [tab, setTab] = useState<Tab>("rules");
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(
    props.notice ? { kind: "info", text: props.notice } : null,
  );
  const [unsupported, setUnsupported] = useState<string[]>(props.generated?.unsupported ?? []);
  const drafts = useRuleDrafts(api, bot, hub, props.onReload);

  // Generated drafts arrive once, when the page opens from "Describe it".
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !props.generated) return;
    seeded.current = true;
    for (const rule of props.generated.rules) drafts.add(rule, true);
  }, [props.generated]);

  const ruleIds = drafts.rules.flatMap((r) => (r.id ? [r.id] : []));
  const names = useMemo(() => namesFor(hub, ruleIds), [hub, ruleIds.join()]);
  const ruleLabels = useMemo(
    () => Object.fromEntries(drafts.rules.flatMap((r, i) => (r.id ? [[r.id, ruleLabel(i)]] : []))),
    [drafts.rules],
  );

  const missing = missingCapabilities(
    drafts.rules.map((r) => r.draft),
    bot.capabilities,
  );
  const allowMissing = async () => {
    try {
      props.onBotChanged(await api.update(bot.id, { capabilities: [...bot.capabilities, ...missing] }));
    } catch (caught) {
      setMessage({ kind: "error", text: caught instanceof Error ? caught.message : "Could not update the bot." });
    }
  };

  const resume = async () => {
    try {
      props.onBotChanged(await api.update(bot.id, { enabled: true }));
    } catch (caught) {
      setMessage({ kind: "error", text: caught instanceof Error ? caught.message : "Could not resume the bot." });
    }
  };

  const { busy, invalid, unsaved } = drafts.summary;
  const hasChanges = bot.hasUnpublishedChanges;
  const blockReason = invalid
    ? `${invalid} rule${invalid === 1 ? " needs" : "s need"} fixing`
    : busy
      ? "Saving…"
      : unsaved
        ? "Some rules aren't saved yet"
        : !hasChanges
          ? "Everything is published"
          : "";

  const publish = async () => {
    setPublishing(true);
    setMessage(null);
    try {
      props.onBotChanged(await api.publish(bot.id));
      setMessage({ kind: "info", text: "Published. The bot now runs these rules." });
    } catch (caught) {
      if (caught instanceof BotApiError && caught.errors.length) {
        drafts.showPublishErrors(caught.errors as PublishError[]);
        setTab("rules");
      }
      setMessage({ kind: "error", text: caught instanceof Error ? caught.message : "Could not publish." });
    } finally {
      setPublishing(false);
    }
  };

  const generate = async (description: string, ruleId?: string) => {
    setMessage(null);
    try {
      const result = await api.generate(description, ruleId);
      props.onAiRemaining(result.remainingToday);
      setUnsupported(result.unsupported);
      return result;
    } catch (caught) {
      if (caught instanceof BotApiError && caught.status === 429) props.onAiRemaining(0);
      const text =
        caught instanceof BotApiError && caught.status === 422
          ? "Couldn't build that, try rephrasing"
          : caught instanceof Error
            ? caught.message
            : "Couldn't build that, try rephrasing";
      setMessage({ kind: "error", text });
      return null;
    }
  };

  return (
    <div className="bb-page">
      <header className="bb-page-head">
        <button type="button" className="dcx-btn dcx-btn-sm dcx-btn-ghost" onClick={props.onBack}>
          ← Bots
        </button>
        <span className="bb-avatar" style={{ background: bot.color ?? undefined }} aria-hidden="true">
          {bot.avatarEmoji || "🤖"}
        </span>
        <span className="bb-page-title">
          <strong>{bot.name}</strong>
          <small>
            {!bot.enabled ? "Off" : hasChanges ? "Unpublished changes" : "Live"} · {drafts.rules.length} rule
            {drafts.rules.length === 1 ? "" : "s"}
          </small>
        </span>
        <span className="bb-publish">
          {blockReason && (hasChanges || invalid > 0) && <small className="bb-hint">{blockReason}</small>}
          <button
            type="button"
            className="dcx-btn dcx-btn-primary"
            disabled={Boolean(blockReason) || publishing}
            title={blockReason || "Make the drafts live"}
            onClick={() => void publish()}
          >
            {publishing ? "Publishing…" : "Publish"}
          </button>
        </span>
      </header>

      {message && (
        <p className={`dcx-notice ${message.kind === "error" ? "dcx-notice-error" : "dcx-notice-info"}`} role="status">
          {message.text}
        </p>
      )}

      {bot.pausedReason === "errors" && (
        <div className="dcx-notice dcx-notice-error bb-capability-notice" role="status">
          <span>Paused after repeated errors. Check Activity, fix the rules, then resume.</span>
          <button type="button" className="dcx-btn dcx-btn-sm" onClick={() => void resume()}>
            Resume
          </button>
        </div>
      )}

      {missing.length > 0 && (
        <div className="dcx-notice dcx-notice-warn bb-capability-notice" role="status">
          <span>
            These rules need the bot to be allowed to{" "}
            <strong>{missing.map((c) => CAPABILITY_LABELS[c].label.toLowerCase()).join(", ")}</strong>. Without it those
            actions fail.
          </span>
          <button type="button" className="dcx-btn dcx-btn-sm" onClick={() => void allowMissing()}>
            Allow
          </button>
        </div>
      )}

      <nav className="dcx-tabs bb-tabs" role="tablist" aria-label="Bot sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`dcx-tab${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "rules" && (
        <RulesTab drafts={drafts} names={names} hub={hub} ai={ai} unsupported={unsupported} onGenerate={generate} />
      )}
      {tab === "test" && (
        <TestTab api={api} botId={bot.id} rules={drafts.rules} names={names} textRooms={hub.textRooms} />
      )}
      {tab === "activity" && <ActivityTab api={api} botId={bot.id} ruleLabels={ruleLabels} />}
      {tab === "settings" && (
        <SettingsTab
          api={api}
          bot={bot}
          textRooms={hub.textRooms}
          onChanged={props.onBotChanged}
          onDeleted={props.onDeleted}
        />
      )}
    </div>
  );
}
