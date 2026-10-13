// Storage for builder bots: bots, rule drafts and published rules, slash
// commands, variables, run log, timers and AI usage. Everything takes a
// D1Database so the API, the engine and tests share one implementation.
//
// decave_hub_bots is created lazily by ensureHubFeatureSchema, so the tables
// here have no foreign key to it; deleteBot removes the children explicitly.

import { parseBotRunNotice, type BotRunNotice } from "../../shared/bots/run-notice.ts";
import { BOT_LIMITS, type BotRule, type BotVariableScope } from "../../shared/bots/types";
import { nowIso } from "../db";

export type BotRow = {
  id: string;
  hub_id: number;
  name: string;
  description: string;
  enabled: number;
  capabilities: string;
  allowed_room_ids: string;
  created_by: string;
  created_at: string;
  kind: "token" | "builder";
  color: string;
  avatar_emoji: string;
  published_by: string | null;
  failure_streak: number;
};

export type PublishedRule = { botId: string; ruleId: string; rule: BotRule; publishedBy: string | null };
export type BotRunStatus = "ok" | "error" | "limited" | "skipped";
export type BotRunRow = {
  id: number;
  bot_id: string;
  rule_id: string | null;
  trigger: string;
  status: BotRunStatus;
  detail: string;
  /** `detail` as a notice the bot builder renders in the viewer's language (null for older runs). */
  notice: BotRunNotice | null;
  created_at: string;
};
export type BotTimer = {
  key: string;
  hubId: number;
  roomId: number;
  botId: string;
  ruleId: string;
  fireAt: number;
  payload: Record<string, unknown>;
};

export type BotStoreErrorCode = "BOT_LIMIT" | "RULE_LIMIT" | "COMMAND_LIMIT" | "BOT_COMMAND_TAKEN" | "NOT_FOUND";

export class BotStoreError extends Error {
  readonly code: BotStoreErrorCode;
  constructor(code: BotStoreErrorCode) {
    super(code);
    this.name = "BotStoreError";
    this.code = code;
  }
}

const BOT_COLUMNS =
  "id,hub_id,name,description,enabled,capabilities,allowed_room_ids,created_by,created_at,kind,color,avatar_emoji,published_by,failure_streak";

export async function listBots(db: D1Database, hubId: number): Promise<BotRow[]> {
  const result = await db
    .prepare(`SELECT ${BOT_COLUMNS} FROM decave_hub_bots WHERE hub_id=? ORDER BY created_at DESC, id`)
    .bind(hubId)
    .all<BotRow>();
  return result.results;
}

export async function getBot(db: D1Database, hubId: number, botId: string): Promise<BotRow | null> {
  return db
    .prepare(`SELECT ${BOT_COLUMNS} FROM decave_hub_bots WHERE id=? AND hub_id=? LIMIT 1`)
    .bind(botId, hubId)
    .first<BotRow>();
}

export async function createBuilderBot(
  db: D1Database,
  input: { hubId: number; name: string; description: string; createdBy: string },
): Promise<BotRow> {
  const id = crypto.randomUUID();
  // The limit check and the insert are one statement so concurrent creates
  // cannot overshoot. token_hash is NOT NULL; 'builder:<id>' can never equal a
  // hex token hash, so no raw token authenticates a builder bot.
  const result = await db
    .prepare(
      `INSERT INTO decave_hub_bots(id,hub_id,name,description,token_hash,created_by,capabilities,allowed_room_ids,enabled,created_at,kind)
       SELECT ?,?,?,?,?,?,'["send_messages"]','[]',1,?,'builder'
       WHERE (SELECT COUNT(*) FROM decave_hub_bots WHERE hub_id=?) < ?`,
    )
    .bind(
      id,
      input.hubId,
      input.name,
      input.description,
      `builder:${id}`,
      input.createdBy,
      nowIso(),
      input.hubId,
      BOT_LIMITS.botsPerHub,
    )
    .run();
  if (!result.meta.changes) throw new BotStoreError("BOT_LIMIT");
  const bot = await getBot(db, input.hubId, id);
  if (!bot) throw new BotStoreError("NOT_FOUND");
  return bot;
}

