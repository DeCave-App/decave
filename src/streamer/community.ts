// Streamer Overview: PUG (random-team community matches) and Leaderboard panels.
// DOM-only like the rest of the Overview; the controller owns state and requests.

import { CS2_MAP_POOL, type Leaderboard, type Pug, type PugTeam } from "../../shared/streamer-pugs";
import { el, field } from "./dom";

export type VoiceRoomRef = { id: number; name: string };

export type CommunityHelpers = {
  owner: boolean;
  voiceRooms: VoiceRoomRef[];
  button(label: string, fn: () => void, primary?: boolean): HTMLButtonElement;
  quiet(text: string): HTMLElement;
  perform(path: string, payload: unknown): void;
  panelForm(
    submitLabel: string,
    submit: (values: Record<string, unknown>, form: HTMLFormElement) => void,
  ): { form: HTMLFormElement; submitButton: HTMLButtonElement };
  joinVoiceRoom?: (roomId: number) => void;
};

const TEAM_LABEL: Record<PugTeam, string> = { a: "Team A", b: "Team B" };

export function pugStatusLine(pug: Pug | null | undefined): string {
  if (!pug) return "No PUG running";
  const capacity = pug.teamSize * 2;
  if (pug.status === "open") return `${pug.players.length}/${capacity} joined · ${pug.teamSize}v${pug.teamSize}`;
  if (pug.status === "live") return `Live on ${pug.map ?? "a map"}`;
  if (pug.status === "done") return `Finished ${pug.scoreA ?? 0}–${pug.scoreB ?? 0} on ${pug.map ?? "a map"}`;
  return "Cancelled";
}

export function teamRoom(pug: Pug): number | null {
  if (pug.myTeam === "a") return pug.voiceA;
  if (pug.myTeam === "b") return pug.voiceB;
  return null;
}

function roomName(rooms: VoiceRoomRef[], id: number | null): string {
  return rooms.find((room) => room.id === id)?.name ?? "team voice";
}

function playerList(pug: Pug, team: PugTeam | null): HTMLElement {
  const players = pug.players.filter((player) => (team ? player.team === team : true));
  const list = el("ul", "dc-streamer-pug-players");
  for (const player of players) list.append(el("li", player.me ? "is-me" : "", player.name, player.me ? " (you)" : ""));
  if (!players.length) list.append(el("li", "is-empty", "Nobody yet"));
  return list;
}

function renderCreate(container: HTMLElement, h: CommunityHelpers) {
  if (!h.owner) {
    container.append(h.quiet("No PUG is open right now. The streamer opens one when it's time to play."));
    return;
  }
  if (h.voiceRooms.length < 2) {
    container.append(h.quiet("Add two voice rooms to this Hub first, one for each team."));
    return;
  }
  container.append(
    h.quiet("Open a PUG: viewers join, vote for a map, and teams are drawn at random when you start it."),
  );
  const { form, submitButton } = h.panelForm("Open PUG", (values, current) => {
    const maps = Array.from(current.querySelectorAll<HTMLInputElement>("input[name=map]:checked")).map((i) => i.value);
    h.perform("pug/create", {
      teamSize: Number(values.teamSize),
      maps,
      voiceA: Number(values.voiceA),
      voiceB: Number(values.voiceB),
    });
  });
  field(form, "teamSize", "Players per team (1–5)", "5", { type: "number", min: "1", max: "5", required: true });
  const maps = el("fieldset", "dc-streamer-pug-maps", el("legend", "", "Map pool"));
  for (const map of CS2_MAP_POOL) {
    const box = el("input", "");
    box.type = "checkbox";
    box.name = "map";
    box.value = map;
    box.checked = map !== "Train" && map !== "Overpass";
    maps.append(el("label", "", box, ` ${map}`));
  }
  form.append(maps);
  for (const [name, label, index] of [
    ["voiceA", "Team A voice room", 0],
    ["voiceB", "Team B voice room", 1],
  ] as const) {
    const select = el("select", "dc-streamer-input");
    select.name = name;
    select.id = `dc-streamer-pug-${name}`;
    for (const room of h.voiceRooms) select.append(new Option(room.name, String(room.id)));
    select.selectedIndex = Math.min(index, h.voiceRooms.length - 1);
    const title = el("label", "", label);
    title.htmlFor = select.id;
    form.append(el("div", "dc-streamer-field", title, select));
  }
  form.append(submitButton);
  container.append(form);
}

