import {
  isCreator,
  isLive,
  localMediaPath,
  publicStreamUrl,
  type QueuePage,
  type StreamerEvent,
  type StreamerSnapshot,
  type StreamerConfig,
} from "../../shared/streamer-mode";
import { createStreamerApi, type StreamerTransport } from "./api";
import { action, el, field, formValues, icon } from "./dom";
import { OFFICIAL_ABOUT, OFFICIAL_ANNOUNCEMENTS, OFFICIAL_RESOURCES, OFFICIAL_ROADMAP } from "./official-content";
import { localeForLanguage, preferredTimeOptions } from "../app/locale";
import type { Leaderboard } from "../../shared/streamer-pugs";
import { pugStatusLine, renderLeaderboard, renderPugPanel, teamRoom, type VoiceRoomRef } from "./community";

export type StreamerActions = {
  /** Must delegate to the EXISTING native event composer/calendar, not a new DB. */
  createEvent(): void;
  openCalendar(): void;
  openEvent(event: StreamerEvent, mode: "view" | "manage"): void;
  composeAnnouncement(): void;
  findSquad(): void;
  manageHub(): void;
  openExternal(url: string): void;
  /** Resolve only media already authorized for every member of this Hub. */
  mediaUrl(path: string): string;
  openModeration?: () => void;
  /** Opens a room of this Hub by name; returns false when it does not exist. */
  openRoom?: (name: string) => boolean;
  /** Opens a third-party sign-in page (FACEIT) in the browser; desktop uses the system browser. */
  openSignIn?: (url: string) => void;
  /** Joins (or switches to) a voice room of this Hub. */
  joinVoiceRoom?: (roomId: number) => void;
  /** The voice room this account is connected to right now, or null. */
  currentVoiceRoomId?: () => number | null;
};
export type StreamerOverviewOptions = {
  accountId: string;
  hubId: number;
  hubName: string;
  bannerPath?: string;
  events: StreamerEvent[];
  announcementAvailable: boolean;
  /** DeCave Official: private onboarding hub, so creator/community tools are replaced by guides. */
  official?: boolean;
  isDesktop?: boolean;
  /** This Hub's voice rooms (PUG team rooms). */
  voiceRooms?: VoiceRoomRef[];
  transport: StreamerTransport;
  actions: StreamerActions;
};
type Panel = "settings" | "queue" | "highlights" | "analytics" | "giveaway" | "welcome" | "pug" | "leaderboard" | null;
type Controller = { update(options: StreamerOverviewOptions): void; destroy(): void };
const LABELS: Record<Exclude<Panel, null>, string> = {
  settings: "Stream settings",
  queue: "Community session",
  highlights: "Curate highlights",
  analytics: "Community activity",
  giveaway: "Community giveaway",
  welcome: "Welcome to this Hub",
  pug: "Community PUG",
  leaderboard: "Leaderboard",
};
/** Panels every member can open (the rest are creator tools). */
const MEMBER_PANELS: Panel[] = ["welcome", "pug", "leaderboard"];
const OFFICIAL_LABELS: Partial<typeof LABELS> = {
  settings: "Welcome guide",
  analytics: "New members",
  welcome: "Welcome to DeCave",
};
const formatNumber = (n: number) => n.toLocaleString();
function renderKey(options: StreamerOverviewOptions): string {
  const { hubName, bannerPath, events, announcementAvailable, official, isDesktop } = options;
  return JSON.stringify({ hubName, bannerPath, events, announcementAvailable, official, isDesktop });
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to complete this action.";
}
function image(path: string, options: StreamerOverviewOptions, alt: string): HTMLImageElement | null {
  try {
    const checked = localMediaPath(path);
    if (!checked) return null;
    const result = el("img", "");
    result.src = options.actions.mediaUrl(checked);
    result.alt = alt;
    result.loading = "lazy";
    result.referrerPolicy = "no-referrer";
    result.addEventListener("error", () => result.remove(), { once: true });
    return result;
  } catch {
    return null;
  }
}
function quiet(text: string): HTMLElement {
  return el("p", "dc-streamer-muted", text);
}
function card(title: string, symbol: string, description: string, button: HTMLButtonElement, detail = ""): HTMLElement {
  return el(
    "article",
    "dc-streamer-card",
    el("div", "dc-streamer-card-head", icon(symbol), el("h3", "", title)),
    detail ? el("p", "dc-streamer-detail", detail) : null,
    quiet(description),
    button,
  );
}

/** "Subscribers only · 7+ days in the Hub · Subscribers get 2 entries", or "" without rules. */
function giveawayRuleLine(conditions: { subsOnly: boolean; minMemberDays: number; subBonus: boolean } | undefined) {
  if (!conditions) return "";
  const parts: string[] = [];
  if (conditions.subsOnly) parts.push("Twitch subscribers only");
  if (conditions.minMemberDays)
    parts.push(`${conditions.minMemberDays}+ ${conditions.minMemberDays === 1 ? "day" : "days"} in the Hub`);
  if (conditions.subBonus) parts.push("Subscribers get 2 entries");
  return parts.join(" · ");
}