export async function updateBotSettings(
  db: D1Database,
  hubId: number,
  botId: string,
  patch: {
    name?: string;
    description?: string;
    color?: string;
    avatarEmoji?: string;
    enabled?: boolean;
    capabilities?: string[];
    allowedRoomIds?: number[];
  },
): Promise<BotRow | null> {
  const bot = await getBot(db, hubId, botId);
  if (!bot) return null;
  const enabled = patch.enabled === undefined ? bot.enabled : patch.enabled ? 1 : 0;
  await db
    .prepare(
      `UPDATE decave_hub_bots SET name=?,description=?,color=?,avatar_emoji=?,enabled=?,capabilities=?,allowed_room_ids=?,
         failure_streak=CASE WHEN ?=1 AND enabled=0 THEN 0 ELSE failure_streak END
       WHERE id=? AND hub_id=?`,
    )
    .bind(
      patch.name ?? bot.name,
      patch.description ?? bot.description,
      patch.color ?? bot.color,
      patch.avatarEmoji ?? bot.avatar_emoji,
      enabled,
      patch.capabilities ? JSON.stringify(patch.capabilities) : bot.capabilities,
      patch.allowedRoomIds ? JSON.stringify(patch.allowedRoomIds) : bot.allowed_room_ids,
      enabled,
      botId,
      hubId,
    )
    .run();
  return getBot(db, hubId, botId);
}

export async function deleteBot(db: D1Database, hubId: number, botId: string): Promise<boolean> {
  const bot = await getBot(db, hubId, botId);
  if (!bot) return false;
  await db.batch([
    db.prepare("DELETE FROM decave_bot_rules WHERE bot_id=?").bind(botId),
    db.prepare("DELETE FROM decave_bot_commands WHERE bot_id=?").bind(botId),
    db.prepare("DELETE FROM decave_bot_runs WHERE bot_id=?").bind(botId),
    db.prepare("DELETE FROM decave_bot_timers WHERE bot_id=?").bind(botId),
    db.prepare("DELETE FROM decave_hub_bots WHERE id=? AND hub_id=?").bind(botId, hubId),
  ]);
  return true;
}

// Rules -------------------------------------------------------------------

export async function saveRuleDraft(
  db: D1Database,
  botId: string,
  ruleId: string | null,
  rule: BotRule,
  userId: string,
): Promise<string> {
  const bot = await db
    .prepare("SELECT hub_id FROM decave_hub_bots WHERE id=? AND kind='builder'")
    .bind(botId)
    .first<{ hub_id: number }>();
  if (!bot) throw new BotStoreError("NOT_FOUND");
  const now = nowIso();
  const draft = JSON.stringify(rule);
  if (ruleId) {
    const result = await db
      .prepare(
        "UPDATE decave_bot_rules SET draft_json=?,updated_by=?,updated_at=? WHERE id=? AND bot_id=? AND draft_deleted=0",
      )
      .bind(draft, userId, now, ruleId, botId)
      .run();
    if (!result.meta.changes) throw new BotStoreError("NOT_FOUND");
    return ruleId;
  }
  const id = crypto.randomUUID();
  const result = await db
    .prepare(
      `INSERT INTO decave_bot_rules(id,bot_id,hub_id,draft_json,position,draft_position,created_by,updated_by,created_at,updated_at)
       SELECT ?,?,?,?,n,n,?,?,?,?
       FROM (SELECT COALESCE(MAX(COALESCE(draft_position,position)),-1)+1 AS n FROM decave_bot_rules WHERE bot_id=?)
       WHERE (SELECT COUNT(*) FROM decave_bot_rules WHERE bot_id=? AND draft_deleted=0) < ?`,
    )
    .bind(id, botId, bot.hub_id, draft, userId, userId, now, now, botId, botId, BOT_LIMITS.rulesPerBot)
    .run();
  if (!result.meta.changes) throw new BotStoreError("RULE_LIMIT");
  return id;
}

/**
 * A rule that was never published is removed at once. A published rule is only
 * marked; publishBot removes it (and its slash command), so a deletion is a
 * draft change like any other edit.
 */
