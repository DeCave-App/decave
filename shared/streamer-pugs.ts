/** Shared contracts for Streamer Hub PUGs (random-team community matches) and the community leaderboard. */
import { StreamerInputError, integer, text } from "./streamer-mode.ts";

export type PugStatus = "open" | "live" | "done" | "cancelled";
export type PugTeam = "a" | "b";
export type PugPlayer = { name: string; team: PugTeam | null; me: boolean };
export type Pug = {
  id: string;
  status: PugStatus;
  /** Players per team (1-5); the PUG holds up to twice this many. */
  teamSize: number;
  maps: string[];
  /** Picked when the PUG starts: the most voted map, a random one on a tie. */
  map: string | null;
  voiceA: number | null;
  voiceB: number | null;
  scoreA: number | null;
  scoreB: number | null;
  players: PugPlayer[];
  votes: Record<string, number>;
  myVote: string | null;
  myTeam: PugTeam | null;
  joined: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type LeaderboardRow = {
  name: string;
  me: boolean;
  /** PUGs won / played this month. */
  wins: number;
  games: number;
  faceitNickname: string | null;
  faceitElo: number | null;
  faceitLevel: number | null;
};
export type Leaderboard = {
  /** "2026-10" (UTC). */
  month: string;
  /** Most PUG wins this month (ties: more games, then earliest win). */
  champion: { name: string; wins: number } | null;
  /** Last month's champion, shown as the standing title holder. */
  previousChampion: { name: string; wins: number; month: string } | null;
  rows: LeaderboardRow[];
  myFaceit: { nickname: string; elo: number | null; level: number | null; updatedAt: string } | null;
  faceitAvailable: boolean;
};

export const CS2_MAP_POOL = ["Mirage", "Inferno", "Dust II", "Nuke", "Ancient", "Anubis", "Train", "Overpass"] as const;

export function pugCreateInput(body: Record<string, unknown>) {
  const teamSize = integer(body.teamSize, "Players per team", 1, 5);
  if (!Array.isArray(body.maps) || body.maps.length < 1 || body.maps.length > 10)
    throw new StreamerInputError("Pick 1–10 maps.");
  const maps = [...new Set(body.maps.map((map, i) => text(map, `Map ${i + 1}`, 30)))];
  const voiceA = integer(body.voiceA, "Team A voice room", 1, Number.MAX_SAFE_INTEGER);
  const voiceB = integer(body.voiceB, "Team B voice room", 1, Number.MAX_SAFE_INTEGER);
  if (voiceA === voiceB) throw new StreamerInputError("Pick two different voice rooms for the teams.");
  return { teamSize, maps, voiceA, voiceB };
}

export function pugScoreInput(body: Record<string, unknown>) {
  return {
    scoreA: integer(body.scoreA, "Team A score", 0, 99),
    scoreB: integer(body.scoreB, "Team B score", 0, 99),
  };
}

/** Uniform Fisher–Yates shuffle with an injectable random source (tests). */
export function shuffled<T>(items: readonly T[], random: (max: number) => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Most voted map; a tie (or no votes) is broken by `random` among the leaders (or the whole pool). */
export function pickMap(pool: readonly string[], votes: readonly (string | null)[], random: (max: number) => number) {
  const counts = new Map<string, number>();
  for (const vote of votes) if (vote && pool.includes(vote)) counts.set(vote, (counts.get(vote) ?? 0) + 1);
  const best = Math.max(0, ...counts.values());
  const leaders = best ? pool.filter((map) => counts.get(map) === best) : [...pool];
  return leaders[random(leaders.length)];
}