/** The PUG panel for members and the creator. */
export function renderPugPanel(container: HTMLElement, pug: Pug | null | undefined, h: CommunityHelpers) {
  if (!pug || pug.status === "cancelled") {
    renderCreate(container, h);
    return;
  }
  const capacity = pug.teamSize * 2;
  container.append(el("p", "dc-streamer-detail", pugStatusLine(pug)));

  if (pug.status === "open") {
    container.append(
      h.quiet(`Teams are random, ${pug.teamSize}v${pug.teamSize}. The most voted map is played.`),
      el("h3", "", `Players (${pug.players.length}/${capacity})`),
      playerList(pug, null),
    );
    const actions = el("div", "dc-streamer-actions");
    if (pug.joined) actions.append(h.button("Leave PUG", () => h.perform("pug/leave", {})));
    else {
      const join = h.button("Join PUG", () => h.perform("pug/join", {}), true);
      join.disabled ||= pug.players.length >= capacity;
      actions.append(join);
    }
    if (h.owner) {
      const start = h.button("Start: draw teams", () => h.perform("pug/start", {}), true);
      start.disabled ||= pug.players.length < 2;
      actions.append(
        start,
        h.button("Cancel PUG", () => h.perform("pug/cancel", {})),
      );
    }
    container.append(actions, el("h3", "", "Map vote"));
    const votes = el("div", "dc-streamer-pug-votes");
    for (const map of pug.maps) {
      const count = pug.votes[map] ?? 0;
      const vote = h.button(`${map} · ${count}`, () => h.perform("pug/vote", { map }), pug.myVote === map);
      vote.disabled ||= !pug.joined;
      vote.setAttribute("aria-pressed", String(pug.myVote === map));
      votes.append(vote);
    }
    container.append(votes);
    if (!pug.joined) container.append(h.quiet("Join the PUG to vote."));
    return;
  }

  const teams = el(
    "div",
    "dc-streamer-pug-teams",
    el(
      "section",
      pug.myTeam === "a" ? "is-mine" : "",
      el("h3", "", `${TEAM_LABEL.a}${pug.status === "done" ? ` · ${pug.scoreA ?? 0}` : ""}`),
      el("small", "", roomName(h.voiceRooms, pug.voiceA)),
      playerList(pug, "a"),
    ),
    el(
      "section",
      pug.myTeam === "b" ? "is-mine" : "",
      el("h3", "", `${TEAM_LABEL.b}${pug.status === "done" ? ` · ${pug.scoreB ?? 0}` : ""}`),
      el("small", "", roomName(h.voiceRooms, pug.voiceB)),
      playerList(pug, "b"),
    ),
  );
  container.append(teams);

  if (pug.status === "live") {
    const room = teamRoom(pug);
    if (room && h.joinVoiceRoom) {
      container.append(
        el(
          "div",
          "dc-streamer-actions",
          h.button(`Join ${pug.myTeam ? TEAM_LABEL[pug.myTeam] : ""} voice`, () => h.joinVoiceRoom!(room), true),
        ),
      );
    }
    if (h.owner) {
      container.append(el("h3", "", "Report the score"));
      const { form, submitButton } = h.panelForm("Save result", (values) =>
        h.perform("pug/result", { scoreA: Number(values.scoreA), scoreB: Number(values.scoreB) }),
      );
      field(form, "scoreA", "Team A rounds", "0", { type: "number", min: "0", max: "99", required: true });
      field(form, "scoreB", "Team B rounds", "0", { type: "number", min: "0", max: "99", required: true });
      form.append(submitButton);
      container.append(
        form,
        h.button("Cancel PUG", () => h.perform("pug/cancel", {})),
      );
    }
    return;
  }

  // Done: offer the next one.
  if (h.owner) container.append(el("h3", "", "Next PUG"));
  renderCreate(container, h);
}

/** The monthly leaderboard plus the viewer's own FACEIT link. */
export function renderLeaderboard(
  container: HTMLElement,
  board: Leaderboard | null,
  error: string,
  h: CommunityHelpers & { signInFaceit(): void; unlinkFaceit(): void },
) {
  if (error) {
    container.append(h.quiet(error));
    return;
  }
  if (!board) {
    container.append(h.quiet("Loading the leaderboard…"));
    return;
  }
  const month = new Date(`${board.month}-01T00:00:00Z`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  container.append(
    el(
      "div",
      "dc-streamer-pug-champion",
      el("strong", "", board.champion ? `🏆 ${board.champion.name}` : "🏆 Up for grabs"),
      h.quiet(
        board.champion
          ? `Rifler of the month, ${month}: ${board.champion.wins} PUG ${board.champion.wins === 1 ? "win" : "wins"} so far.`
          : `Win a PUG to become Rifler of the month for ${month}.`,
      ),
      board.previousChampion
        ? h.quiet(`Last month: ${board.previousChampion.name} (${board.previousChampion.wins} wins).`)
        : null,
    ),
  );
  const table = el("table", "dc-streamer-pug-board");
  table.append(
    el(
      "thead",
      "",
      el(
        "tr",
        "",
        el("th", "", "#"),
        el("th", "", "Player"),
        el("th", "", "Wins"),
        el("th", "", "Played"),
        el("th", "", "FACEIT"),
      ),
    ),
  );
  const body = el("tbody", "");
  board.rows.forEach((row, index) => {
    const faceit =
      row.faceitNickname === null
        ? "—"
        : `${row.faceitLevel ? `Lvl ${row.faceitLevel} · ` : ""}${row.faceitElo ?? "?"} ELO`;
    body.append(
      el(
        "tr",
        row.me ? "is-me" : "",
        el("td", "", String(index + 1)),
        el("td", "", row.name, row.faceitNickname ? el("small", "", ` ${row.faceitNickname}`) : null),
        el("td", "", String(row.wins)),
        el("td", "", String(row.games)),
        el("td", "", faceit),
      ),
    );
  });
  if (!board.rows.length) body.append(el("tr", "", el("td", "", ""), el("td", "", "No games yet this month.")));
  table.append(body);
  container.append(el("div", "dc-streamer-pug-board-wrap", table));

  container.append(el("h3", "", "Your FACEIT account"));
  if (board.myFaceit) {
    container.append(
      h.quiet(
        `Linked as ${board.myFaceit.nickname}${board.myFaceit.elo ? ` · ${board.myFaceit.elo} ELO` : ""}. Your ELO is refreshed every few hours and shown to members of Hubs you're in.`,
      ),
      h.button("Unlink FACEIT", () => h.unlinkFaceit()),
    );
  } else if (!board.faceitAvailable) {
    container.append(h.quiet("FACEIT linking isn't available yet."));
  } else {
    container.append(
      h.quiet(
        "Sign in with FACEIT to show your CS2 ELO here. Only you can link your own account. Members of Hubs you're in can see your nickname and ELO.",
      ),
      h.button("Sign in with FACEIT", () => h.signInFaceit(), true),
    );
  }
}