/** Mount inside the existing center workspace ONLY. Does not select or edit any shell node. */
export function mountStreamerOverview(root: HTMLElement, initial: StreamerOverviewOptions): Controller {
  let options = initial;
  let api = createStreamerApi(initial.hubId, initial.transport);
  let snapshot: StreamerSnapshot | null = null;
  let disposed = false;
  let busy = false;
  let panel: Panel = null;
  let previewMember = false;
  let lastError = "";
  let failures = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let offset = 0;
  let snapshotAbort: AbortController | null = null;
  let panelAbort: AbortController | null = null;
  const mutations = new Set<AbortController>();
  let queueCursor: string | undefined;
  let queuePageAfter: string | undefined;
  let queueRows: QueuePage["entries"] = [];
  let focusBeforePanel: HTMLElement | null = null;
  let board: Leaderboard | null = null;
  let boardError = "";
  /** PUGs whose team voice switch already happened (or was offered) on this device. */
  const pugVoiceHandled = new Set<string>();
  const host = el("section", "dc-streamer-overview");
  host.setAttribute("aria-label", "Streamer Hub Overview");
  const status = el("div", "dc-streamer-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const content = el("div", "dc-streamer-content");
  const panelHost = el("div", "dc-streamer-panel-host");
  host.append(status, content, panelHost);
  root.append(host);
  const now = () => Date.now() + offset;
  const ownerView = () => Boolean(snapshot && isCreator(snapshot.role) && !previewMember);
  function announce(value: string, error = false) {
    status.textContent = value;
    status.classList.toggle("is-error", error);
  }
  function guardedNative(fn: () => void) {
    if (previewMember) return;
    try {
      fn();
    } catch (error) {
      announce(message(error), true);
    }
  }
  function button(label: string, fn: () => void, primary = false, allowPreview = false): HTMLButtonElement {
    const result = action(label, fn, primary);
    result.disabled = busy || (previewMember && !allowPreview);
    return result;
  }
  function openLink(raw: string) {
    try {
      options.actions.openExternal(publicStreamUrl(raw, true));
    } catch (error) {
      announce(message(error), true);
    }
  }
  // de-cave.com pages open in a new tab on web; on desktop the main process
  // routes allowlisted https links to the system browser.
  function openSite(url: string) {
    if (!/^https:\/\/de-cave\.com(\/|$)/.test(url)) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }
  function planNext() {
    clearTimeout(timeout);
    if (disposed || document.hidden) return;
    const fast =
      panel === "queue" ||
      panel === "pug" ||
      snapshot?.queue.mine?.status === "called" ||
      (snapshot?.pug?.joined === true && snapshot.pug.status === "open");
    const delay = failures ? Math.min(60_000, 5000 * 2 ** failures) : fast ? 5000 : 20_000;
    timeout = setTimeout(() => void load(), delay);
  }
  async function load(): Promise<void> {
    if (disposed || document.hidden || snapshotAbort) return;
    const controller = new AbortController();
    snapshotAbort = controller;
    try {
      const value = await api.snapshot(controller.signal);
      if (disposed || controller.signal.aborted) return;
      if (!value.enabled || !value.config || !value.queue) throw new Error("This Hub's Streamer Mode is unavailable.");
      const previousSession = snapshot?.session?.id;
      snapshot = value;
      if (!isCreator(value.role)) {
        previewMember = false;
        if (panel && !MEMBER_PANELS.includes(panel)) closePanel();
      }
      switchToTeamVoice(value);
      offset = Date.parse(value.serverTime) - Date.now();
      failures = 0;
      lastError = "";
      announce("");
      renderContent();
      // Do not replace an open settings/highlight/giveaway form during polling.
      if (panel === "queue" && value.session) await loadQueue(false);
      else if (panel === "queue" && previousSession) renderPanel();
      if (panel === "analytics" || panel === "pug") renderPanel();
    } catch (error) {
      if (disposed || controller.signal.aborted) return;
      failures++;
      lastError = message(error);
      announce(lastError, true);
      if (!snapshot) renderContent();
    } finally {
      if (snapshotAbort === controller) snapshotAbort = null;
      planNext();
    }
  }
  async function perform(path: string, payload: unknown, closeOnSuccess = false): Promise<void> {
    if (disposed || busy || previewMember) return;
    busy = true;
    const controller = new AbortController();
    mutations.add(controller);
    host.setAttribute("aria-busy", "true");
    host.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
      if (!b.dataset.close) {
        b.dataset.busyWasDisabled = String(b.disabled);
        b.disabled = true;
      }
    });
    try {
      const result = await api.mutate(path, payload, controller.signal);
      if (disposed) return;
      // Saved, but something needs the creator's attention (e.g. Twitch auto-live couldn't link).
      announce(result?.notice ? `Saved. ${result.notice}` : "Saved.", Boolean(result?.notice));
      if (closeOnSuccess) closePanel();
      snapshotAbort?.abort();
      snapshotAbort = null;
      await load();
    } catch (error) {
      if (!disposed && !controller.signal.aborted) announce(message(error), true);
    } finally {
      mutations.delete(controller);
      busy = false;
      if (!disposed) {
        host.removeAttribute("aria-busy");
        renderContent();
        if (panel === "queue") await loadQueue(false);
        else if (panel && !["settings", "highlights", "giveaway"].includes(panel)) renderPanel();
        // Keep unsaved form values and restore their controls after failures.
        panelHost.querySelectorAll<HTMLButtonElement>("button[data-busy-was-disabled]").forEach((b) => {
          b.disabled = b.dataset.busyWasDisabled === "true";
          delete b.dataset.busyWasDisabled;
        });
      }
    }
  }
  function closePanel() {
    panel = null;
    panelAbort?.abort();
    panelAbort = null;
    panelHost.replaceChildren();
    const previous = focusBeforePanel;
    if (previous?.isConnected) previous.focus();
    else if (previous?.textContent)
      Array.from(content.querySelectorAll<HTMLButtonElement>("button"))
        .find((candidate) => candidate.textContent === previous.textContent && !candidate.disabled)
        ?.focus();
    focusBeforePanel = null;
  }
  function openPanel(next: Panel) {
    if (!snapshot || !next) return;
    if (!ownerView() && !MEMBER_PANELS.includes(next)) return;
    focusBeforePanel = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel = next;
    queueRows = [];
    queueCursor = undefined;
    queuePageAfter = undefined;
    renderPanel();
    panelHost.querySelector<HTMLElement>("h2")?.focus();
    if (next === "queue") void loadQueue(false);
    if (next === "leaderboard") void loadLeaderboard();
  }
  async function loadLeaderboard() {
    panelAbort?.abort();
    const controller = new AbortController();
    panelAbort = controller;
    board = null;
    boardError = "";
    try {
      board = await api.leaderboard(controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      boardError = message(error);
    }
    if (!disposed && panel === "leaderboard") renderPanel();
  }
  async function faceitAction(work: (signal: AbortSignal) => Promise<unknown>, done: string) {
    if (busy) return;
    busy = true;
    const controller = new AbortController();
    try {
      await work(controller.signal);
      announce(done);
    } catch (error) {
      announce(message(error), true);
    } finally {
      busy = false;
    }
    await loadLeaderboard();
  }
  async function twitchAction(work: (signal: AbortSignal) => Promise<unknown>, done: string) {
    if (busy) return;
    busy = true;
    try {
      await work(new AbortController().signal);
      announce(done);
    } catch (error) {
      announce(message(error), true);
    } finally {
      busy = false;
    }
    snapshotAbort?.abort();
    snapshotAbort = null;
    await load();
  }
  /** Opens Twitch sign-in, then refreshes until the link appears (up to 2 minutes). */
  async function startTwitchSignIn() {
    if (busy) return;
    let target = "";
    try {
      target = (await api.connectTwitch(new AbortController().signal)).url;
    } catch (error) {
      announce(message(error), true);
      return;
    }
    if (!/^https:\/\/id\.twitch\.tv\//.test(target)) {
      announce("Twitch sign-in isn't available right now.", true);
      return;
    }
    if (options.actions.openSignIn) options.actions.openSignIn(target);
    else window.open(target, "_blank", "noopener,noreferrer");
    announce("Finish signing in with Twitch in your browser. This page updates by itself.");
    const stopAt = Date.now() + 2 * 60_000;
    const check = async () => {
      if (disposed || Date.now() > stopAt) return;
      snapshotAbort?.abort();
      snapshotAbort = null;
      await load();
      if (snapshot?.twitchMember?.linked) {
        announce(`Twitch linked as ${snapshot.twitchMember.login}.`);
        return;
      }
      setTimeout(() => void check(), 3000);
    };
    setTimeout(() => void check(), 3000);
  }
  /** Opens FACEIT sign-in, then checks for the new link every 2 s for up to 2 minutes. */
  async function startFaceitSignIn() {
    if (busy) return;
    let target = "";
    try {
      target = (await api.connectFaceit(new AbortController().signal)).url;
    } catch (error) {
      announce(message(error), true);
      return;
    }
    if (!/^https:\/\/([a-z0-9-]+\.)*faceit\.com\//.test(target)) {
      announce("FACEIT sign-in isn't available right now.", true);
      return;
    }
    if (options.actions.openSignIn) options.actions.openSignIn(target);
    else window.open(target, "_blank", "noopener,noreferrer");
    announce("Finish signing in with FACEIT in your browser. This panel updates by itself.");
    const stopAt = Date.now() + 2 * 60_000;
    const check = async () => {
      if (disposed || panel !== "leaderboard" || Date.now() > stopAt) return;
      try {
        const latest = await api.leaderboard(new AbortController().signal);
        if (latest.myFaceit) {
          board = latest;
          announce(`FACEIT linked as ${latest.myFaceit.nickname}.`);
          renderPanel();
          return;
        }
      } catch {
        /* keep trying until the deadline */
      }
      setTimeout(() => void check(), 2000);
    };
    setTimeout(() => void check(), 2000);
  }
  /** When a PUG starts, players already in this Hub's voice move to their team room once. */
  function switchToTeamVoice(data: StreamerSnapshot) {
    const pug = data.pug;
    if (!pug || pug.status !== "live" || !pug.myTeam || pugVoiceHandled.has(pug.id)) return;
    pugVoiceHandled.add(pug.id);
    const room = teamRoom(pug);
    const current = options.actions.currentVoiceRoomId?.() ?? null;
    const hubRooms = new Set((options.voiceRooms ?? []).map((voice) => voice.id));
    if (room && current !== null && current !== room && hubRooms.has(current)) {
      options.actions.joinVoiceRoom?.(room);
      announce(`Teams are set: moving you to ${pug.myTeam === "a" ? "Team A" : "Team B"} voice.`);
    } else if (room && current !== room) {
      announce(
        `Teams are set: you're on ${pug.myTeam === "a" ? "Team A" : "Team B"}. Open the PUG to join your team voice.`,
      );
    }
  }
  function panelForm(submitLabel: string, submit: (values: Record<string, unknown>, form: HTMLFormElement) => void) {
    const form = el("form", "dc-streamer-form");
    const submitButton = el("button", "dc-streamer-button is-primary", submitLabel);
    submitButton.type = "submit";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!busy && form.reportValidity()) submit(formValues(form), form);
    });
    return { form, submitButton };
  }
  // Rebuilding the scroll container's children must not move the reader:
  // keep the scroll position across every re-render.
  function renderContent() {
    const scrollTop = content.scrollTop;
    renderContentChildren();
    content.scrollTop = scrollTop;
  }
  function renderContentChildren() {
    const activeElement = document.activeElement;
    const focusedLabel =
      activeElement instanceof HTMLButtonElement && content.contains(activeElement) ? activeElement.textContent : null;
    if (!snapshot) {
      content.replaceChildren(
        el(
          "div",
          "dc-streamer-empty",
          el("h2", "", "Streamer Overview"),
          quiet(lastError || "Loading your community…"),
          lastError ? action("Retry", () => void load()) : null,
        ),
      );
      return;
    }
    const data = snapshot;
    const owner = ownerView();
    const config = data.config;
    const displayName = config.creatorName || options.hubName;
    host.dataset.role = owner ? "creator" : "member";
    const toolbar = el(
      "header",
      "dc-streamer-toolbar",
      el(
        "div",
        "",
        el("span", "dc-streamer-eyebrow", options.official ? "OFFICIAL HUB" : "STREAMER MODE"),
        el(
          "h2",
          "",
          options.official
            ? owner
              ? "Welcome every new DeCave member"
              : "Start here"
            : owner
              ? "Your community, in one place"
              : `${options.hubName} Overview`,
        ),
      ),
    );
    if (isCreator(data.role)) {
      const preview = action(previewMember ? "Back to creator view" : "Preview member view", () => {
        previewMember = !previewMember;
        closePanel();
        renderContent();
      });
      preview.setAttribute("aria-pressed", String(previewMember));
      toolbar.append(preview);
    }
    const live = isLive(config, now());
    const hero = el("section", "dc-streamer-hero");
    const visual = options.bannerPath ? image(options.bannerPath, options, "") : null;
    if (visual) {
      // The whole banner is shown (never cropped) over a blurred copy that fills the rest.
      const backdrop = visual.cloneNode() as HTMLImageElement;
      backdrop.className = "dc-streamer-hero-backdrop";
      backdrop.alt = "";
      backdrop.addEventListener("error", () => backdrop.remove(), { once: true });
      visual.className = "dc-streamer-hero-image";
      hero.append(backdrop, visual);
    }
    const heroBody = el(
      "div",
      "dc-streamer-hero-body",
      options.official
        ? el("span", "dc-streamer-live", "✓ OFFICIAL")
        : el("span", `dc-streamer-live${live ? " is-live" : ""}`, live ? "LIVE · Creator status" : "OFFLINE"),
      el("h1", "", live ? `${displayName} is live` : `Welcome to ${options.hubName}`),
      quiet(config.streamTitle || config.tagline),
      el(
        "div",
        "dc-streamer-tags",
        config.game ? el("span", "", config.game) : null,
        config.language ? el("span", "", config.language) : null,
      ),
    );
    if (options.official) {
      renderOfficial(data, owner, hero, heroBody, toolbar);
      return;
    }
    const heroActions = el("div", "dc-streamer-actions");
    if (config.streamUrl) {
      heroActions.append(
        button(live ? "Watch Stream ↗" : "Visit Channel ↗", () => openLink(config.streamUrl), true, true),
      );
    }
    if (owner)
      heroActions.append(
        button(
          data.session ? "Manage Live Session" : "Start Community Session",
          () => openPanel("queue"),
          !config.streamUrl,
        ),
      );
    else heroActions.append(joinButton(data, true));
    heroBody.append(heroActions);
    hero.append(heroBody);
    const heroRow = el("div", `dc-streamer-hero-row${owner ? " is-creator" : ""}`, hero);
    if (owner) {
      const tools = el("section", "dc-streamer-tools", el("h3", "", "Creator Tools"));
      const tool = (label: string, symbol: string, handler: () => void) => {
        const row = button(label, handler);
        row.prepend(icon(symbol));
        tools.append(row);
      };
      tool("Stream settings", "settings", () => openPanel("settings"));
      tool("Manage queue", "queue", () => openPanel("queue"));
      tool("Create event", "calendar", () => guardedNative(options.actions.createEvent));
      if (options.announcementAvailable) {
        tool("Send announcement", "announce", () => guardedNative(options.actions.composeAnnouncement));
      }
      tool("Curate highlights", "star", () => openPanel("highlights"));
      if (data.features.giveaways) tool("Run giveaway", "gift", () => openPanel("giveaway"));
      if (options.actions.openModeration)
        tool("Moderation", "settings", () => guardedNative(options.actions.openModeration!));
      heroRow.append(tools);
    }
    const tiles = el("div", "dc-streamer-tiles");
    if (owner) {
      tiles.append(
        card(
          "Community Queue",
          "queue",
          "Ready checks, fair turns, and controlled session rotation.",
          button(data.session ? "Manage Queue" : "Open Queue", () => openPanel("queue")),
          `${formatNumber(data.queue.waiting)} waiting`,
        ),
        ...communityCards(data),
        card(
          "Upcoming Events",
          "calendar",
          "Plan the next community night using your Hub calendar.",
          button("Create Event", () => guardedNative(options.actions.createEvent), true),
          `${options.events.length} scheduled`,
        ),
        card(
          "Community Activity",
          "chart",
          "See community participation across recent sessions.",
          button("View Analytics", () => openPanel("analytics")),
        ),
        card(
          "Manage Hub",
          "settings",
          "Update your existing Hub settings, roles, and banner.",
          button("Open Settings", () => guardedNative(options.actions.manageHub)),
        ),
      );
    } else {
      tiles.append(
        card(
          "Community Queue",
          "queue",
          queueDescription(data),
          joinButton(data),
          `${formatNumber(data.queue.waiting)} waiting`,
        ),
        ...communityCards(data),
        card(
          "Find a Squad",
          "game",
          "Find teammates and play together in DeCave.",
          button("Find a Squad", () => guardedNative(options.actions.findSquad), true),
        ),
        card(
          "Upcoming Events",
          "calendar",
          "Take part in the next community night.",
          button("View Events", () => guardedNative(options.actions.openCalendar)),
        ),
        card(
          "New Here?",
          "star",
          "Read the welcome guide and get to know this community.",
          button("Get Started", () => openPanel("welcome"), false, true),
        ),
      );
    }
    const events = el("section", "dc-streamer-section");
    const eventHead = el("header", "dc-streamer-section-head", el("h3", "", "Upcoming Events"));
    if (owner) eventHead.append(button("+ Create Event", () => guardedNative(options.actions.createEvent)));
    eventHead.append(button("View All", () => guardedNative(options.actions.openCalendar)));
    events.append(eventHead);
    const eventsGrid = el("div", "dc-streamer-event-grid");
    const upcoming = options.events
      .filter((e) => Number.isFinite(Date.parse(e.startAt)) && Date.parse(e.startAt) >= now() - 3_600_000)
      .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
      .slice(0, 3);
    for (const event of upcoming) {
      const start = new Date(event.startAt);
      const date = el(
        "time",
        "dc-streamer-date",
        el("small", "", start.toLocaleDateString(localeForLanguage(), { month: "short" })),
        String(start.getDate()),
      );
      date.dateTime = event.startAt;
      const row = el(
        "article",
        "dc-streamer-event",
        date,
        el(
          "div",
          "",
          el("h4", "", event.title),
          quiet(
            start.toLocaleString(localeForLanguage(), {
              weekday: "short",
              hour: "numeric",
              minute: "2-digit",
              timeZoneName: "short",
              ...preferredTimeOptions(),
            }),
          ),
        ),
        button(owner ? "Manage Event" : "View Event", () =>
          guardedNative(() => options.actions.openEvent(event, owner ? "manage" : "view")),
        ),
      );
      eventsGrid.append(row);
    }
    if (!upcoming.length)
      eventsGrid.append(
        quiet(
          owner
            ? "No upcoming events. Create your first community night."
            : "No events scheduled yet. Check back soon.",
        ),
      );
    events.append(eventsGrid);
    const highlights = el("section", "dc-streamer-section");
    const highlightHead = el("header", "dc-streamer-section-head", el("h3", "", "Latest from the Community"));
    if (owner) highlightHead.append(button("Curate Highlights", () => openPanel("highlights")));
    highlights.append(highlightHead);
    const clips = el("div", "dc-streamer-clips");
    for (const highlight of data.highlights.slice(0, 4)) {
      const clip = button("Watch ↗", () => openLink(highlight.url), false, true);
      const thumbnail = highlight.thumbnailPath ? image(highlight.thumbnailPath, options, "") : null;
      const preview = el("div", "dc-streamer-clip-preview", thumbnail, icon("live"));
      clips.append(el("article", "dc-streamer-clip", preview, el("h4", "", highlight.title), clip));
    }
    if (!data.highlights.length)
      clips.append(
        quiet(
          owner
            ? "Add approved community clips. Only direct Twitch/YouTube links are opened."
            : "Community highlights will appear here.",
        ),
      );
    highlights.append(clips);
    const sections: Node[] = [toolbar];
    if (previewMember)
      sections.push(
        el(
          "div",
          "dc-streamer-preview-note",
          "Member preview — participation actions are disabled. Your permissions have not changed.",
        ),
      );
    sections.push(heroRow, tiles, events, highlights);
    if (!owner && data.giveaways.length) {
      const giveaways = el("section", "dc-streamer-section", el("h3", "", "Community Giveaways"));
      for (const giveaway of data.giveaways) {
        const closed = giveaway.status !== "open" || Date.parse(giveaway.closesAt) <= now();
        const enter = button(
          giveaway.entered ? "Entered" : closed ? "Entries Closed" : "Enter Free Giveaway",
          () => void perform("giveaways/enter", { id: giveaway.id }),
        );
        enter.disabled ||= closed || giveaway.entered;
        giveaways.append(
          el(
            "article",
            "dc-streamer-giveaway",
            el("h4", "", giveaway.title),
            quiet(giveaway.rules),
            giveawayRuleLine(giveaway.conditions)
              ? el("p", "dc-streamer-detail", giveawayRuleLine(giveaway.conditions))
              : null,
            quiet(`Closes ${new Date(giveaway.closesAt).toLocaleString(localeForLanguage(), preferredTimeOptions())}`),
            giveaway.winnerName ? quiet(`Winner: ${giveaway.winnerName}`) : null,
            enter,
          ),
        );
      }
      sections.push(giveaways);
    }
    content.replaceChildren(...sections);
    if (focusedLabel)
      Array.from(content.querySelectorAll<HTMLButtonElement>("button"))
        .find((b) => b.textContent === focusedLabel && !b.disabled)
        ?.focus({ preventScroll: true });
    // Polling must not steal focus from a form in the separate panel host.
    if (activeElement instanceof HTMLElement && panelHost.contains(activeElement))
      activeElement.focus({ preventScroll: true });
  }
  function renderOfficial(
    data: StreamerSnapshot,
    owner: boolean,
    hero: HTMLElement,
    heroBody: HTMLElement,
    toolbar: HTMLElement,
  ) {
    const rooms = options.actions.openRoom;
    const room = (name: string) => () =>
      guardedNative(() => {
        if (!rooms?.(name)) announce(`#${name} isn't available in this Hub.`, true);
      });
    const heroActions = el("div", "dc-streamer-actions");
    if (owner) {
      heroActions.append(button("Post Announcement", room("announcements"), true));
      heroActions.append(button("Edit Welcome Guide", () => openPanel("settings")));
    } else {
      heroActions.append(button("Get Started", () => openPanel("welcome"), true, true));
      heroActions.append(button("Read the Rules", room("rules"), false, true));
    }
    heroBody.append(heroActions);
    hero.append(heroBody);
    const heroRow = el("div", `dc-streamer-hero-row${owner ? " is-creator" : ""}`, hero);
    if (owner) {
      const tools = el("section", "dc-streamer-tools", el("h3", "", "Official Hub Tools"));
      const tool = (label: string, symbol: string, handler: () => void) => {
        const row = button(label, handler);
        row.prepend(icon(symbol));
        tools.append(row);
      };
      tool("Post announcement", "announce", room("announcements"));
      tool("Publish patch notes", "star", room("patch-notes"));
      tool("Update FAQ", "queue", room("faq"));
      tool("Edit rules", "settings", room("rules"));
      tool("Edit welcome guide", "settings", () => openPanel("settings"));
      if (options.actions.openModeration)
        tool("Moderation", "settings", () => guardedNative(options.actions.openModeration!));
      heroRow.append(tools);
    }
    const tiles = el("div", "dc-streamer-tiles");
    if (owner) {
      const growth = data.stats
        ? `${formatNumber(data.stats.memberCount)} members · +${formatNumber(data.stats.joinedLast7Days)} this week`
        : "";
      tiles.append(
        card(
          "New Members",
          "chart",
          "Everyone joins this Hub on sign-up. Members can't see each other.",
          button("View Growth", () => openPanel("analytics")),
          growth,
        ),
        card(
          "Announcements",
          "announce",
          "News and important updates for every DeCave user.",
          button("Open #announcements", room("announcements"), true),
        ),
        card(
          "Patch Notes",
          "star",
          "Readable notes for every release on web, Windows and Mac.",
          button("Open #patch-notes", room("patch-notes")),
        ),
        card(
          "Manage Hub",
          "settings",
          "Banner, icon, rooms and roles for DeCave Official.",
          button("Open Settings", () => guardedNative(options.actions.manageHub)),
        ),
      );
    } else {
      tiles.append(
        card(
          "New Here?",
          "star",
          "A two-minute guide to profiles, friends, squads and Hubs.",
          button("Get Started", () => openPanel("welcome"), true, true),
        ),
        card(
          "FAQ",
          "queue",
          "Quick answers about accounts, privacy, voice and the desktop app.",
          button("Open FAQ", room("faq"), false, true),
        ),
        card(
          "Roadmap",
          "chart",
          "What's shipped, what we're building now and what comes next.",
          button(
            "See the Roadmap",
            () => {
              if (!options.actions.openRoom?.("roadmap")) openSite("https://de-cave.com/roadmap");
            },
            false,
            true,
          ),
        ),
        card(
          "What's New",
          "announce",
          "Announcements and patch notes from the DeCave team.",
          button("See Updates", room("patch-notes"), false, true),
        ),
      );
      if (!options.isDesktop)
        tiles.append(
          card(
            "Get the Desktop App",
            "live",
            "Game detection, notifications and push-to-talk on Windows and Mac.",
            button("Download ↗", () => openSite("https://de-cave.com/#download"), false, true),
          ),
        );
    }
    const privacy = el(
      "section",
      "dc-streamer-section",
      el("header", "dc-streamer-section-head", el("h3", "", "Your privacy here")),
      quiet(
        "This Hub is private for everyone. Members can't see who else is here, and only the DeCave team can post. Report anything that breaks the rules by right-clicking a message or profile.",
      ),
    );
    const sections: Node[] = [toolbar];
    if (previewMember)
      sections.push(
        el(
          "div",
          "dc-streamer-preview-note",
          "Member preview — participation actions are disabled. Your permissions have not changed.",
        ),
      );
    sections.push(heroRow, tiles, ...officialInfoSections(), privacy);
    content.replaceChildren(...sections);
  }
  function officialInfoSections(): HTMLElement[] {
    const section = (title: string, ...children: Array<Node | null>) =>
      el(
        "section",
        "dc-streamer-section dc-official-section",
        el("header", "dc-streamer-section-head", el("h3", "", title)),
        ...children,
      );
    const about = section(
      OFFICIAL_ABOUT.title,
      el(
        "div",
        "dc-official-about",
        el(
          "div",
          "dc-official-about-copy",
          quiet(OFFICIAL_ABOUT.body),
          el("p", "dc-official-alpha", el("strong", "", "Alpha. "), OFFICIAL_ABOUT.alphaNote),
        ),
        el(
          "dl",
          "dc-official-facts",
          ...OFFICIAL_ABOUT.facts.map((fact) => el("div", "", el("dt", "", fact.label), el("dd", "", fact.value))),
        ),
      ),
    );
    const announcementsHead = section(
      "Announcements",
      el(
        "ol",
        "dc-official-news",
        ...OFFICIAL_ANNOUNCEMENTS.map((item) =>
          el(
            "li",
            "",
            el("div", "dc-official-news-meta", el("span", "dc-official-tag", item.tag), el("time", "", item.date)),
            el("h4", "", item.title),
            quiet(item.body),
          ),
        ),
      ),
    );
    const openAnnouncements = button(
      "Open #announcements",
      () => {
        if (!options.actions.openRoom?.("announcements")) announce("#announcements isn't available in this Hub.", true);
      },
      false,
      true,
    );
    announcementsHead.querySelector(".dc-streamer-section-head")?.append(openAnnouncements);
    const roadmap = section(
      "Roadmap",
      el(
        "ol",
        "dc-official-roadmap",
        ...OFFICIAL_ROADMAP.map((item, index) =>
          el(
            "li",
            `is-step-${index}`,
            el("span", "dc-official-roadmap-state", item.state),
            el("h4", "", item.title),
            quiet(item.body),
          ),
        ),
      ),
    );
    const resources = section(
      "Helpful resources",
      el(
        "div",
        "dc-official-resources",
        ...OFFICIAL_RESOURCES.map((item) => {
          const link = el("a", "dc-official-resource", el("strong", "", item.label), el("small", "", item.detail));
          link.href = item.href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          return link;
        }),
      ),
    );
    return [about, announcementsHead, roadmap, resources];
  }
  function queueDescription(data: StreamerSnapshot): string {
    const mine = data.queue.mine;
    if (!data.session) return "No community session is open yet.";
    if (!mine)
      return data.session.status === "paused"
        ? "The queue is paused. Existing players keep their places."
        : "Join the queue to play with the creator.";
    if (mine.status === "waiting") return `Your position: ${mine.position ?? "—"}. One turn per session.`;
    if (mine.status === "called")
      return `Your turn! Accept before ${new Date(mine.callExpiresAt!).toLocaleTimeString(localeForLanguage(), preferredTimeOptions())}.`;
    if (mine.status === "ready")
      return "Ready accepted. Wait for the creator to start your group. Voice joining remains your choice.";
    if (mine.status === "playing") return "You're in the current group. Have a great game.";
    return "Your participation in this session has ended. Come back for the next one.";
  }
  /** PUG and Leaderboard cards, only on Hubs where DeCave staff switched them on. */
  function communityCards(data: StreamerSnapshot): HTMLElement[] {
    const cards: HTMLElement[] = [];
    if (data.features.pugs)
      cards.push(
        card(
          "Community PUG",
          "game",
          "Random teams, map vote, team voice rooms. Just for fun.",
          button(
            data.pug && data.pug.status === "open" && !data.pug.joined ? "Join PUG" : "Open PUG",
            () => openPanel("pug"),
            Boolean(data.pug && data.pug.status !== "done"),
            true,
          ),
          pugStatusLine(data.pug),
        ),
      );
    if (data.twitchMember) {
      const tm = data.twitchMember;
      const action = !tm.linked
        ? button("Link Twitch", () => void startTwitchSignIn(), true, true)
        : button(
            "Check again",
            () => void twitchAction((s) => api.recheckTwitch(s), "Subscription checked."),
            false,
            true,
          );
      cards.push(
        card(
          "Twitch Subscriber",
          "live",
          tm.linked
            ? "Subscribers get the Subs role and giveaway perks. Checked daily. Unlink anytime from here."
            : "Link your Twitch account: subscribers get the Subs role and giveaway perks.",
          action,
          !tm.linked ? "Not linked" : tm.subscribed ? `${tm.login} · Subscriber ✓` : `${tm.login} · Not subscribed`,
        ),
      );
      if (tm.linked)
        cards[cards.length - 1].append(
          button("Unlink Twitch", () => void twitchAction((s) => api.unlinkTwitch(s), "Twitch unlinked."), false, true),
        );
    }
    if (data.features.leaderboard)
      cards.push(
        card(
          "Leaderboard",
          "chart",
          "Monthly PUG wins and linked FACEIT ELO. Top player is Rifler of the month.",
          button("View Leaderboard", () => openPanel("leaderboard"), false, true),
        ),
      );
    return cards;
  }
  function joinButton(data: StreamerSnapshot, hero = false): HTMLButtonElement {
    const mine = data.queue.mine;
    const sessionId = data.session?.id;
    let label = hero ? "Join Community Queue" : "Join Queue";
    let path = "queue/join";
    if (mine?.status === "called") {
      label = "I'm Ready";
      path = "queue/ready";
    } else if (mine && ["waiting", "ready"].includes(mine.status)) {
      label = "Leave Queue";
      path = "queue/leave";
    } else if (mine?.status === "playing") label = "In Game";
    else if (mine) label = "Session Turn Completed";
    const result = button(label, () => void perform(path, { sessionId }), true);
    result.disabled ||=
      !sessionId ||
      (Boolean(mine) && ["playing", "done", "skipped", "left"].includes(mine!.status)) ||
      (!mine && data.session?.status !== "open");
    return result;
  }
  async function loadQueue(append: boolean) {
    if (!snapshot || !snapshot.session || panel !== "queue" || !ownerView() || disposed) return;
    panelAbort?.abort();
    const controller = new AbortController();
    panelAbort = controller;
    try {
      if (append) queuePageAfter = queueCursor;
      const result = await api.queue(controller.signal, queuePageAfter);
      if (disposed || controller.signal.aborted || panel !== "queue") return;
      queueRows = result.entries;
      queueCursor = result.nextCursor ?? undefined;
      renderPanel();
    } catch (error) {
      if (!disposed && !controller.signal.aborted) announce(message(error), true);
    } finally {
      if (panelAbort === controller) panelAbort = null;
    }
  }
  function renderPanel() {
    if (!panel || !snapshot || disposed) return;
    const name = panel;
    const data = snapshot;
    const container = el("section", "dc-streamer-panel");
    const label = (options.official && OFFICIAL_LABELS[name]) || LABELS[name];
    container.setAttribute("role", "dialog");
    container.setAttribute("aria-label", label);
    // Non-modal by design: the existing global navigation/friends UI stays usable.
    const title = el("h2", "", label);
    title.tabIndex = -1;
    const close = action("Close ×", closePanel);
    close.dataset.close = "true";
    container.append(el("header", "dc-streamer-panel-head", title, close));
    if (name === "settings") renderSettings(container, data.config);
    const community = {
      owner: ownerView(),
      voiceRooms: options.voiceRooms ?? [],
      button: (label: string, fn: () => void, primary = false) => button(label, fn, primary),
      quiet,
      perform: (path: string, payload: unknown) => void perform(path, payload),
      panelForm,
      joinVoiceRoom: options.actions.joinVoiceRoom,
    };
    if (name === "pug") renderPugPanel(container, data.pug, community);
    if (name === "leaderboard")
      renderLeaderboard(container, board, boardError, {
        ...community,
        signInFaceit: () => void startFaceitSignIn(),
        unlinkFaceit: () => void faceitAction((signal) => api.unlinkFaceit(signal), "FACEIT unlinked."),
      });
    if (name === "queue") renderQueue(container);
    if (name === "analytics") {
      container.append(
        quiet("Real aggregate data. Seven-day activity reflects this feature only, not all DeCave usage."),
      );
      const stats = data.stats;
      const grid = el("div", "dc-streamer-stats");
      if (stats)
        for (const [label, value] of [
          ["Hub members", stats.memberCount],
          ["Joined in 7 days", stats.joinedLast7Days],
          ["Sessions in 7 days", stats.sessionsLast7Days],
          ["Accepted/playing participants in 7 days", stats.playersLast7Days],
          ["Completed viewer seats in 7 days", stats.seatsCompletedLast7Days],
        ] as const)
          grid.append(el("article", "dc-streamer-stat", el("strong", "", formatNumber(value)), quiet(label)));
      container.append(grid);
    }
    if (name === "welcome")
      container.append(
        quiet(data.config.onboarding),
        ...(options.official ? [] : [el("h3", "", "Community session rules"), quiet(data.config.queueRules)]),
      );
    if (name === "highlights") {
      container.append(
        quiet(
          "Publish only community-approved clips. Thumbnails must already be Hub-wide DeCave media; private attachments are not allowed.",
        ),
      );
      const { form, submitButton } = panelForm(
        "Publish Highlight",
        (values) => void perform("highlights/add", values, true),
      );
      field(form, "title", "Title", "", { required: true, maxLength: 120 });
      field(form, "url", "Direct Twitch or YouTube link", "", { required: true, type: "url", maxLength: 500 });
      field(form, "thumbnailPath", "Optional existing Hub image path (/api/media/…)", "", { maxLength: 600 });
      form.append(submitButton);
      container.append(form);
      for (const highlight of data.highlights)
        container.append(
          el(
            "div",
            "dc-streamer-row",
            el("span", "", highlight.title),
            button("Remove", () => void perform("highlights/remove", { id: highlight.id }, true)),
          ),
        );
    }
    if (name === "giveaway") renderGiveaway(container);
    panelHost.replaceChildren(container);
  }
  function renderSettings(container: HTMLElement, config: StreamerConfig) {
    if (options.official) {
      container.append(quiet("Shown to every new member under Get Started. Line breaks are kept."));
      const { form, submitButton } = panelForm(
        "Save Welcome Guide",
        (values) =>
          void perform(
            "settings",
            {
              creatorName: config.creatorName,
              streamUrl: config.streamUrl,
              game: config.game,
              language: config.language,
              queueRules: config.queueRules,
              liveHours: 0,
              ...values,
              version: config.version,
            },
            true,
          ),
      );
      field(form, "tagline", "Banner tagline", config.tagline, { maxLength: 160 });
      field(form, "streamTitle", "Banner subtitle", config.streamTitle, { maxLength: 140 });
      field(form, "onboarding", "Welcome guide", config.onboarding, { multiline: true, maxLength: 1600 });
      form.append(submitButton);
      container.append(form);
      return;
    }
    container.append(
      quiet(
        "These settings update your DeCave Overview only. They do not start a broadcast or verify the creator's identity. Live status expires automatically.",
      ),
    );
    const { form, submitButton } = panelForm(
      "Save Stream Settings",
      (values) =>
        void perform("settings", { ...values, version: config.version, liveHours: Number(values.liveHours) }, true),
    );
    field(form, "creatorName", "Creator display name", config.creatorName, { maxLength: 80 });
    field(form, "tagline", "Community tagline", config.tagline, { maxLength: 160 });
    field(form, "streamUrl", "Twitch or YouTube channel/video URL", config.streamUrl, { type: "url", maxLength: 500 });
    field(form, "streamTitle", "Stream title", config.streamTitle, { maxLength: 140 });
    field(form, "game", "Game", config.game, { maxLength: 80 });
    field(form, "language", "Language", config.language, { maxLength: 40 });
    field(form, "liveHours", "Manual live status (hours; 0 = offline)", isLive(config, now()) ? "4" : "0", {
      type: "number",
      min: "0",
      max: "12",
      required: true,
    });
    if (snapshot?.features.twitch) {
      const autoLive = el("select", "dc-streamer-input");
      autoLive.name = "twitchAutoLive";
      autoLive.id = "dc-streamer-field-twitch-auto-live";
      autoLive.append(new Option("Off", "off"), new Option("On: follow my Twitch channel", "on"));
      autoLive.value = config.twitchAutoLive ? "on" : "off";
      const autoLiveLabel = el("label", "", "Go live automatically when my Twitch stream starts");
      autoLiveLabel.htmlFor = autoLive.id;
      form.append(
        el(
          "div",
          "dc-streamer-field",
          autoLiveLabel,
          autoLive,
          quiet('Needs a Twitch channel link above. Hub bots can announce it with the "Stream goes live" trigger.'),
        ),
      );
      const clips = el("select", "dc-streamer-input");
      clips.name = "twitchClips";
      clips.id = "dc-streamer-field-twitch-clips";
      clips.append(new Option("Off", "off"), new Option("On: post new clips in the clips forum", "on"));
      clips.value = config.twitchClips ? "on" : "off";
      const clipsLabel = el("label", "", "Post my new Twitch clips");
      clipsLabel.htmlFor = clips.id;
      form.append(
        el(
          "div",
          "dc-streamer-field",
          clipsLabel,
          clips,
          quiet(
            'Checked every hour. Clips go to the forum room with "clip" in its name; members react to pick Clip of the week (Mondays).',
          ),
        ),
      );
    }
    field(form, "queueRules", "Session rules", config.queueRules, { multiline: true, maxLength: 1600 });
    field(form, "onboarding", "Welcome guide", config.onboarding, { multiline: true, maxLength: 1600 });
    form.append(submitButton);
    container.append(form);
  }
  function renderQueue(container: HTMLElement) {
    if (!snapshot) return;
    const session = snapshot.session;
    if (!session) {
      container.append(
        quiet(
          "Create a community session. Viewer slots exclude the creator. Players accept their own ready checks; this does not force anyone into voice.",
        ),
      );
      const { form, submitButton } = panelForm(
        "Open Community Session",
        (values) =>
          void perform("session/create", {
            ...values,
            partySize: Number(values.partySize),
            readySeconds: Number(values.readySeconds),
          }),
      );
      field(form, "title", "Session title", "Community games", { required: true, maxLength: 100 });
      field(form, "game", "Game", snapshot.config.game, { required: true, maxLength: 80 });
      field(form, "partySize", "Viewer slots per group (not total Hub members)", "4", {
        type: "number",
        min: "1",
        max: "16",
        required: true,
      });
      field(form, "readySeconds", "Ready-check seconds", "90", {
        type: "number",
        min: "30",
        max: "300",
        required: true,
      });
      form.append(submitButton);
      container.append(form);
      return;
    }
    const payload = { sessionId: session.id, version: session.version };
    container.append(
      el("h3", "", session.title),
      quiet(`${session.game} · ${session.partySize} viewer slots · ${session.status.toUpperCase()}`),
      quiet(snapshot.config.queueRules),
    );
    const controls = el("div", "dc-streamer-actions");
    controls.append(
      button(
        session.status === "paused" ? "Resume Queue" : "Pause Queue",
        () => void perform(`session/${session.status === "paused" ? "resume" : "pause"}`, payload),
      ),
      button("Call Next Group", () => void perform("session/call-next", payload), true),
      button("Start Ready Players", () => void perform("session/start-ready", payload)),
      button("Finish Current Group", () => void perform("session/finish-playing", payload)),
    );
    const end = button("End Session", () => {
      const confirm = el(
        "div",
        "dc-streamer-confirm",
        quiet("End this session? The current group is completed and remaining queue entries are closed."),
        button("Confirm End Session", () => void perform("session/end", payload)),
        action("Keep Session", () => confirm.remove()),
      );
      controls.after(confirm);
    });
    end.classList.add("is-danger");
    controls.append(end);
    container.append(controls);
    container.append(
      quiet(
        `${snapshot.queue.waiting} waiting · ${snapshot.queue.called} called · ${snapshot.queue.ready} ready · ${snapshot.queue.playing} playing`,
      ),
    );
    const list = el("div", "dc-streamer-queue-list");
    for (const entry of queueRows) {
      const state = el("span", `dc-streamer-state is-${entry.status}`, entry.status);
      const row = el("div", "dc-streamer-row", el("span", "", entry.name), state);
      if (entry.callExpiresAt && entry.status === "called")
        row.append(
          el(
            "time",
            "dc-streamer-muted",
            `Until ${new Date(entry.callExpiresAt).toLocaleTimeString(localeForLanguage(), preferredTimeOptions())}`,
          ),
        );
      if (entry.status !== "playing")
        row.append(button("Skip", () => void perform("queue/skip", { entryId: entry.id })));
      list.append(row);
    }
    if (!queueRows.length) list.append(quiet("No active queue entries on this page."));
    container.append(list);
    if (queuePageAfter)
      container.append(
        button("First Page", () => {
          queuePageAfter = undefined;
          void loadQueue(false);
        }),
      );
    if (queueCursor) container.append(button("Next Page", () => void loadQueue(true)));
    container.append(
      quiet(
        "No one is moved to voice automatically. Use DeCave's existing permission-controlled voice rooms when participants are ready.",
      ),
    );
  }
  function renderGiveaway(container: HTMLElement) {
    if (!snapshot) return;
    if (!snapshot.features.giveaways) {
      container.append(quiet("Giveaways are disabled on this deployment."));
      return;
    }
    container.append(
      quiet(
        "Free entry only. Publish eligibility and prize-fulfilment rules before opening. The platform does not collect payments or deliver prizes. Drawing is available only after the closing time; winners cannot be rerolled.",
      ),
    );
    const { form, submitButton } = panelForm("Create Free Giveaway", (values) => {
      const date = new Date(String(values.closesAt));
      if (!Number.isFinite(date.getTime())) {
        announce("Choose a closing time.", true);
        return;
      }
      const rules = snapshot?.features.subRoles
        ? {
            subsOnly: values.subsOnly === "on",
            minMemberDays: Number(values.minMemberDays) || 0,
            subBonus: values.subBonus === "on",
          }
        : {};
      const { subsOnly: _a, minMemberDays: _b, subBonus: _c, ...base } = values;
      void perform("giveaways/create", { ...base, ...rules, closesAt: date.toISOString() }, true);
    });
    field(form, "title", "Giveaway title", "", { required: true, maxLength: 120 });
    field(form, "rules", "Eligibility, prize, and fulfilment rules", "", {
      required: true,
      multiline: true,
      maxLength: 2000,
    });
    field(form, "closesAt", "Closes at (your local time)", "", { required: true, type: "datetime-local" });
    if (snapshot.features.subRoles) {
      const choice = (name: string, label: string, on: string) => {
        const select = el("select", "dc-streamer-input");
        select.name = name;
        select.id = `dc-streamer-giveaway-${name}`;
        select.append(new Option("No", "off"), new Option(on, "on"));
        const title = el("label", "", label);
        title.htmlFor = select.id;
        form.append(el("div", "dc-streamer-field", title, select));
      };
      choice("subsOnly", "Who can enter", "Twitch subscribers only");
      choice("subBonus", "Subscriber bonus", "Subscribers get 2 entries");
      field(form, "minMemberDays", "Minimum days in the Hub (0 = none)", "0", {
        type: "number",
        min: "0",
        max: "365",
      });
    }
    form.append(submitButton);
    container.append(form);
    for (const giveaway of snapshot.giveaways) {
      const row = el(
        "article",
        "dc-streamer-giveaway",
        el("h3", "", giveaway.title),
        quiet(`${giveaway.entryCount} entries · ${giveaway.status}`),
        giveawayRuleLine(giveaway.conditions) ? quiet(giveawayRuleLine(giveaway.conditions)) : null,
      );
      if (giveaway.status === "open") {
        const draw = button("Draw Winner", () => void perform("giveaways/draw", { id: giveaway.id }, true));
        draw.disabled ||= Date.parse(giveaway.closesAt) > now();
        row.append(
          draw,
          button("Cancel Giveaway", () => void perform("giveaways/cancel", { id: giveaway.id }, true)),
        );
      } else if (giveaway.winnerName) row.append(quiet(`Winner: ${giveaway.winnerName}`));
      container.append(row);
    }
  }
  const onVisibility = () => {
    clearTimeout(timeout);
    if (document.hidden) snapshotAbort?.abort();
    else void load();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && panel && host.contains(event.target as Node)) {
      event.stopPropagation();
      closePanel();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  host.addEventListener("keydown", onKey);
  renderContent();
  void load();
  return {
    update(next) {
      if (next.hubId !== options.hubId || next.accountId !== options.accountId)
        throw new Error("Remount StreamerOverview when switching accounts or Hubs.");
      const changed = renderKey(next) !== renderKey(options);
      options = next;
      api = createStreamerApi(next.hubId, next.transport);
      // The parent re-renders often (activity clocks, presence); only rebuild
      // the DOM when something this view shows has actually changed.
      if (changed) renderContent();
    },
    destroy() {
      disposed = true;
      clearTimeout(timeout);
      snapshotAbort?.abort();
      panelAbort?.abort();
      for (const abort of mutations) abort.abort();
      document.removeEventListener("visibilitychange", onVisibility);
      host.removeEventListener("keydown", onKey);
      host.remove();
    },
  };
}
