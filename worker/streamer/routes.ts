import {
  DEFAULT_STREAMER_CONFIG,
  StreamerInputError,
  configInput,
  futureDate,
  identifier,
  integer,
  isCreator,
  objectBody,
  sessionInput,
  text,
  unbiasedIndex,
  type CommunitySession,
  type Giveaway,
  type HubLayout,
  type HubRole,
  type QueueEntry,
  type QueuePage,
  type StreamerConfig,
  type StreamerSnapshot,
  type StreamerStats,
} from "../../shared/streamer-mode";
import type { Admission, Database, Statement, StreamerDependencies } from "./types";

export const STREAMER_MIGRATION_ID = "0043_streamer_mode";

/**
 * Treat the migration's hub table as the capability marker.  Never create
 * streamer tables lazily: a missing or partially applied migration must leave
 * the feature disabled and give the operator enough context to repair D1.
 */
export async function streamerMigrationExists(db: Database): Promise<boolean> {
  try {
    const row = await db
      .prepare("SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name='decave_streamer_hubs' LIMIT 1")
      .first<{ found: number }>();
    if (row?.found === 1) return true;
    console.error(
      `Streamer Mode migration ${STREAMER_MIGRATION_ID} is missing; Streamer Mode remains disabled. Apply the migration before enabling STREAMER_HUBS_ENABLED.`,
    );
    return false;
  } catch (error) {
    console.error(
      `Could not verify Streamer Mode migration ${STREAMER_MIGRATION_ID}; Streamer Mode remains disabled. Check D1 migration history and the decave_streamer_hubs table.`,
      error instanceof Error ? error.name : "UnknownError",
    );
    return false;
  }
}

const SESSION_COLUMNS = `id,title,game,status,party_size AS partySize,
  ready_seconds AS readySeconds,created_at AS createdAt,version`;
const ENTRY_COLUMNS = `q.id,u.username AS name,q.status,q.joined_at AS joinedAt,
  q.call_expires_at AS callExpiresAt`;
const ACTIVE = "('waiting','called','ready','playing')";
const MAX_QUEUE = 1000;
const MAX_BODY = 16 * 1024;
function reply(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new StreamerInputError("Use application/json.", 415);
  }
  if (Number(request.headers.get("content-length")) > MAX_BODY) throw new StreamerInputError("Request too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) return {};
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY) {
        await reader.cancel();
        throw new StreamerInputError("Request too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return objectBody(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch (error) {
    if (error instanceof StreamerInputError) throw error;
    throw new StreamerInputError("Malformed JSON.");
  }
}
function statement<D extends Database>(
  db: D,
  sql: string,
  ...args: (string | number | null)[]
): ReturnType<D["prepare"]> {
  // D1 bind returns a prepared statement from the same binding. Preserve that concrete
  // type so public factory helpers fit the host's existing D1PreparedStatement[] batches.
  return db.prepare(sql).bind(...args) as ReturnType<D["prepare"]>;
}
async function one<T>(db: Database, sql: string, ...args: (string | number | null)[]): Promise<T | null> {
  return statement(db, sql, ...args).first<T>();
}
async function all<T>(db: Database, sql: string, ...args: (string | number | null)[]): Promise<T[]> {
  return (await statement(db, sql, ...args).all<T>()).results;
}
function requireCreator(admission: Admission): void {
  if (!isCreator(admission.role)) throw new StreamerInputError("Creator permission required.", 403);
}
function changed(count: number | undefined, message = "The state changed. Refresh and try again."): void {
  if (!count) throw new StreamerInputError(message, 409);
}

