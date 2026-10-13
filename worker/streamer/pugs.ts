// Streamer Hub PUGs: community matches with random teams (no rank balancing:
// they are for fun), a map vote, team voice rooms and a reported score that
// feeds the monthly leaderboard. One open or live PUG per Hub.

import { isCreator, unbiasedIndex } from "../../shared/streamer-mode";
import { streamerError } from "./errors";
import {
  pickMap,
  pugCreateInput,
  pugScoreInput,
  shuffled,
  type Leaderboard,
  type LeaderboardRow,
  type Pug,
  type PugTeam,
} from "../../shared/streamer-pugs";
import { all, one, statement } from "./sql";
import type { Admission, Database, Statement } from "./types";

/** A finished PUG stays on the Overview this long so players see the result. */
const RESULT_VISIBLE_MS = 2 * 60 * 60 * 1000;

type PugRow = {
  id: string;
  status: Pug["status"];
  team_size: number;
  maps_json: string;
  map: string | null;
  voice_a: number | null;
  voice_b: number | null;
  score_a: number | null;
  score_b: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type PugContext = {
  db: Database;
  admission: Admission;
  hubId: number;
  now: number;
  stamp: string;
  newId: () => string;
  /** Runs `mutation` and records `action` in the Streamer audit log when it changed a row. */
  audit: (mutation: Statement, action: string, target: string) => Promise<number>;
  random?: (max: number) => number;
};

const cryptoRandom = (max: number) => unbiasedIndex(max);

function parseMaps(json: string): string[] {
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value.filter((map): map is string => typeof map === "string") : [];
  } catch {
    return [];
  }
}

async function currentPugRow(db: Database, hubId: number, now: number): Promise<PugRow | null> {
  const active = await one<PugRow>(
    db,
    "SELECT * FROM decave_streamer_pugs WHERE hub_id=? AND status IN ('open','live') LIMIT 1",
    hubId,
  );
  if (active) return active;
  return one<PugRow>(
    db,
    `SELECT * FROM decave_streamer_pugs WHERE hub_id=? AND status='done' AND finished_at>=?
     ORDER BY finished_at DESC LIMIT 1`,
    hubId,
    new Date(now - RESULT_VISIBLE_MS).toISOString(),
  );
}

