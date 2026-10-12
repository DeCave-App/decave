// A bot's rule drafts in the editor: client-side checks, 800 ms debounced
// autosave per rule, and merging fresh server state without losing local edits.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { validateRule, type BotRuleError } from "../../../shared/bots/schema.ts";
import type { BotRule } from "../../../shared/bots/types.ts";
import { BotApiError, type BotsApi, type BuilderBot, type BuilderRule, type PublishError } from "./api";
import { ruleContextFor, sameRule, type BotHub } from "./model.ts";

export const AUTOSAVE_MS = 800;

export type DraftStatus = "saved" | "pending" | "saving" | "invalid" | "failed";

export type LocalRule = {
  /** Stable React key; equals the rule id once saved. */
  key: string;
  id: string | null;
  enabled: boolean;
  draft: BotRule;
  /** The draft as the server has it (null until first saved). */
  saved: BotRule | null;
  published: BotRule | null;
  generated: boolean;
  status: DraftStatus;
  errors: BotRuleError[];
  message?: string;
};

let localKeys = 0;
const nextKey = () => `local-${++localKeys}`;

function check(draft: BotRule, hub: BotHub, ruleIds: string[]): BotRuleError[] {
  const result = validateRule(draft, ruleContextFor(hub, ruleIds));
  return result.ok ? [] : result.errors;
}

