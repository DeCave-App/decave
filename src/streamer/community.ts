// Streamer Overview: PUG (random-team community matches) and Leaderboard panels.
// DOM-only like the rest of the Overview; the controller owns state and requests.

import { CS2_MAP_POOL, type Leaderboard, type Pug, type PugTeam } from "../../shared/streamer-pugs";
import { el, field } from "./dom";
import { dateLocale, t } from "./i18n";

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

const teamLabel = (team: PugTeam): string => (team === "a" ? t("streamer.pug.teamA") : t("streamer.pug.teamB"));

export function pugStatusLine(pug: Pug | null | undefined): string {
  if (!pug) return t("streamer.pug.statusNone");
  const capacity = pug.teamSize * 2;
  if (pug.status === "open")
    return t("streamer.pug.statusOpen", { joined: pug.players.length, capacity, size: pug.teamSize });
  if (pug.status === "live") return t("streamer.pug.statusLive", { map: pug.map ?? t("streamer.pug.aMap") });
  if (pug.status === "done")
    return t("streamer.pug.statusDone", {
      scoreA: pug.scoreA ?? 0,
      scoreB: pug.scoreB ?? 0,
      map: pug.map ?? t("streamer.pug.aMap"),
    });
  return t("streamer.pug.statusCancelled");
}

export function teamRoom(pug: Pug): number | null {
  if (pug.myTeam === "a") return pug.voiceA;
  if (pug.myTeam === "b") return pug.voiceB;
  return null;
}

function roomName(rooms: VoiceRoomRef[], id: number | null): string {
  return rooms.find((room) => room.id === id)?.name ?? t("streamer.pug.teamVoice");
}

function playerList(pug: Pug, team: PugTeam | null): HTMLElement {
  const players = pug.players.filter((player) => (team ? player.team === team : true));
  const list = el("ul", "dc-streamer-pug-players");
  for (const player of players)
    list.append(el("li", player.me ? "is-me" : "", player.name, player.me ? t("streamer.pug.you") : ""));
  if (!players.length) list.append(el("li", "is-empty", t("streamer.pug.nobody")));
  return list;
}