export async function deleteRule(db: D1Database, botId: string, ruleId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT published_json FROM decave_bot_rules WHERE bot_id=? AND id=? AND draft_deleted=0")
    .bind(botId, ruleId)
    .first<{ published_json: string | null }>();
  if (!row) return false;
  if (row.published_json) {
    await db.prepare("UPDATE decave_bot_rules SET draft_deleted=1 WHERE bot_id=? AND id=?").bind(botId, ruleId).run();
    return true;
  }
  await db.batch([
    db.prepare("DELETE FROM decave_bot_commands WHERE bot_id=? AND rule_id=?").bind(botId, ruleId),
    db.prepare("DELETE FROM decave_bot_rules WHERE bot_id=? AND id=?").bind(botId, ruleId),
    db
      .prepare("DELETE FROM decave_bot_timers WHERE bot_id=? AND rule_id=? AND key NOT LIKE 'role:%'")
      .bind(botId, ruleId),
  ]);
  return true;
}

/** Pausing or resuming one rule is an operational switch: it applies at once, without Publish. */
export async function setRuleEnabled(
  db: D1Database,
  botId: string,
  ruleId: string,
  enabled: boolean,
): Promise<boolean> {
  const result = await db
    .prepare("UPDATE decave_bot_rules SET enabled=? WHERE bot_id=? AND id=? AND draft_deleted=0")
    .bind(enabled ? 1 : 0, botId, ruleId)
    .run();
  return Boolean(result.meta.changes);
}