/** The Hub's current PUG as seen by `userId`, or null. */
export async function readPug(db: Database, hubId: number, userId: string, now: number): Promise<Pug | null> {
  const row = await currentPugRow(db, hubId, now);
  if (!row) return null;
  const players = await all<{ user_id: string; name: string; team: PugTeam | null; map_vote: string | null }>(
    db,
    `SELECT p.user_id,u.username AS name,p.team,p.map_vote FROM decave_streamer_pug_players p
     JOIN decave_users u ON u.id=p.user_id WHERE p.pug_id=? ORDER BY p.joined_at,p.user_id`,
    row.id,
  );
  const maps = parseMaps(row.maps_json);
  const votes: Record<string, number> = {};
  for (const player of players)
    if (player.map_vote && maps.includes(player.map_vote)) votes[player.map_vote] = (votes[player.map_vote] ?? 0) + 1;
  const mine = players.find((player) => player.user_id === userId) ?? null;
  return {
    id: row.id,
    status: row.status,
    teamSize: row.team_size,
    maps,
    map: row.map,
    voiceA: row.voice_a,
    voiceB: row.voice_b,
    scoreA: row.score_a,
    scoreB: row.score_b,
    players: players.map((player) => ({ name: player.name, team: player.team, me: player.user_id === userId })),
    votes,
    myVote: mine?.map_vote ?? null,
    myTeam: mine?.team ?? null,
    joined: Boolean(mine),
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function requireCreator(admission: Admission): void {
  if (!isCreator(admission.role)) throw streamerError("streamer.creatorRequired", 403);
}

async function activeRow(ctx: PugContext, status?: "open" | "live"): Promise<PugRow> {
  const row = await one<PugRow>(
    ctx.db,
    "SELECT * FROM decave_streamer_pugs WHERE hub_id=? AND status IN ('open','live') LIMIT 1",
    ctx.hubId,
  );
  if (!row) throw streamerError("streamer.pug.notRunning", 404);
  if (status && row.status !== status)
    throw streamerError(status === "open" ? "streamer.pug.alreadyStarted" : "streamer.pug.notStarted", 409);
  return row;
}

/** POST /api/servers/:id/streamer/pug/<action>. Returns null for paths outside pug/. */
export async function handlePugMutation(path: string, input: Record<string, unknown>, ctx: PugContext) {
  if (!path.startsWith("pug/")) return null;
  const { db, admission, hubId, stamp } = ctx;
  const me = admission.principal.id;
  const random = ctx.random ?? cryptoRandom;

  if (path === "pug/create") {
    requireCreator(admission);
    const value = pugCreateInput(input);
    const rooms = await all<{ id: number }>(
      db,
      "SELECT id FROM decave_rooms WHERE hub_id=? AND type='voice' AND id IN (?,?)",
      hubId,
      value.voiceA,
      value.voiceB,
    );
    if (rooms.length !== 2) throw streamerError("streamer.pug.pickTwoRooms");
    const id = ctx.newId();
    try {
      await ctx.audit(
        statement(
          db,
          `INSERT INTO decave_streamer_pugs(id,hub_id,status,team_size,maps_json,voice_a,voice_b,created_by,created_at)
           VALUES(?,?,'open',?,?,?,?,?,?)`,
          id,
          hubId,
          value.teamSize,
          JSON.stringify(value.maps),
          value.voiceA,
          value.voiceB,
          me,
          stamp,
        ),
        "pug.create",
        id,
      );
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/.test(error.message))
        throw streamerError("streamer.pug.alreadyRunning", 409);
      throw error;
    }
    return { ok: true, id };
  }

  if (path === "pug/join") {
    const row = await activeRow(ctx, "open");
    const count = await one<{ n: number }>(
      db,
      "SELECT COUNT(*) AS n FROM decave_streamer_pug_players WHERE pug_id=?",
      row.id,
    );
    if ((count?.n ?? 0) >= row.team_size * 2) throw streamerError("streamer.pug.full", 409);
    await statement(
      db,
      `INSERT OR IGNORE INTO decave_streamer_pug_players(pug_id,hub_id,user_id,joined_at)
       SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM decave_streamer_pug_players WHERE pug_id=?)<?`,
      row.id,
      hubId,
      me,
      stamp,
      row.id,
      row.team_size * 2,
    ).run();
    return { ok: true };
  }

  if (path === "pug/leave") {
    const row = await activeRow(ctx, "open");
    await statement(db, "DELETE FROM decave_streamer_pug_players WHERE pug_id=? AND user_id=?", row.id, me).run();
    return { ok: true };
  }

  if (path === "pug/vote") {
    const row = await activeRow(ctx, "open");
    const map = typeof input.map === "string" ? input.map : "";
    if (!parseMaps(row.maps_json).includes(map)) throw streamerError("streamer.pug.mapNotInPool");
    const result = await statement(
      db,
      "UPDATE decave_streamer_pug_players SET map_vote=? WHERE pug_id=? AND user_id=?",
      map,
      row.id,
      me,
    ).run();
    if (!result.meta.changes) throw streamerError("streamer.pug.joinToVote", 409);
    return { ok: true };
  }

  if (path === "pug/start") {
    requireCreator(admission);
    const row = await activeRow(ctx, "open");
    const players = await all<{ user_id: string; map_vote: string | null }>(
      db,
      "SELECT user_id,map_vote FROM decave_streamer_pug_players WHERE pug_id=? ORDER BY joined_at,user_id",
      row.id,
    );
    if (players.length < 2) throw streamerError("streamer.pug.notEnoughPlayers", 409);
    // Random teams, no balancing: these games are for fun. Team A gets the extra player on an odd count.
    const order = shuffled(players, random);
    const half = Math.ceil(order.length / 2);
    const map = pickMap(
      parseMaps(row.maps_json),
      players.map((player) => player.map_vote),
      random,
    );
    const results = await db.batch([
      statement(
        db,
        "UPDATE decave_streamer_pugs SET status='live',map=?,started_at=? WHERE id=? AND status='open'",
        map,
        stamp,
        row.id,
      ),
      ...order.map((player, index) =>
        statement(
          db,
          "UPDATE decave_streamer_pug_players SET team=? WHERE pug_id=? AND user_id=?",
          index < half ? "a" : "b",
          row.id,
          player.user_id,
        ),
      ),
      statement(
        db,
        `INSERT INTO decave_streamer_audit(id,hub_id,actor_user_id,action,target_id,created_at)
         VALUES(?,?,?,'pug.start',?,?)`,
        ctx.newId(),
        hubId,
        me,
        row.id,
        stamp,
      ),
    ]);
    if (!results[0].meta.changes) throw streamerError("streamer.pug.changed", 409);
    return { ok: true, map };
  }

  if (path === "pug/result") {
    requireCreator(admission);
    const row = await activeRow(ctx, "live");
    const score = pugScoreInput(input);
    await ctx.audit(
      statement(
        db,
        "UPDATE decave_streamer_pugs SET status='done',score_a=?,score_b=?,finished_at=? WHERE id=? AND status='live'",
        score.scoreA,
        score.scoreB,
        stamp,
        row.id,
      ),
      "pug.result",
      row.id,
    );
    return { ok: true };
  }

  if (path === "pug/cancel") {
    requireCreator(admission);
    const row = await activeRow(ctx);
    await ctx.audit(
      statement(
        db,
        "UPDATE decave_streamer_pugs SET status='cancelled',finished_at=? WHERE id=? AND status IN ('open','live')",
        stamp,
        row.id,
      ),
      "pug.cancel",
      row.id,
    );
    return { ok: true };
  }

  throw streamerError("streamer.pug.unknownAction", 404);
}

function monthStart(now: number, offset = 0): Date {
  const date = new Date(now);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
}
const monthLabel = (date: Date) => date.toISOString().slice(0, 7);

type StandingRow = { user_id: string; name: string; wins: number; games: number; first_win: string | null };

/** Members' PUG wins/games between two instants (finished PUGs only; a draw is played, not won). */
async function standings(db: Database, hubId: number, from: Date, to: Date): Promise<StandingRow[]> {
  return all<StandingRow>(
    db,
    `SELECT p.user_id,u.username AS name,
       SUM(CASE WHEN (p.team='a' AND g.score_a>g.score_b) OR (p.team='b' AND g.score_b>g.score_a) THEN 1 ELSE 0 END) AS wins,
       COUNT(*) AS games,
       MIN(CASE WHEN (p.team='a' AND g.score_a>g.score_b) OR (p.team='b' AND g.score_b>g.score_a) THEN g.finished_at END) AS first_win
     FROM decave_streamer_pug_players p
     JOIN decave_streamer_pugs g ON g.id=p.pug_id
     JOIN decave_users u ON u.id=p.user_id
     JOIN decave_hub_members m ON m.hub_id=g.hub_id AND m.user_id=p.user_id
     WHERE g.hub_id=? AND g.status='done' AND p.team IS NOT NULL AND g.finished_at>=? AND g.finished_at<?
     GROUP BY p.user_id`,
    hubId,
    from.toISOString(),
    to.toISOString(),
  );
}

function champion(rows: StandingRow[]) {
  const ranked = rows
    .filter((row) => row.wins > 0)
    .sort((a, b) => b.wins - a.wins || b.games - a.games || String(a.first_win).localeCompare(String(b.first_win)));
  return ranked[0] ? { name: ranked[0].name, wins: ranked[0].wins } : null;
}

/** GET /api/servers/:id/streamer/leaderboard: this month's PUG standings plus linked FACEIT ELO. */
export async function readLeaderboard(
  db: Database,
  hubId: number,
  userId: string,
  now: number,
  faceitAvailable: boolean,
): Promise<Leaderboard> {
  const start = monthStart(now);
  const next = monthStart(now, 1);
  const previous = monthStart(now, -1);
  const month = await standings(db, hubId, start, next);
  const faceit = await all<{
    user_id: string;
    name: string;
    nickname: string;
    elo: number | null;
    level: number | null;
  }>(
    db,
    `SELECT f.user_id,u.username AS name,f.nickname,f.elo,f.level FROM decave_faceit_links f
     JOIN decave_hub_members m ON m.user_id=f.user_id AND m.hub_id=?
     JOIN decave_users u ON u.id=f.user_id`,
    hubId,
  );
  const rows = new Map<string, LeaderboardRow>();
  for (const row of month)
    rows.set(row.user_id, {
      name: row.name,
      me: row.user_id === userId,
      wins: row.wins,
      games: row.games,
      faceitNickname: null,
      faceitElo: null,
      faceitLevel: null,
    });
  for (const link of faceit) {
    const row = rows.get(link.user_id) ?? {
      name: link.name,
      me: link.user_id === userId,
      wins: 0,
      games: 0,
      faceitNickname: null,
      faceitElo: null,
      faceitLevel: null,
    };
    rows.set(link.user_id, { ...row, faceitNickname: link.nickname, faceitElo: link.elo, faceitLevel: link.level });
  }
  const mine = await one<{ nickname: string; elo: number | null; level: number | null; updated_at: string }>(
    db,
    "SELECT nickname,elo,level,updated_at FROM decave_faceit_links WHERE user_id=?",
    userId,
  );
  const previousChampion = champion(await standings(db, hubId, previous, start));
  return {
    month: monthLabel(start),
    champion: champion(month),
    previousChampion: previousChampion ? { ...previousChampion, month: monthLabel(previous) } : null,
    rows: [...rows.values()]
      .sort((a, b) => b.wins - a.wins || b.games - a.games || (b.faceitElo ?? -1) - (a.faceitElo ?? -1))
      .slice(0, 100),
    myFaceit: mine ? { nickname: mine.nickname, elo: mine.elo, level: mine.level, updatedAt: mine.updated_at } : null,
    faceitAvailable,
  };
}