function renderCreate(container: HTMLElement, h: CommunityHelpers) {
  if (!h.owner) {
    container.append(h.quiet(t("streamer.pug.memberNone")));
    return;
  }
  if (h.voiceRooms.length < 2) {
    container.append(h.quiet(t("streamer.pug.needRooms")));
    return;
  }
  container.append(h.quiet(t("streamer.pug.createIntro")));
  const { form, submitButton } = h.panelForm(t("streamer.pug.open"), (values, current) => {
    const maps = Array.from(current.querySelectorAll<HTMLInputElement>("input[name=map]:checked")).map((i) => i.value);
    h.perform("pug/create", {
      teamSize: Number(values.teamSize),
      maps,
      voiceA: Number(values.voiceA),
      voiceB: Number(values.voiceB),
    });
  });
  field(form, "teamSize", t("streamer.pug.teamSizeField"), "5", { type: "number", min: "1", max: "5", required: true });
  const maps = el("fieldset", "dc-streamer-pug-maps", el("legend", "", t("streamer.pug.mapPool")));
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
    ["voiceA", t("streamer.pug.voiceAField"), 0],
    ["voiceB", t("streamer.pug.voiceBField"), 1],
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
      h.quiet(t("streamer.pug.rules", { size: pug.teamSize })),
      el("h3", "", t("streamer.pug.players", { joined: pug.players.length, capacity })),
      playerList(pug, null),
    );
    const actions = el("div", "dc-streamer-actions");
    if (pug.joined) actions.append(h.button(t("streamer.pug.leave"), () => h.perform("pug/leave", {})));
    else {
      const join = h.button(t("streamer.pug.join"), () => h.perform("pug/join", {}), true);
      join.disabled ||= pug.players.length >= capacity;
      actions.append(join);
    }
    if (h.owner) {
      const start = h.button(t("streamer.pug.start"), () => h.perform("pug/start", {}), true);
      start.disabled ||= pug.players.length < 2;
      actions.append(
        start,
        h.button(t("streamer.pug.cancel"), () => h.perform("pug/cancel", {})),
      );
    }
    container.append(actions, el("h3", "", t("streamer.pug.mapVote")));
    const votes = el("div", "dc-streamer-pug-votes");
    for (const map of pug.maps) {
      const count = pug.votes[map] ?? 0;
      const vote = h.button(`${map} · ${count}`, () => h.perform("pug/vote", { map }), pug.myVote === map);
      vote.disabled ||= !pug.joined;
      vote.setAttribute("aria-pressed", String(pug.myVote === map));
      votes.append(vote);
    }
    container.append(votes);
    if (!pug.joined) container.append(h.quiet(t("streamer.pug.voteHint")));
    return;
  }

  const teams = el(
    "div",
    "dc-streamer-pug-teams",
    el(
      "section",
      pug.myTeam === "a" ? "is-mine" : "",
      el(
        "h3",
        "",
        pug.status === "done"
          ? t("streamer.pug.teamScore", { team: teamLabel("a"), score: pug.scoreA ?? 0 })
          : teamLabel("a"),
      ),
      el("small", "", roomName(h.voiceRooms, pug.voiceA)),
      playerList(pug, "a"),
    ),
    el(
      "section",
      pug.myTeam === "b" ? "is-mine" : "",
      el(
        "h3",
        "",
        pug.status === "done"
          ? t("streamer.pug.teamScore", { team: teamLabel("b"), score: pug.scoreB ?? 0 })
          : teamLabel("b"),
      ),
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
          h.button(
            t("streamer.pug.joinTeamVoice", { team: pug.myTeam ? teamLabel(pug.myTeam) : "" }),
            () => h.joinVoiceRoom!(room),
            true,
          ),
        ),
      );
    }
    if (h.owner) {
      container.append(el("h3", "", t("streamer.pug.reportScore")));
      const { form, submitButton } = h.panelForm(t("streamer.pug.saveResult"), (values) =>
        h.perform("pug/result", { scoreA: Number(values.scoreA), scoreB: Number(values.scoreB) }),
      );
      field(form, "scoreA", t("streamer.pug.teamARounds"), "0", {
        type: "number",
        min: "0",
        max: "99",
        required: true,
      });
      field(form, "scoreB", t("streamer.pug.teamBRounds"), "0", {
        type: "number",
        min: "0",
        max: "99",
        required: true,
      });
      form.append(submitButton);
      container.append(
        form,
        h.button(t("streamer.pug.cancel"), () => h.perform("pug/cancel", {})),
      );
    }
    return;
  }

  // Done: offer the next one.
  if (h.owner) container.append(el("h3", "", t("streamer.pug.next")));
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
    container.append(h.quiet(t("streamer.leaderboard.loading")));
    return;
  }
  const month = new Date(`${board.month}-01T00:00:00Z`).toLocaleDateString(dateLocale(), {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  container.append(
    el(
      "div",
      "dc-streamer-pug-champion",
      el(
        "strong",
        "",
        board.champion
          ? t("streamer.leaderboard.champion", { name: board.champion.name })
          : t("streamer.leaderboard.upForGrabs"),
      ),
      h.quiet(
        board.champion
          ? t("streamer.leaderboard.championLine", { month, count: board.champion.wins })
          : t("streamer.leaderboard.noChampion", { month }),
      ),
      board.previousChampion
        ? h.quiet(
            t("streamer.leaderboard.lastMonth", {
              name: board.previousChampion.name,
              count: board.previousChampion.wins,
            }),
          )
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
        el("th", "", t("streamer.leaderboard.player")),
        el("th", "", t("streamer.leaderboard.wins")),
        el("th", "", t("streamer.leaderboard.played")),
        el("th", "", "FACEIT"),
      ),
    ),
  );
  const body = el("tbody", "");
  board.rows.forEach((row, index) => {
    const faceit =
      row.faceitNickname === null
        ? "—"
        : row.faceitLevel
          ? t("streamer.leaderboard.eloWithLevel", { level: row.faceitLevel, elo: row.faceitElo ?? "?" })
          : t("streamer.leaderboard.elo", { elo: row.faceitElo ?? "?" });
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
  if (!board.rows.length) body.append(el("tr", "", el("td", "", ""), el("td", "", t("streamer.leaderboard.empty"))));
  table.append(body);
  container.append(el("div", "dc-streamer-pug-board-wrap", table));

  container.append(el("h3", "", t("streamer.leaderboard.yourAccount")));
  if (board.myFaceit) {
    container.append(
      h.quiet(
        board.myFaceit.elo
          ? t("streamer.leaderboard.linkedWithElo", { nickname: board.myFaceit.nickname, elo: board.myFaceit.elo })
          : t("streamer.leaderboard.linked", { nickname: board.myFaceit.nickname }),
      ),
      h.button(t("streamer.leaderboard.unlink"), () => h.unlinkFaceit()),
    );
  } else if (!board.faceitAvailable) {
    container.append(h.quiet(t("streamer.leaderboard.unavailable")));
  } else {
    container.append(
      h.quiet(t("streamer.leaderboard.signInIntro")),
      h.button(t("streamer.leaderboard.signIn"), () => h.signInFaceit(), true),
    );
  }
}