/** True when a deletion or reorder is waiting for Publish. */
export async function hasPendingStructureChanges(db: D1Database, botId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS found FROM decave_bot_rules WHERE bot_id=? AND
         (draft_deleted=1 OR (published_json IS NOT NULL AND draft_position IS NOT NULL AND draft_position<>position)) LIMIT 1`,
    )
    .bind(botId)
    .first<{ found: number }>();
  return Boolean(row);
}

/** Sets the draft order (applied by Publish); ids that do not belong to the bot are ignored. */
export async function reorderRules(db: D1Database, botId: string, ruleIds: string[]): Promise<void> {
  if (!ruleIds.length) return;
  await db.batch(
    ruleIds.map((ruleId, index) =>
      db.prepare("UPDATE decave_bot_rules SET draft_position=? WHERE id=? AND bot_id=?").bind(index, ruleId, botId),
    ),
  );
}

/** Parses a stored JSON column; a corrupt row is logged and skipped, never fatal. */
function parseStored<T>(json: string, label: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    console.warn(`bots: skipping malformed ${label}`);
    return null;
  }
}

export async function listDraftRules(
  db: D1Database,
  botId: string,
): Promise<{ ruleId: string; enabled: boolean; draft: BotRule; published: BotRule | null }[]> {
  const result = await db
    .prepare(
      "SELECT id,enabled,draft_json,published_json FROM decave_bot_rules WHERE bot_id=? AND draft_deleted=0 ORDER BY COALESCE(draft_position,position),created_at",
    )
    .bind(botId)
    .all<{ id: string; enabled: number; draft_json: string; published_json: string | null }>();
  return result.results.flatMap((row) => {
    const draft = parseStored<BotRule>(row.draft_json, `rule ${row.id} draft`);
    if (!draft) return [];
    const published = row.published_json ? parseStored<BotRule>(row.published_json, `rule ${row.id}`) : null;
    return [{ ruleId: row.id, enabled: row.enabled === 1, draft, published }];
  });
}

/** Copies every draft to its published slot, applies pending deletions and ordering, and rewrites the bot's slash commands. */
export async function publishBot(db: D1Database, botId: string, userId: string): Promise<void> {
  const bot = await db
    .prepare("SELECT hub_id FROM decave_hub_bots WHERE id=? AND kind='builder'")
    .bind(botId)
    .first<{ hub_id: number }>();
  if (!bot) throw new BotStoreError("NOT_FOUND");
  const rules = await listDraftRules(db, botId);
  const commands = rules.flatMap(({ ruleId, draft }) =>
    draft.trigger.type === "command" ? [{ ruleId, name: draft.trigger.name }] : [],
  );
  const others = await db
    .prepare("SELECT COUNT(*) AS n FROM decave_bot_commands WHERE hub_id=? AND bot_id<>?")
    .bind(bot.hub_id, botId)
    .first<{ n: number }>();
  if ((others?.n ?? 0) + commands.length > BOT_LIMITS.commandsPerHub) throw new BotStoreError("COMMAND_LIMIT");
  const now = nowIso();
  try {
    await db.batch([
      db.prepare("DELETE FROM decave_bot_rules WHERE bot_id=? AND draft_deleted=1").bind(botId),
      db
        .prepare(
          "UPDATE decave_bot_rules SET published_json=draft_json,published_by=?,updated_at=?,position=COALESCE(draft_position,position) WHERE bot_id=?",
        )
        .bind(userId, now, botId),
      db.prepare("DELETE FROM decave_bot_commands WHERE bot_id=?").bind(botId),
      ...commands.map((command) =>
        db
          .prepare("INSERT INTO decave_bot_commands(hub_id,name,bot_id,rule_id) VALUES(?,?,?,?)")
          .bind(bot.hub_id, command.name, botId, command.ruleId),
      ),
      db.prepare("UPDATE decave_hub_bots SET published_by=? WHERE id=?").bind(userId, botId),
    ]);
  } catch (error) {
    // The batch is atomic: a clash with another bot's command rolls everything back.
    if (error instanceof Error && /UNIQUE|constraint/i.test(error.message))
      throw new BotStoreError("BOT_COMMAND_TAKEN");
    throw error;
  }
}

/** Published rules of the hub's enabled builder bots (paused bots do not run). */
export async function listPublishedRules(db: D1Database, hubId: number): Promise<PublishedRule[]> {
  const result = await db
    .prepare(
      `SELECT r.bot_id,r.id,r.published_json,r.published_by FROM decave_bot_rules r
       JOIN decave_hub_bots b ON b.id=r.bot_id
       WHERE r.hub_id=? AND r.published_json IS NOT NULL AND b.enabled=1 AND r.enabled=1 AND b.kind='builder'
       ORDER BY r.bot_id,r.position`,
    )
    .bind(hubId)
    .all<{ bot_id: string; id: string; published_json: string; published_by: string | null }>();
  return result.results.flatMap((row) => {
    const rule = parseStored<BotRule>(row.published_json, `rule ${row.id}`);
    return rule ? [{ botId: row.bot_id, ruleId: row.id, rule, publishedBy: row.published_by }] : [];
  });
}

// Variables ---------------------------------------------------------------

export async function getVariable(
  db: D1Database,
  hubId: number,
  name: string,
  scope: BotVariableScope,
  userId: string | null,
): Promise<string | number | null> {
  const row = await db
    .prepare("SELECT type,value FROM decave_bot_variables WHERE hub_id=? AND name=? AND scope=? AND user_id=?")
    .bind(hubId, name, scope, scope === "user" ? (userId ?? "") : "")
    .first<{ type: string; value: string }>();
  if (!row) return null;
  return row.type === "number" ? Number(row.value) : row.value;
}

/** Returns false when a new variable name would exceed the hub's limit. */
export async function setVariable(
  db: D1Database,
  hubId: number,
  name: string,
  scope: BotVariableScope,
  userId: string | null,
  value: string | number,
): Promise<boolean> {
  const owner = scope === "user" ? (userId ?? "") : "";
  const type = typeof value === "number" ? "number" : "text";
  const known = await db
    .prepare("SELECT 1 AS found FROM decave_bot_variables WHERE hub_id=? AND name=? AND scope=? LIMIT 1")
    .bind(hubId, name, scope)
    .first<{ found: number }>();
  if (!known && (await countVariableNames(db, hubId)) >= BOT_LIMITS.variablesPerHub) return false;
  await db
    .prepare(
      `INSERT INTO decave_bot_variables(hub_id,name,scope,user_id,type,value) VALUES(?,?,?,?,?,?)
       ON CONFLICT(hub_id,name,scope,user_id) DO UPDATE SET type=excluded.type,value=excluded.value`,
    )
    .bind(hubId, name, scope, owner, type, String(value))
    .run();
  return true;
}

export async function deleteVariable(
  db: D1Database,
  hubId: number,
  name: string,
  scope: BotVariableScope,
  userId: string | null,
): Promise<void> {
  await db
    .prepare("DELETE FROM decave_bot_variables WHERE hub_id=? AND name=? AND scope=? AND user_id=?")
    .bind(hubId, name, scope, scope === "user" ? (userId ?? "") : "")
    .run();
}

export async function countVariableNames(db: D1Database, hubId: number): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM (SELECT DISTINCT name,scope FROM decave_bot_variables WHERE hub_id=?)")
    .bind(hubId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// Run log -----------------------------------------------------------------

/** Migration 0092 adds decave_bot_runs.detail_notice; until it runs, runs are logged without it. */
let runNoticeColumn: boolean | null = null;

async function hasRunNoticeColumn(db: D1Database): Promise<boolean> {
  if (runNoticeColumn !== null) return runNoticeColumn;
  try {
    const columns = await db.prepare("PRAGMA table_info(decave_bot_runs)").all<{ name: string }>();
    runNoticeColumn = columns.results.some((column) => column.name === "detail_notice");
  } catch {
    return false;
  }
  return runNoticeColumn;
}

export async function logRun(
  db: D1Database,
  run: {
    botId: string;
    ruleId: string | null;
    trigger: string;
    status: BotRunStatus;
    detail: string;
    notice?: BotRunNotice | null;
  },
): Promise<void> {
  const notice = run.notice ? JSON.stringify(run.notice) : null;
  const withNotice = notice !== null && notice.length <= 2000 && (await hasRunNoticeColumn(db));
  const statements = [
    withNotice
      ? db
          .prepare(
            `INSERT INTO decave_bot_runs(hub_id,bot_id,rule_id,trigger,status,detail,detail_notice,created_at)
             SELECT hub_id,?,?,?,?,?,?,? FROM decave_hub_bots WHERE id=?`,
          )
          .bind(run.botId, run.ruleId, run.trigger, run.status, run.detail.slice(0, 500), notice, nowIso(), run.botId)
      : db
          .prepare(
            `INSERT INTO decave_bot_runs(hub_id,bot_id,rule_id,trigger,status,detail,created_at)
             SELECT hub_id,?,?,?,?,?,? FROM decave_hub_bots WHERE id=?`,
          )
          .bind(run.botId, run.ruleId, run.trigger, run.status, run.detail.slice(0, 500), nowIso(), run.botId),
  ];
  if (run.status === "ok") {
    statements.push(db.prepare("UPDATE decave_hub_bots SET failure_streak=0 WHERE id=?").bind(run.botId));
  } else if (run.status === "error") {
    statements.push(
      db
        .prepare(
          `UPDATE decave_hub_bots SET failure_streak=failure_streak+1,
             enabled=CASE WHEN failure_streak+1>=? THEN 0 ELSE enabled END
           WHERE id=?`,
        )
        .bind(BOT_LIMITS.autoPauseFailures, run.botId),
    );
  }
  await db.batch(statements);
}

export async function listRuns(
  db: D1Database,
  botId: string,
  options: { errorsOnly?: boolean; limit?: number } = {},
): Promise<BotRunRow[]> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 200);
  const noticeColumn = (await hasRunNoticeColumn(db)) ? "detail_notice" : "NULL AS detail_notice";
  const result = await db
    .prepare(
      `SELECT id,bot_id,rule_id,trigger,status,detail,${noticeColumn},created_at FROM decave_bot_runs
       WHERE bot_id=? ${options.errorsOnly ? "AND status='error'" : ""} ORDER BY id DESC LIMIT ?`,
    )
    .bind(botId, limit)
    .all<Omit<BotRunRow, "notice"> & { detail_notice: string | null }>();
  return result.results.map(({ detail_notice, ...row }) => ({ ...row, notice: parseBotRunNotice(detail_notice) }));
}

// Timers ------------------------------------------------------------------

export async function putTimer(db: D1Database, timer: BotTimer): Promise<void> {
  await db
    .prepare(
      "INSERT OR IGNORE INTO decave_bot_timers(key,hub_id,room_id,bot_id,rule_id,fire_at,payload_json) VALUES(?,?,?,?,?,?,?)",
    )
    .bind(timer.key, timer.hubId, timer.roomId, timer.botId, timer.ruleId, timer.fireAt, JSON.stringify(timer.payload))
    .run();
}

/** Atomically removes and returns the room's timers that are due. */
export async function takeDueTimers(db: D1Database, roomId: number, now: number): Promise<BotTimer[]> {
  const result = await db
    .prepare(
      `DELETE FROM decave_bot_timers WHERE room_id=? AND fire_at<=?
       RETURNING key,hub_id,room_id,bot_id,rule_id,fire_at,payload_json`,
    )
    .bind(roomId, now)
    .all<{
      key: string;
      hub_id: number;
      room_id: number;
      bot_id: string;
      rule_id: string;
      fire_at: number;
      payload_json: string;
    }>();
  // Rows are already claimed: a bad payload drops only its own timer.
  return result.results
    .flatMap((row) => {
      const payload = parseStored<Record<string, unknown>>(row.payload_json, `timer ${row.key}`);
      if (!payload) return [];
      return [
        {
          key: row.key,
          hubId: row.hub_id,
          roomId: row.room_id,
          botId: row.bot_id,
          ruleId: row.rule_id,
          fireAt: row.fire_at,
          payload,
        },
      ];
    })
    .sort((a, b) => a.fireAt - b.fireAt);
}

export async function nextTimerAt(db: D1Database, roomId: number): Promise<number | null> {
  const row = await db
    .prepare("SELECT MIN(fire_at) AS at FROM decave_bot_timers WHERE room_id=?")
    .bind(roomId)
    .first<{ at: number | null }>();
  return row?.at ?? null;
}

/** Earliest timer of any room (one Durable Object hosts every room's alarm). */
export async function nextTimerAtAnyRoom(db: D1Database): Promise<number | null> {
  const row = await db.prepare("SELECT MIN(fire_at) AS at FROM decave_bot_timers").first<{ at: number | null }>();
  return row?.at ?? null;
}

export async function dueTimerRoomIds(db: D1Database, now: number): Promise<number[]> {
  const result = await db
    .prepare("SELECT DISTINCT room_id FROM decave_bot_timers WHERE fire_at<=? ORDER BY room_id")
    .bind(now)
    .all<{ room_id: number }>();
  return result.results.map((row) => Number(row.room_id));
}

/**
 * On publish: removes the bot's schedule timers (re-created from the new
 * rules) and waits whose rule no longer exists. Role reverts are kept so
 * temporary roles still expire.
 */
export async function deleteStaleRuleTimers(db: D1Database, botId: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM decave_bot_timers WHERE bot_id=? AND key LIKE 'sched:%'").bind(botId),
    db
      .prepare(
        `DELETE FROM decave_bot_timers WHERE bot_id=? AND key LIKE 'wait:%'
         AND rule_id NOT IN (SELECT id FROM decave_bot_rules WHERE bot_id=? AND published_json IS NOT NULL)`,
      )
      .bind(botId, botId),
  ]);
}

// AI usage ----------------------------------------------------------------

export async function incrementAiUsage(db: D1Database, hubId: number, day: string): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO decave_bot_ai_usage(hub_id,day,count) VALUES(?,?,1)
       ON CONFLICT(hub_id,day) DO UPDATE SET count=count+1 RETURNING count`,
    )
    .bind(hubId, day)
    .first<{ count: number }>();
  return row?.count ?? 1;
}