export function useRuleDrafts(api: BotsApi, bot: BuilderBot, hub: BotHub, onSaved: () => void) {
  const [rules, setRules] = useState<LocalRule[]>([]);
  const rulesRef = useRef(rules);
  rulesRef.current = rules;
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Saves in flight per rule: resolve to the rule id (null when the save failed).
  const inFlight = useRef(new Map<string, Promise<string | null>>());
  const hubRef = useRef(hub);
  hubRef.current = hub;

  const savedIds = () => rulesRef.current.flatMap((r) => (r.id ? [r.id] : []));

  const fromServer = useCallback(
    (s: BuilderRule, ids: string[], previous?: LocalRule): LocalRule => {
      const errors = check(s.draft, hub, ids);
      return {
        key: previous?.key ?? s.id,
        id: s.id,
        enabled: s.enabled,
        draft: s.draft,
        saved: s.draft,
        published: s.published,
        generated: previous?.generated ?? false,
        status: errors.length ? "invalid" : "saved",
        errors,
      };
    },
    [hub],
  );

  // Fresh server state: keep local edits that are not saved yet.
  useEffect(() => {
    const ids = bot.rules.map((r) => r.id);
    setRules((prev) => {
      const merged = bot.rules.map((s) => {
        const local = prev.find((r) => r.id === s.id);
        if (local && local.status !== "saved" && !sameRule(local.draft, s.draft))
          return { ...local, saved: s.draft, published: s.published, enabled: s.enabled };
        return fromServer(s, ids, local);
      });
      return [...merged, ...prev.filter((r) => r.id === null)];
    });
  }, [bot.rules, fromServer]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => clearTimeout(t));
  }, []);

  const patch = (key: string, change: Partial<LocalRule>) =>
    setRules((prev) => prev.map((r) => (r.key === key ? { ...r, ...change } : r)));

  const save = useCallback(
    (key: string): Promise<string | null> => {
      timers.current.delete(key);
      // One save per rule at a time, so a new rule is never created twice.
      const previous = inFlight.current.get(key) ?? Promise.resolve(null);
      const run = previous.then((earlierId) => saveNow(key, earlierId));
      inFlight.current.set(key, run);
      void run.finally(() => {
        if (inFlight.current.get(key) === run) inFlight.current.delete(key);
      });
      return run;
    },
    [api, bot.id, onSaved],
  );

  const saveNow = async (key: string, earlierId: string | null): Promise<string | null> => {
    const rule = rulesRef.current.find((r) => r.key === key);
    if (!rule) return earlierId;
    const id = rule.id ?? earlierId;
    const sent = rule.draft;
    patch(key, { status: "saving" });
    try {
      const { ruleId } = await api.saveRule(bot.id, id, sent);
      setRules((prev) =>
        prev.map((r) =>
          r.key === key
            ? {
                ...r,
                id: ruleId,
                saved: sent,
                status: sameRule(r.draft, sent) ? "saved" : r.status,
                message: undefined,
              }
            : r,
        ),
      );
      onSaved();
      return ruleId;
    } catch (error) {
      const errors = error instanceof BotApiError ? error.errors : [];
      patch(key, {
        status: errors.length ? "invalid" : "failed",
        errors,
        message: errors.length ? undefined : error instanceof Error ? error.message : "Could not save.",
      });
      return id;
    }
  };

  const schedule = (key: string, draft: BotRule) => {
    const existing = timers.current.get(key);
    if (existing) clearTimeout(existing);
    const errors = check(draft, hubRef.current, savedIds());
    if (errors.length) {
      timers.current.delete(key);
      return { status: "invalid" as const, errors };
    }
    timers.current.set(
      key,
      setTimeout(() => void save(key), AUTOSAVE_MS),
    );
    return { status: "pending" as const, errors: [] };
  };

  const edit = (key: string, draft: BotRule, generated?: boolean) => {
    const state = schedule(key, draft);
    patch(key, { draft, ...state, message: undefined, ...(generated === undefined ? {} : { generated }) });
  };

  const add = (draft: BotRule, generated = false) => {
    const key = nextKey();
    setRules((prev) => [
      ...prev,
      { key, id: null, enabled: true, draft, saved: null, published: null, generated, status: "pending", errors: [] },
    ]);
    // After the state update so the autosave sees the rule.
    setTimeout(() => {
      const state = schedule(key, draft);
      patch(key, state);
    }, 0);
    return key;
  };

  const remove = async (key: string) => {
    const rule = rulesRef.current.find((r) => r.key === key);
    if (!rule) return;
    const timer = timers.current.get(key);
    if (timer) clearTimeout(timer);
    timers.current.delete(key);
    // A first save still in flight would leave the new rule behind: wait for its id.
    const savedId = (await inFlight.current.get(key)) ?? null;
    const id = rule.id ?? savedId;
    if (id) await api.deleteRule(bot.id, id);
    setRules((prev) => prev.filter((r) => r.key !== key));
    if (id) onSaved();
  };

  const toggle = async (key: string) => {
    const rule = rulesRef.current.find((r) => r.key === key);
    if (!rule?.id) return;
    await api.setRuleEnabled(bot.id, rule.id, !rule.enabled);
    patch(key, { enabled: !rule.enabled });
    onSaved();
  };

  const move = async (key: string, delta: -1 | 1) => {
    const list = [...rulesRef.current];
    const from = list.findIndex((r) => r.key === key);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= list.length) return;
    const before = rulesRef.current;
    [list[from], list[to]] = [list[to], list[from]];
    setRules(list);
    const ids = list.flatMap((r) => (r.id ? [r.id] : []));
    if (ids.length > 1) {
      try {
        await api.reorder(bot.id, ids);
      } catch (error) {
        // Put the cards back where the server still has them.
        setRules(before);
        throw error;
      } finally {
        onSaved();
      }
    }
  };

  /** Publish errors come back tagged with the rule they belong to. */
  const showPublishErrors = (errors: PublishError[]) =>
    setRules((prev) =>
      prev.map((r) => {
        const mine = errors.filter((e) => e.ruleId === r.id);
        return mine.length ? { ...r, status: "invalid", errors: mine } : r;
      }),
    );

  const summary = useMemo(
    () => ({
      busy: rules.some((r) => r.status === "pending" || r.status === "saving"),
      invalid: rules.filter((r) => r.status === "invalid" || r.status === "failed").length,
      unsaved: rules.some((r) => r.id === null),
    }),
    [rules],
  );

  return { rules, edit, add, remove, toggle, move, showPublishErrors, summary };
}