/** Append to the SAME existing CREATE HUB D1 batch when template === 'streamer'. */
export function streamerHubCreationStatement<D extends Database>(
  db: D,
  hubId: number,
  now: string,
): ReturnType<D["prepare"]> {
  return statement(
    db,
    `INSERT INTO decave_streamer_hubs(hub_id,config_json,version,created_at,updated_at)
    VALUES(?,'{}',1,?,?)`,
    hubId,
    now,
    now,
  );
}
/** Serializer hook for hubForUser. Gate this call off until the migration is applied. */
export async function streamerLayoutForHub(db: Database, hubId: number): Promise<HubLayout> {
  return (await one(db, "SELECT 1 FROM decave_streamer_hubs WHERE hub_id=?", hubId)) ? "streamer" : "standard";
}
/** Batched list variant avoids one layout query per hub in /api/servers. */
export async function streamerHubIdsForUser(db: Database, userId: string): Promise<Set<number>> {
  const rows = await all<{ hub_id: number }>(
    db,
    `SELECT s.hub_id FROM decave_streamer_hubs s
    JOIN decave_hub_members m ON m.hub_id=s.hub_id WHERE m.user_id=?`,
    userId,
  );
  return new Set(rows.map((row) => row.hub_id));
}
async function auditMutation(
  deps: StreamerDependencies,
  mutation: Statement,
  admission: Admission,
  hubId: number,
  action: string,
  target: string,
  stamp: string,
): Promise<number> {
  // changes() refers to the preceding statement on the SAME batch connection. No-op
  // mutations do not fabricate audit entries. Both changes and audit roll back together.
  const id = (deps.id ?? (() => crypto.randomUUID()))();
  const results = await deps.db.batch([
    mutation,
    statement(
      deps.db,
      `INSERT INTO decave_streamer_audit(id,hub_id,actor_user_id,action,target_id,created_at)
     SELECT ?,?,?,?,?,? WHERE changes() > 0`,
      id,
      hubId,
      admission.principal.id,
      action,
      target,
      stamp,
    ),
  ]);
  return results[0].meta.changes ?? 0;
}
async function activeSession(db: Database, hubId: number): Promise<CommunitySession | null> {
  return one<CommunitySession>(
    db,
    `SELECT ${SESSION_COLUMNS} FROM decave_streamer_sessions
    WHERE hub_id=? AND status!='ended' LIMIT 1`,
    hubId,
  );
}
function normaliseEntry(entry: QueueEntry, now: number): QueueEntry {
  if (entry.status === "called" && entry.callExpiresAt && Date.parse(entry.callExpiresAt) <= now) {
    return { ...entry, status: "skipped", position: null };
  }
  return entry;
}
async function readSnapshot(
  deps: StreamerDependencies,
  admission: Admission,
  hubId: number,
  now: number,
): Promise<StreamerSnapshot> {
  const db = deps.db;
  const row = await one<{ config_json: string; version: number }>(
    db,
    "SELECT config_json,version FROM decave_streamer_hubs WHERE hub_id=?",
    hubId,
  );
  if (!row) throw new StreamerInputError("Streamer Mode is not enabled for this Hub.", 404);
  const storedConfig = JSON.parse(row.config_json) as Record<string, unknown>;
  // Older settings may contain a provider link; never return it from this API.
  delete storedConfig.streamUrl;
  const config = { ...DEFAULT_STREAMER_CONFIG, ...storedConfig, version: row.version } as StreamerConfig;
  const session = await activeSession(db, hubId);
  const stamp = new Date(now).toISOString();
  const queue = { waiting: 0, called: 0, ready: 0, playing: 0, mine: null as QueueEntry | null };
  if (session) {
    const counts = await all<{ status: string; n: number }>(
      db,
      `SELECT status,COUNT(*) AS n FROM decave_streamer_queue WHERE session_id=?
       AND (status!='called' OR call_expires_at>?) GROUP BY status`,
      session.id,
      stamp,
    );
    for (const count of counts) {
      if (
        count.status === "waiting" ||
        count.status === "called" ||
        count.status === "ready" ||
        count.status === "playing"
      )
        queue[count.status] = count.n;
    }
    const entry = await one<QueueEntry>(
      db,
      `SELECT ${ENTRY_COLUMNS}, CASE WHEN q.status='waiting' THEN
       (SELECT COUNT(*) FROM decave_streamer_queue p WHERE p.session_id=q.session_id AND p.status='waiting' AND p.seq<=q.seq)
       ELSE NULL END AS position FROM decave_streamer_queue q JOIN decave_users u ON u.id=q.user_id
       WHERE q.session_id=? AND q.user_id=?`,
      session.id,
      admission.principal.id,
    );
    queue.mine = entry ? normaliseEntry(entry, now) : null;
  }
  let giveaways: Giveaway[] = [];
  if (deps.giveawaysEnabled) {
    giveaways = await all<Giveaway>(
      db,
      `SELECT g.id,g.title,g.rules,g.closes_at AS closesAt,g.status,
      (SELECT COUNT(*) FROM decave_streamer_giveaway_entries e WHERE e.giveaway_id=g.id) AS entryCount,
      EXISTS(SELECT 1 FROM decave_streamer_giveaway_entries e WHERE e.giveaway_id=g.id AND e.user_id=?) AS entered,
      u.username AS winnerName,(g.winner_user_id=?) AS isWinner FROM decave_streamer_giveaways g LEFT JOIN decave_users u ON u.id=g.winner_user_id
      WHERE g.hub_id=? ORDER BY CASE WHEN g.status='open' THEN 0 ELSE 1 END,g.created_at DESC,g.id DESC LIMIT 5`,
      admission.principal.id,
      admission.principal.id,
      hubId,
    );
    // Private-membership Hubs (DeCave Official) must not reveal other members' names.
    let membershipPrivate = false;
    if (!isCreator(admission.role)) {
      try {
        membershipPrivate = Boolean(
          (
            await one<{ p: number }>(
              db,
              "SELECT membership_private AS p FROM decave_official_hubs WHERE hub_id=?",
              hubId,
            )
          )?.p,
        );
      } catch {
        membershipPrivate = true;
      }
    }
    giveaways = (giveaways as Array<Giveaway & { isWinner?: unknown }>).map(({ isWinner, ...g }) => ({
      ...g,
      entered: Boolean(g.entered),
      winnerName: membershipPrivate && !isWinner ? null : g.winnerName,
    }));
  }
  let stats: StreamerStats | undefined;
  if (isCreator(admission.role)) {
    const cutoff = new Date(now - 7 * 86_400_000).toISOString();
    const members = await one<{ n: number; joined: number }>(
      db,
      "SELECT COUNT(*) AS n,COALESCE(SUM(joined_at>=?),0) AS joined FROM decave_hub_members WHERE hub_id=?",
      cutoff,
      hubId,
    );
    const sessions = await one<{ n: number }>(
      db,
      "SELECT COUNT(*) AS n FROM decave_streamer_sessions WHERE hub_id=? AND created_at>=?",
      hubId,
      cutoff,
    );
    const players = await one<{ n: number; completed: number }>(
      db,
      `SELECT COUNT(DISTINCT user_id) AS n,COALESCE(SUM(status='done'),0) AS completed
       FROM decave_streamer_queue WHERE hub_id=? AND status IN ('ready','playing','done') AND joined_at>=?`,
      hubId,
      cutoff,
    );
    stats = {
      memberCount: members?.n ?? 0,
      joinedLast7Days: members?.joined ?? 0,
      sessionsLast7Days: sessions?.n ?? 0,
      playersLast7Days: players?.n ?? 0,
      seatsCompletedLast7Days: players?.completed ?? 0,
    };
  }
  return {
    enabled: true,
    role: admission.role,
    config,
    session,
    queue,
    giveaways,
    ...(stats ? { stats } : {}),
    features: { giveaways: deps.giveawaysEnabled },
    serverTime: stamp,
  };
}