/**
 * Atomically takes one of the day's generations: null when `limit` are already
 * used, else the new count. Concurrent callers cannot both take the last slot.
 */
export async function reserveAiUsage(
  db: D1Database,
  hubId: number,
  day: string,
  limit: number,
): Promise<number | null> {
  const row = await db
    .prepare(
      `INSERT INTO decave_bot_ai_usage(hub_id,day,count) VALUES(?,?,1)
       ON CONFLICT(hub_id,day) DO UPDATE SET count=count+1 WHERE count<? RETURNING count`,
    )
    .bind(hubId, day, limit)
    .first<{ count: number }>();
  return row ? row.count : null;
}

/** Gives back a reservation when the provider was never called. */
export async function releaseAiUsage(db: D1Database, hubId: number, day: string): Promise<void> {
  await db
    .prepare("UPDATE decave_bot_ai_usage SET count=count-1 WHERE hub_id=? AND day=? AND count>0")
    .bind(hubId, day)
    .run();
}

export async function aiUsageOn(db: D1Database, hubId: number, day: string): Promise<number> {
  const row = await db
    .prepare("SELECT count FROM decave_bot_ai_usage WHERE hub_id=? AND day=?")
    .bind(hubId, day)
    .first<{ count: number }>();
  return row?.count ?? 0;
}