/** Returns null only for routes outside /api/servers/:id/streamer. Does not add CORS
 * exceptions or bypass the host's security middleware. Deploy behind the host router. */
export async function handleStreamerRequest(request: Request, deps: StreamerDependencies): Promise<Response | null> {
  const url = new URL(request.url);
  const match = /^\/api\/servers\/(\d+)\/streamer(?:\/(.*))?$/.exec(url.pathname);
  if (!match) return null;
  if (!deps.enabled) return reply({ error: "Not found." }, 404);
  if (
    typeof deps.authenticate !== "function" ||
    typeof deps.guardMutation !== "function" ||
    typeof deps.guardHubAccess !== "function"
  ) {
    return reply({ error: "Streamer integration security hooks are unavailable." }, 503);
  }
  try {
    const hubId = integer(Number(match[1]), "Hub ID", 1, Number.MAX_SAFE_INTEGER);
    const principal = await deps.authenticate(request);
    if (principal instanceof Response) return principal;
    const role = await one<{ role: HubRole }>(
      deps.db,
      "SELECT role FROM decave_hub_members WHERE hub_id=? AND user_id=?",
      hubId,
      principal.id,
    );
    if (!role || !["owner", "admin", "member"].includes(role.role)) return reply({ error: "Hub not found." }, 404);
    const access = await deps.guardHubAccess(request, hubId, principal.id);
    if (access) return access;
    const admission: Admission = { principal, role: role.role };
    const path = match[2] ?? "";
    const now = (deps.now ?? Date.now)();
    const stamp = new Date(now).toISOString();
    const db = deps.db;
    const newId = deps.id ?? (() => crypto.randomUUID());

    if (request.method === "GET" && path === "") return reply(await readSnapshot(deps, admission, hubId, now));
    if (request.method === "GET" && path === "queue") {
      requireCreator(admission);
      const session = await activeSession(db, hubId);
      if (!session) return reply({ entries: [], nextCursor: null } satisfies QueuePage);
      const cursor = integer(Number(url.searchParams.get("after") ?? "0"), "Cursor", 0, Number.MAX_SAFE_INTEGER);
      const entries = await all<QueueEntry & { seq: number }>(
        db,
        `SELECT ${ENTRY_COLUMNS},q.seq,NULL AS position FROM decave_streamer_queue q
         JOIN decave_users u ON u.id=q.user_id WHERE q.session_id=? AND q.seq>? AND q.status IN ${ACTIVE}
         AND (q.status!='called' OR q.call_expires_at>?) ORDER BY q.seq LIMIT 51`,
        session.id,
        cursor,
        stamp,
      );
      const page = entries.slice(0, 50);
      return reply({
        entries: page.map(({ seq: _seq, ...entry }) => normaliseEntry(entry, now)),
        nextCursor: entries.length > 50 ? String(page[49].seq) : null,
      } satisfies QueuePage);
    }
    if (request.method !== "POST") return reply({ error: "Method not supported." }, 405);
    const guard = await deps.guardMutation(request, hubId, principal.id);
    if (guard) return guard;
    const input = await body(request);
    const limit = isCreator(admission.role) ? 120 : 30;
    const rate = await statement(
      db,
      `INSERT INTO decave_streamer_rate(hub_id,user_id,minute,count) VALUES(?,?,?,1)
      ON CONFLICT(hub_id,user_id,minute) DO UPDATE SET count=count+1 WHERE count<?`,
      hubId,
      principal.id,
      Math.floor(now / 60_000),
      limit,
    ).run();
    if (!rate.meta.changes) return reply({ error: "Too many actions. Please wait a minute." }, 429);

    if (path === "enable") {
      if (admission.role !== "owner") throw new StreamerInputError("Only the Hub owner can change its layout.", 403);
      await db.batch([
        statement(
          db,
          `INSERT OR IGNORE INTO decave_streamer_hubs(hub_id,config_json,version,created_at,updated_at)
          VALUES(?,'{}',1,?,?)`,
          hubId,
          stamp,
          stamp,
        ),
        statement(
          db,
          `INSERT INTO decave_streamer_audit(id,hub_id,actor_user_id,action,target_id,created_at)
          SELECT ?,?,?,'layout.enable',?,? WHERE changes()>0`,
          newId(),
          hubId,
          principal.id,
          String(hubId),
          stamp,
        ),
      ]);
      return reply({ ok: true, layout: "streamer" });
    }
    if (!(await one(db, "SELECT 1 FROM decave_streamer_hubs WHERE hub_id=?", hubId)))
      throw new StreamerInputError("Streamer Mode is not enabled.", 404);

    if (path === "settings") {
      requireCreator(admission);
      const version = integer(input.version, "Version", 1, Number.MAX_SAFE_INTEGER);
      const config = configInput(input, now);
      changed(
        await auditMutation(
          deps,
          statement(
            db,
            `UPDATE decave_streamer_hubs SET config_json=?,version=version+1,updated_at=?
        WHERE hub_id=? AND version=?`,
            JSON.stringify(config),
            stamp,
            hubId,
            version,
          ),
          admission,
          hubId,
          "settings.update",
          String(hubId),
          stamp,
        ),
      );
      return reply({ ok: true });
    }
    if (path === "session/create") {
      requireCreator(admission);
      const session = sessionInput(input);
      const id = newId();
      changed(
        await auditMutation(
          deps,
          statement(
            db,
            `INSERT INTO decave_streamer_sessions(id,hub_id,title,game,status,party_size,ready_seconds,created_at,version)
         SELECT ?,?,?,?,'open',?,?,?,1 WHERE NOT EXISTS
         (SELECT 1 FROM decave_streamer_sessions WHERE hub_id=? AND status!='ended')`,
            id,
            hubId,
            session.title,
            session.game,
            session.partySize,
            session.readySeconds,
            stamp,
            hubId,
          ),
          admission,
          hubId,
          "session.create",
          id,
          stamp,
        ),
        "There is already an active session.",
      );
      return reply({ ok: true, id }, 201);
    }
    const sessionAction = /^session\/(pause|resume|end|call-next|start-ready|finish-playing)$/.exec(path);
    if (sessionAction) {
      requireCreator(admission);
      const sessionId = identifier(input.sessionId);
      const session = await one<CommunitySession>(
        db,
        `SELECT ${SESSION_COLUMNS} FROM decave_streamer_sessions WHERE id=? AND hub_id=? AND status!='ended'`,
        sessionId,
        hubId,
      );
      if (!session) throw new StreamerInputError("Session is no longer active.", 409);
      const action = sessionAction[1];
      if (action === "pause" || action === "resume" || action === "end") {
        const version = integer(input.version, "Version", 1, Number.MAX_SAFE_INTEGER);
        const target = action === "pause" ? "paused" : action === "resume" ? "open" : "ended";
        const op = statement(
          db,
          `UPDATE decave_streamer_sessions SET status=?,ended_at=?,version=version+1
          WHERE id=? AND hub_id=? AND status!='ended' AND version=?`,
          target,
          action === "end" ? stamp : null,
          sessionId,
          hubId,
          version,
        );
        if (action === "end") {
          const auditId = newId();
          const result = await db.batch([
            op,
            statement(
              db,
              `INSERT INTO decave_streamer_audit(id,hub_id,actor_user_id,action,target_id,created_at)
              SELECT ?,?,?,'session.end',?,? WHERE changes()>0`,
              auditId,
              hubId,
              principal.id,
              sessionId,
              stamp,
            ),
            statement(
              db,
              `UPDATE decave_streamer_queue SET status=CASE WHEN status='playing' THEN 'done' ELSE 'skipped' END,finished_at=?
              WHERE session_id=? AND status IN ${ACTIVE} AND EXISTS
              (SELECT 1 FROM decave_streamer_audit WHERE id=?)`,
              stamp,
              sessionId,
              auditId,
            ),
          ]);
          changed(result[0].meta.changes);
        } else changed(await auditMutation(deps, op, admission, hubId, `session.${action}`, sessionId, stamp));
      } else if (action === "call-next") {
        // One SQL statement reserves only currently available seats. Parallel calls cannot
        // overfill: SQLite evaluates capacity and candidate updates in one write statement.
        const expires = new Date(now + session.readySeconds * 1000).toISOString();
        const op = statement(
          db,
          `UPDATE decave_streamer_queue SET status='called',call_expires_at=?
          WHERE id IN (SELECT q.id FROM decave_streamer_queue q
            WHERE q.session_id=? AND q.status='waiting'
            AND EXISTS(SELECT 1 FROM decave_hub_members m WHERE m.hub_id=q.hub_id AND m.user_id=q.user_id)
            ORDER BY q.seq LIMIT MAX(0,COALESCE((SELECT party_size FROM decave_streamer_sessions WHERE id=? AND status!='ended'),0)-
              (SELECT COUNT(*) FROM decave_streamer_queue WHERE session_id=? AND
               (status IN ('ready','playing') OR (status='called' AND call_expires_at>?)))))
          AND session_id=? AND hub_id=? AND EXISTS
          (SELECT 1 FROM decave_streamer_sessions WHERE id=? AND hub_id=? AND status!='ended')`,
          expires,
          sessionId,
          sessionId,
          sessionId,
          stamp,
          sessionId,
          hubId,
          sessionId,
          hubId,
        );
        changed(
          await auditMutation(deps, op, admission, hubId, "queue.call-next", sessionId, stamp),
          "No available seats or waiting members.",
        );
      } else if (action === "start-ready") {
        changed(
          await auditMutation(
            deps,
            statement(
              db,
              `UPDATE decave_streamer_queue SET status='playing' WHERE session_id=? AND hub_id=? AND status='ready'
           AND EXISTS(SELECT 1 FROM decave_streamer_sessions WHERE id=? AND status!='ended')`,
              sessionId,
              hubId,
              sessionId,
            ),
            admission,
            hubId,
            "queue.start-ready",
            sessionId,
            stamp,
          ),
          "No accepted ready checks to start.",
        );
      } else {
        changed(
          await auditMutation(
            deps,
            statement(
              db,
              "UPDATE decave_streamer_queue SET status='done',finished_at=? WHERE session_id=? AND hub_id=? AND status='playing'",
              stamp,
              sessionId,
              hubId,
            ),
            admission,
            hubId,
            "queue.finish-playing",
            sessionId,
            stamp,
          ),
          "No playing members to finish.",
        );
      }
      return reply({ ok: true });
    }
    if (path === "queue/join") {
      if (isCreator(admission.role))
        throw new StreamerInputError("Creators manage this session rather than take viewer slots.", 403);
      const sessionId = identifier(input.sessionId);
      const id = newId();
      const mutation = statement(
        db,
        `INSERT OR IGNORE INTO decave_streamer_queue(id,session_id,hub_id,user_id,status,joined_at)
        SELECT ?,?,?,?,'waiting',? WHERE EXISTS
         (SELECT 1 FROM decave_streamer_sessions WHERE id=? AND hub_id=? AND status='open')
        AND EXISTS(SELECT 1 FROM decave_hub_members WHERE hub_id=? AND user_id=?)
        AND (SELECT COUNT(*) FROM decave_streamer_queue WHERE session_id=? AND status IN ${ACTIVE}
          AND (status!='called' OR call_expires_at>?))<?`,
        id,
        sessionId,
        hubId,
        principal.id,
        stamp,
        sessionId,
        hubId,
        hubId,
        principal.id,
        sessionId,
        stamp,
        MAX_QUEUE,
      );
      const result = await mutation.run();
      if (!result.meta.changes) {
        const existing = await one<{ status: string }>(
          db,
          "SELECT status FROM decave_streamer_queue WHERE session_id=? AND hub_id=? AND user_id=?",
          sessionId,
          hubId,
          principal.id,
        );
        if (existing && ["waiting", "called", "ready", "playing"].includes(existing.status)) return reply({ ok: true });
        throw new StreamerInputError("The queue is closed, full, or you already had a turn in this session.", 409);
      }
      return reply({ ok: true }, 201);
    }
    if (path === "queue/leave" || path === "queue/ready") {
      const sessionId = identifier(input.sessionId);
      const ready = path === "queue/ready";
      const op = ready
        ? statement(
            db,
            `UPDATE decave_streamer_queue SET status='ready' WHERE session_id=? AND hub_id=? AND user_id=?
            AND status='called' AND call_expires_at>? AND EXISTS
            (SELECT 1 FROM decave_streamer_sessions WHERE id=? AND status!='ended')`,
            sessionId,
            hubId,
            principal.id,
            stamp,
            sessionId,
          )
        : statement(
            db,
            `UPDATE decave_streamer_queue SET status='left',finished_at=? WHERE session_id=? AND hub_id=? AND user_id=?
            AND status IN ('waiting','called','ready')`,
            stamp,
            sessionId,
            hubId,
            principal.id,
          );
      const result = await op.run();
      changed(
        result.meta.changes,
        ready ? "Ready check expired or is no longer active." : "You cannot leave this queue state.",
      );
      return reply({ ok: true });
    }
    if (path === "queue/skip") {
      requireCreator(admission);
      const id = identifier(input.entryId);
      changed(
        await auditMutation(
          deps,
          statement(
            db,
            `UPDATE decave_streamer_queue SET status='skipped',finished_at=?
        WHERE id=? AND hub_id=? AND status IN ('waiting','called','ready')`,
            stamp,
            id,
            hubId,
          ),
          admission,
          hubId,
          "queue.skip",
          id,
          stamp,
        ),
      );
      return reply({ ok: true });
    }
    if (path.startsWith("giveaways/")) {
      if (!deps.giveawaysEnabled) throw new StreamerInputError("Giveaways are not enabled on this deployment.", 404);
      if (path === "giveaways/create") {
        requireCreator(admission);
        const title = text(input.title, "Title", 120);
        const rules = text(input.rules, "Rules", 2000);
        const closesAt = futureDate(input.closesAt, "Closing time", now);
        const id = newId();
        changed(
          await auditMutation(
            deps,
            statement(
              db,
              `INSERT INTO decave_streamer_giveaways(id,hub_id,title,rules,closes_at,status,created_at)
          SELECT ?,?,?,?,?,'open',? WHERE (SELECT COUNT(*) FROM decave_streamer_giveaways WHERE hub_id=? AND status='open')<3`,
              id,
              hubId,
              title,
              rules,
              closesAt,
              stamp,
              hubId,
            ),
            admission,
            hubId,
            "giveaway.create",
            id,
            stamp,
          ),
          "Close or cancel an existing giveaway first.",
        );
        return reply({ ok: true, id }, 201);
      }
      const id = identifier(input.id);
      if (path === "giveaways/enter") {
        if (isCreator(admission.role)) throw new StreamerInputError("Organizers cannot enter their own giveaway.", 403);
        const op = statement(
          db,
          `INSERT OR IGNORE INTO decave_streamer_giveaway_entries(giveaway_id,hub_id,user_id,created_at)
          SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM decave_streamer_giveaways WHERE id=? AND hub_id=? AND status='open' AND closes_at>?)
          AND EXISTS(SELECT 1 FROM decave_hub_members WHERE hub_id=? AND user_id=? AND role='member')
          AND (SELECT COUNT(*) FROM decave_streamer_giveaway_entries WHERE giveaway_id=?)<5000`,
          id,
          hubId,
          principal.id,
          stamp,
          id,
          hubId,
          stamp,
          hubId,
          principal.id,
          id,
        );
        const result = await op.run();
        if (
          !result.meta.changes &&
          !(await one(
            db,
            "SELECT 1 FROM decave_streamer_giveaway_entries WHERE giveaway_id=? AND hub_id=? AND user_id=?",
            id,
            hubId,
            principal.id,
          ))
        ) {
          throw new StreamerInputError("This giveaway is closed or full.", 409);
        }
        return reply({ ok: true });
      }
      requireCreator(admission);
      if (path === "giveaways/cancel") {
        changed(
          await auditMutation(
            deps,
            statement(
              db,
              "UPDATE decave_streamer_giveaways SET status='cancelled' WHERE id=? AND hub_id=? AND status='open'",
              id,
              hubId,
            ),
            admission,
            hubId,
            "giveaway.cancel",
            id,
            stamp,
          ),
        );
        return reply({ ok: true });
      }
      if (path === "giveaways/draw") {
        const giveaway = await one<{ status: string; closes_at: string }>(
          db,
          "SELECT status,closes_at FROM decave_streamer_giveaways WHERE id=? AND hub_id=?",
          id,
          hubId,
        );
        if (giveaway?.status === "drawn") return reply({ ok: true }); // No rerolls on retry.
        if (!giveaway || giveaway.status !== "open" || giveaway.closes_at > stamp)
          throw new StreamerInputError("Draw after the advertised closing time.", 409);
        const entrants = await all<{ user_id: string }>(
          db,
          `SELECT e.user_id FROM decave_streamer_giveaway_entries e
          JOIN decave_hub_members m ON m.hub_id=e.hub_id AND m.user_id=e.user_id
          WHERE e.giveaway_id=? AND e.hub_id=? AND m.role='member' ORDER BY e.user_id LIMIT 5000`,
          id,
          hubId,
        );
        if (!entrants.length) throw new StreamerInputError("No eligible entries. Cancel this giveaway instead.", 409);
        const winner = entrants[unbiasedIndex(entrants.length)].user_id;
        changed(
          await auditMutation(
            deps,
            statement(
              db,
              `UPDATE decave_streamer_giveaways SET status='drawn',winner_user_id=?,drawn_at=?
          WHERE id=? AND hub_id=? AND status='open' AND closes_at<=?
          AND EXISTS(SELECT 1 FROM decave_streamer_giveaway_entries e JOIN decave_hub_members m
            ON m.hub_id=e.hub_id AND m.user_id=e.user_id WHERE e.giveaway_id=? AND e.user_id=? AND m.role='member')`,
              winner,
              stamp,
              id,
              hubId,
              stamp,
              id,
              winner,
            ),
            admission,
            hubId,
            "giveaway.draw",
            id,
            stamp,
          ),
        );
        return reply({ ok: true });
      }
    }
    return reply({ error: "Streamer action not found." }, 404);
  } catch (error) {
    if (error instanceof StreamerInputError) return reply({ error: error.message }, error.status);
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message))
      return reply({ error: "Another action already updated this record. Refresh and try again." }, 409);
    // Never expose SQL, tokens, private IDs, or database exceptions to the browser.
    return reply({ error: "Streamer tools are temporarily unavailable. Please try again." }, 503);
  }
}

/** Append to the host Hub ban/timeout/revocation transaction even when membership
 * rows are retained. This prevents an ineligible waiting/ready member being called. */
export function streamerRevokeParticipantStatements<D extends Database>(
  db: D,
  hubId: number,
  userId: string,
): ReturnType<D["prepare"]>[] {
  return [
    statement(db, "DELETE FROM decave_streamer_queue WHERE hub_id=? AND user_id=?", hubId, userId),
    statement(db, "DELETE FROM decave_streamer_giveaway_entries WHERE hub_id=? AND user_id=?", hubId, userId),
  ];
}
/** Append to the existing erasure flow, using its INTERNAL user ID; do not replace it. */
export function streamerUserErasureStatements<D extends Database>(db: D, userId: string): ReturnType<D["prepare"]>[] {
  return [
    statement(db, "DELETE FROM decave_streamer_queue WHERE user_id=?", userId),
    statement(db, "DELETE FROM decave_streamer_giveaway_entries WHERE user_id=?", userId),
    statement(db, "DELETE FROM decave_streamer_rate WHERE user_id=?", userId),
    statement(db, "UPDATE decave_streamer_giveaways SET winner_user_id=NULL WHERE winner_user_id=?", userId),
    statement(db, "UPDATE decave_streamer_highlights SET created_by=NULL WHERE created_by=?", userId),
    statement(db, "UPDATE decave_streamer_audit SET actor_user_id=NULL WHERE actor_user_id=?", userId),
  ];
}
/** Invoke from an authorized scheduled Worker hook, never an unauthenticated route.
 * Product defaults: session history 90 days, audit 30 days, rate buckets 2 hours. */
export async function pruneStreamerData(db: Database, now = Date.now()): Promise<void> {
  await db.batch([
    statement(db, "DELETE FROM decave_streamer_rate WHERE minute<?", Math.floor(now / 60_000) - 120),
    statement(
      db,
      "DELETE FROM decave_streamer_audit WHERE created_at<?",
      new Date(now - 30 * 86_400_000).toISOString(),
    ),
    statement(
      db,
      "DELETE FROM decave_streamer_sessions WHERE status='ended' AND ended_at<?",
      new Date(now - 90 * 86_400_000).toISOString(),
    ),
    statement(
      db,
      "DELETE FROM decave_streamer_giveaways WHERE status!='open' AND created_at<?",
      new Date(now - 90 * 86_400_000).toISOString(),
    ),
  ]);
}
