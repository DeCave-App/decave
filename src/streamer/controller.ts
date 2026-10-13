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
import { officialAbout, officialAnnouncements, officialResources, officialRoadmap } from "./official-content";
import { preferredTimeOptions } from "../app/locale";
import { formatDate, formatNumber } from "../i18n/format";
import { dateLocale, t } from "./i18n";
import { noticeText } from "../i18n/notice";
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
const LABELS: Record<Exclude<Panel, null>, () => string> = {
  settings: () => t("streamer.panels.settings"),
  queue: () => t("streamer.panels.queue"),
  highlights: () => t("streamer.panels.highlights"),
  analytics: () => t("streamer.panels.analytics"),
  giveaway: () => t("streamer.panels.giveaway"),
  welcome: () => t("streamer.panels.welcome"),
  pug: () => t("streamer.panels.pug"),
  leaderboard: () => t("streamer.panels.leaderboard"),
};
/** Panels every member can open (the rest are creator tools). */
const MEMBER_PANELS: Panel[] = ["welcome", "pug", "leaderboard"];
const OFFICIAL_LABELS: Partial<typeof LABELS> = {
  settings: () => t("streamer.panels.officialSettings"),
  analytics: () => t("streamer.panels.officialAnalytics"),
  welcome: () => t("streamer.panels.officialWelcome"),
};
function renderKey(options: StreamerOverviewOptions): string {
  const { hubName, bannerPath, events, announcementAvailable, official, isDesktop } = options;
  return JSON.stringify({ hubName, bannerPath, events, announcementAvailable, official, isDesktop });
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : t("streamer.errors.generic");
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
  if (conditions.subsOnly) parts.push(t("streamer.giveaways.subsOnly"));
  if (conditions.minMemberDays) parts.push(t("streamer.giveaways.minDays", { count: conditions.minMemberDays }));
  if (conditions.subBonus) parts.push(t("streamer.giveaways.subBonus"));
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
  host.setAttribute("aria-label", t("streamer.overview.aria"));
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
      if (!value.enabled || !value.config || !value.queue) throw new Error(t("streamer.errors.unavailable"));
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
      const notice = noticeText(result?.noticeI18n) ?? result?.notice;
      announce(
        notice ? t("streamer.notices.savedWithNotice", { notice }) : t("streamer.notices.saved"),
        Boolean(notice),
      );
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
      announce(t("streamer.errors.twitchUnavailable"), true);
      return;
    }
    if (options.actions.openSignIn) options.actions.openSignIn(target);
    else window.open(target, "_blank", "noopener,noreferrer");
    announce(t("streamer.notices.twitchFinish"));
    const stopAt = Date.now() + 2 * 60_000;
    const check = async () => {
      if (disposed || Date.now() > stopAt) return;
      snapshotAbort?.abort();
      snapshotAbort = null;
      await load();
      if (snapshot?.twitchMember?.linked) {
        announce(t("streamer.notices.twitchLinked", { login: snapshot.twitchMember.login }));
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
      announce(t("streamer.errors.faceitUnavailable"), true);
      return;
    }
    if (options.actions.openSignIn) options.actions.openSignIn(target);
    else window.open(target, "_blank", "noopener,noreferrer");
    announce(t("streamer.notices.faceitFinish"));
    const stopAt = Date.now() + 2 * 60_000;
    const check = async () => {
      if (disposed || panel !== "leaderboard" || Date.now() > stopAt) return;
      try {
        const latest = await api.leaderboard(new AbortController().signal);
        if (latest.myFaceit) {
          board = latest;
          announce(t("streamer.notices.faceitLinked", { nickname: latest.myFaceit.nickname }));
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
    const team = () => (pug.myTeam === "a" ? t("streamer.pug.teamA") : t("streamer.pug.teamB"));
    const current = options.actions.currentVoiceRoomId?.() ?? null;
    const hubRooms = new Set((options.voiceRooms ?? []).map((voice) => voice.id));
    if (room && current !== null && current !== room && hubRooms.has(current)) {
      options.actions.joinVoiceRoom?.(room);
      announce(t("streamer.notices.teamsMoving", { team: team() }));
    } else if (room && current !== room) {
      announce(t("streamer.notices.teamsJoin", { team: team() }));
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
          el("h2", "", t("streamer.overview.title")),
          quiet(lastError || t("streamer.overview.loading")),
          lastError ? action(t("streamer.overview.retry"), () => void load()) : null,
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
        el(
          "span",
          "dc-streamer-eyebrow",
          options.official ? t("streamer.overview.eyebrowOfficial") : t("streamer.overview.eyebrowStreamer"),
        ),
        el(
          "h2",
          "",
          options.official
            ? owner
              ? t("streamer.overview.headingOfficialOwner")
              : t("streamer.overview.headingOfficialMember")
            : owner
              ? t("streamer.overview.headingOwner")
              : t("streamer.overview.headingMember", { hub: options.hubName }),
        ),
      ),
    );
    if (isCreator(data.role)) {
      const preview = action(
        previewMember ? t("streamer.overview.backToCreator") : t("streamer.overview.previewMember"),
        () => {
          previewMember = !previewMember;
          closePanel();
          renderContent();
        },
      );
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
        ? el("span", "dc-streamer-live", t("streamer.overview.badgeOfficial"))
        : el(
            "span",
            `dc-streamer-live${live ? " is-live" : ""}`,
            live ? t("streamer.overview.badgeLive") : t("streamer.overview.badgeOffline"),
          ),
      el(
        "h1",
        "",
        live
          ? t("streamer.overview.heroLive", { name: displayName })
          : t("streamer.overview.heroWelcome", { hub: options.hubName }),
      ),
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
        button(
          live ? t("streamer.overview.watchStream") : t("streamer.overview.visitChannel"),
          () => openLink(config.streamUrl),
          true,
          true,
        ),
      );
    }
    if (owner)
      heroActions.append(
        button(
          data.session ? t("streamer.overview.manageSession") : t("streamer.overview.startSession"),
          () => openPanel("queue"),
          !config.streamUrl,
        ),
      );
    else heroActions.append(joinButton(data, true));
    heroBody.append(heroActions);
    hero.append(heroBody);
    const heroRow = el("div", `dc-streamer-hero-row${owner ? " is-creator" : ""}`, hero);
    if (owner) {
      const tools = el("section", "dc-streamer-tools", el("h3", "", t("streamer.tools.heading")));
      const tool = (label: string, symbol: string, handler: () => void) => {
        const row = button(label, handler);
        row.prepend(icon(symbol));
        tools.append(row);
      };
      tool(t("streamer.tools.streamSettings"), "settings", () => openPanel("settings"));
      tool(t("streamer.tools.manageQueue"), "queue", () => openPanel("queue"));
      tool(t("streamer.tools.createEvent"), "calendar", () => guardedNative(options.actions.createEvent));
      if (options.announcementAvailable) {
        tool(t("streamer.tools.sendAnnouncement"), "announce", () =>
          guardedNative(options.actions.composeAnnouncement),
        );
      }
      tool(t("streamer.tools.curateHighlights"), "star", () => openPanel("highlights"));
      if (data.features.giveaways) tool(t("streamer.tools.runGiveaway"), "gift", () => openPanel("giveaway"));
      if (options.actions.openModeration)
        tool(t("streamer.tools.moderation"), "settings", () => guardedNative(options.actions.openModeration!));
      heroRow.append(tools);
    }
    const tiles = el("div", "dc-streamer-tiles");
    if (owner) {
      tiles.append(
        card(
          t("streamer.cards.queue.title"),
          "queue",
          t("streamer.cards.queue.ownerDescription"),
          button(data.session ? t("streamer.cards.queue.manage") : t("streamer.cards.queue.open"), () =>
            openPanel("queue"),
          ),
          waitingLine(data),
        ),
        ...communityCards(data),
        card(
          t("streamer.cards.events.title"),
          "calendar",
          t("streamer.cards.events.ownerDescription"),
          button(t("streamer.cards.events.create"), () => guardedNative(options.actions.createEvent), true),
          t("streamer.cards.events.scheduled", { count: options.events.length }),
        ),
        card(
          t("streamer.cards.activity.title"),
          "chart",
          t("streamer.cards.activity.description"),
          button(t("streamer.cards.activity.view"), () => openPanel("analytics")),
        ),
        card(
          t("streamer.cards.manageHub.title"),
          "settings",
          t("streamer.cards.manageHub.description"),
          button(t("streamer.cards.manageHub.open"), () => guardedNative(options.actions.manageHub)),
        ),
      );
    } else {
      tiles.append(
        card(t("streamer.cards.queue.title"), "queue", queueDescription(data), joinButton(data), waitingLine(data)),
        ...communityCards(data),
        card(
          t("streamer.cards.squad.title"),
          "game",
          t("streamer.cards.squad.description"),
          button(t("streamer.cards.squad.open"), () => guardedNative(options.actions.findSquad), true),
        ),
        card(
          t("streamer.cards.events.title"),
          "calendar",
          t("streamer.cards.events.memberDescription"),
          button(t("streamer.cards.events.view"), () => guardedNative(options.actions.openCalendar)),
        ),
        card(
          t("streamer.cards.newHere.title"),
          "star",
          t("streamer.cards.newHere.description"),
          button(t("streamer.cards.newHere.open"), () => openPanel("welcome"), false, true),
        ),
      );
    }
    const events = el("section", "dc-streamer-section");
    const eventHead = el("header", "dc-streamer-section-head", el("h3", "", t("streamer.cards.events.title")));
    if (owner)
      eventHead.append(button(t("streamer.events.createButton"), () => guardedNative(options.actions.createEvent)));
    eventHead.append(button(t("streamer.events.viewAll"), () => guardedNative(options.actions.openCalendar)));
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
        el("small", "", start.toLocaleDateString(dateLocale(), { month: "short" })),
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
            start.toLocaleString(dateLocale(), {
              weekday: "short",
              hour: "numeric",
              minute: "2-digit",
              timeZoneName: "short",
              ...preferredTimeOptions(),
            }),
          ),
        ),
        button(owner ? t("streamer.events.manage") : t("streamer.events.view"), () =>
          guardedNative(() => options.actions.openEvent(event, owner ? "manage" : "view")),
        ),
      );
      eventsGrid.append(row);
    }
    if (!upcoming.length)
      eventsGrid.append(quiet(owner ? t("streamer.events.emptyOwner") : t("streamer.events.emptyMember")));
    events.append(eventsGrid);
    const highlights = el("section", "dc-streamer-section");
    const highlightHead = el("header", "dc-streamer-section-head", el("h3", "", t("streamer.highlights.heading")));
    if (owner) highlightHead.append(button(t("streamer.highlights.curate"), () => openPanel("highlights")));
    highlights.append(highlightHead);
    const clips = el("div", "dc-streamer-clips");
    for (const highlight of data.highlights.slice(0, 4)) {
      const clip = button(t("streamer.highlights.watch"), () => openLink(highlight.url), false, true);
      const thumbnail = highlight.thumbnailPath ? image(highlight.thumbnailPath, options, "") : null;
      const preview = el("div", "dc-streamer-clip-preview", thumbnail, icon("live"));
      clips.append(el("article", "dc-streamer-clip", preview, el("h4", "", highlight.title), clip));
    }
    if (!data.highlights.length)
      clips.append(quiet(owner ? t("streamer.highlights.emptyOwner") : t("streamer.highlights.emptyMember")));
    highlights.append(clips);
    const sections: Node[] = [toolbar];
    if (previewMember) sections.push(el("div", "dc-streamer-preview-note", t("streamer.overview.previewNote")));
    sections.push(heroRow, tiles, events, highlights);
    if (!owner && data.giveaways.length) {
      const giveaways = el("section", "dc-streamer-section", el("h3", "", t("streamer.giveaways.heading")));
      for (const giveaway of data.giveaways) {
        const closed = giveaway.status !== "open" || Date.parse(giveaway.closesAt) <= now();
        const enter = button(
          giveaway.entered
            ? t("streamer.giveaways.entered")
            : closed
              ? t("streamer.giveaways.closed")
              : t("streamer.giveaways.enter"),
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
            quiet(t("streamer.giveaways.closes", { date: formatDate(giveaway.closesAt, "dateTime") })),
            giveaway.winnerName ? quiet(t("streamer.giveaways.winner", { name: giveaway.winnerName })) : null,
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
        if (!rooms?.(name)) announce(t("streamer.errors.roomUnavailable", { room: name }), true);
      });
    const heroActions = el("div", "dc-streamer-actions");
    if (owner) {
      heroActions.append(button(t("streamer.official.postAnnouncement"), room("announcements"), true));
      heroActions.append(button(t("streamer.official.editWelcomeGuide"), () => openPanel("settings")));
    } else {
      heroActions.append(button(t("streamer.cards.newHere.open"), () => openPanel("welcome"), true, true));
      heroActions.append(button(t("streamer.official.readRules"), room("rules"), false, true));
    }
    heroBody.append(heroActions);
    hero.append(heroBody);
    const heroRow = el("div", `dc-streamer-hero-row${owner ? " is-creator" : ""}`, hero);
    if (owner) {
      const tools = el("section", "dc-streamer-tools", el("h3", "", t("streamer.official.toolsHeading")));
      const tool = (label: string, symbol: string, handler: () => void) => {
        const row = button(label, handler);
        row.prepend(icon(symbol));
        tools.append(row);
      };
      tool(t("streamer.official.tools.postAnnouncement"), "announce", room("announcements"));
      tool(t("streamer.official.tools.publishPatchNotes"), "star", room("patch-notes"));
      tool(t("streamer.official.tools.updateFaq"), "queue", room("faq"));
      tool(t("streamer.official.tools.editRules"), "settings", room("rules"));
      tool(t("streamer.official.tools.editWelcomeGuide"), "settings", () => openPanel("settings"));
      if (options.actions.openModeration)
        tool(t("streamer.tools.moderation"), "settings", () => guardedNative(options.actions.openModeration!));
      heroRow.append(tools);
    }
    const tiles = el("div", "dc-streamer-tiles");
    if (owner) {
      const growth = data.stats
        ? t("streamer.official.growth", {
            count: data.stats.memberCount,
            members: formatNumber(data.stats.memberCount),
            joined: formatNumber(data.stats.joinedLast7Days),
          })
        : "";
      tiles.append(
        card(
          t("streamer.official.cards.newMembers.title"),
          "chart",
          t("streamer.official.cards.newMembers.description"),
          button(t("streamer.official.cards.newMembers.open"), () => openPanel("analytics")),
          growth,
        ),
        card(
          t("streamer.official.cards.announcements.title"),
          "announce",
          t("streamer.official.cards.announcements.description"),
          button(t("streamer.official.cards.announcements.open"), room("announcements"), true),
        ),
        card(
          t("streamer.official.cards.patchNotes.title"),
          "star",
          t("streamer.official.cards.patchNotes.description"),
          button(t("streamer.official.cards.patchNotes.open"), room("patch-notes")),
        ),
        card(
          t("streamer.cards.manageHub.title"),
          "settings",
          t("streamer.official.cards.manageHub.description"),
          button(t("streamer.cards.manageHub.open"), () => guardedNative(options.actions.manageHub)),
        ),
      );
    } else {
      tiles.append(
        card(
          t("streamer.cards.newHere.title"),
          "star",
          t("streamer.official.cards.newHere.description"),
          button(t("streamer.cards.newHere.open"), () => openPanel("welcome"), true, true),
        ),
        card(
          t("streamer.official.cards.faq.title"),
          "queue",
          t("streamer.official.cards.faq.description"),
          button(t("streamer.official.cards.faq.open"), room("faq"), false, true),
        ),
        card(
          t("streamer.official.cards.roadmap.title"),
          "chart",
          t("streamer.official.cards.roadmap.description"),
          button(
            t("streamer.official.cards.roadmap.open"),
            () => {
              if (!options.actions.openRoom?.("roadmap")) openSite("https://de-cave.com/roadmap");
            },
            false,
            true,
          ),
        ),
        card(
          t("streamer.official.cards.whatsNew.title"),
          "announce",
          t("streamer.official.cards.whatsNew.description"),
          button(t("streamer.official.cards.whatsNew.open"), room("patch-notes"), false, true),
        ),
      );
      if (!options.isDesktop)
        tiles.append(
          card(
            t("streamer.official.cards.desktop.title"),
            "live",
            t("streamer.official.cards.desktop.description"),
            button(
              t("streamer.official.cards.desktop.open"),
              () => openSite("https://de-cave.com/#download"),
              false,
              true,
            ),
          ),
        );
    }
    const privacy = el(
      "section",
      "dc-streamer-section",
      el("header", "dc-streamer-section-head", el("h3", "", t("streamer.official.privacy.heading"))),
      quiet(t("streamer.official.privacy.body")),
    );
    const sections: Node[] = [toolbar];
    if (previewMember) sections.push(el("div", "dc-streamer-preview-note", t("streamer.overview.previewNote")));
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
    const officialAboutContent = officialAbout();
    const about = section(
      officialAboutContent.title,
      el(
        "div",
        "dc-official-about",
        el(
          "div",
          "dc-official-about-copy",
          quiet(officialAboutContent.body),
          el(
            "p",
            "dc-official-alpha",
            el("strong", "", t("streamer.official.alphaLabel")),
            officialAboutContent.alphaNote,
          ),
        ),
        el(
          "dl",
          "dc-official-facts",
          ...officialAboutContent.facts.map((fact) =>
            el("div", "", el("dt", "", fact.label), el("dd", "", fact.value)),
          ),
        ),
      ),
    );
    const announcementsHead = section(
      t("streamer.official.cards.announcements.title"),
      el(
        "ol",
        "dc-official-news",
        ...officialAnnouncements().map((item) =>
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
      t("streamer.official.cards.announcements.open"),
      () => {
        if (!options.actions.openRoom?.("announcements"))
          announce(t("streamer.errors.roomUnavailable", { room: "announcements" }), true);
      },
      false,
      true,
    );
    announcementsHead.querySelector(".dc-streamer-section-head")?.append(openAnnouncements);
    const roadmap = section(
      t("streamer.official.cards.roadmap.title"),
      el(
        "ol",
        "dc-official-roadmap",
        ...officialRoadmap().map((item, index) =>
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
      t("streamer.official.resourcesHeading"),
      el(
        "div",
        "dc-official-resources",
        ...officialResources().map((item) => {
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
  function waitingLine(data: StreamerSnapshot): string {
    return t("streamer.cards.queue.waiting", {
      count: data.queue.waiting,
      number: formatNumber(data.queue.waiting),
    });
  }
  function queueDescription(data: StreamerSnapshot): string {
    const mine = data.queue.mine;
    if (!data.session) return t("streamer.queue.none");
    if (!mine) return data.session.status === "paused" ? t("streamer.queue.paused") : t("streamer.queue.join");
    if (mine.status === "waiting") return t("streamer.queue.waiting", { position: mine.position ?? "—" });
    if (mine.status === "called") return t("streamer.queue.called", { time: formatDate(mine.callExpiresAt!, "time") });
    if (mine.status === "ready") return t("streamer.queue.ready");
    if (mine.status === "playing") return t("streamer.queue.playing");
    return t("streamer.queue.ended");
  }
  /** PUG and Leaderboard cards, only on Hubs where DeCave staff switched them on. */
  function communityCards(data: StreamerSnapshot): HTMLElement[] {
    const cards: HTMLElement[] = [];
    if (data.features.pugs)
      cards.push(
        card(
          t("streamer.cards.pug.title"),
          "game",
          t("streamer.cards.pug.description"),
          button(
            data.pug && data.pug.status === "open" && !data.pug.joined
              ? t("streamer.cards.pug.join")
              : t("streamer.cards.pug.open"),
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
        ? button(t("streamer.cards.twitch.link"), () => void startTwitchSignIn(), true, true)
        : button(
            t("streamer.cards.twitch.checkAgain"),
            () => void twitchAction((s) => api.recheckTwitch(s), t("streamer.notices.subscriptionChecked")),
            false,
            true,
          );
      cards.push(
        card(
          t("streamer.cards.twitch.title"),
          "live",
          tm.linked ? t("streamer.cards.twitch.linkedDescription") : t("streamer.cards.twitch.unlinkedDescription"),
          action,
          !tm.linked
            ? t("streamer.cards.twitch.notLinked")
            : tm.subscribed
              ? t("streamer.cards.twitch.subscribed", { login: tm.login })
              : t("streamer.cards.twitch.notSubscribed", { login: tm.login }),
        ),
      );
      if (tm.linked)
        cards[cards.length - 1].append(
          button(
            t("streamer.cards.twitch.unlink"),
            () => void twitchAction((s) => api.unlinkTwitch(s), t("streamer.notices.twitchUnlinked")),
            false,
            true,
          ),
        );
    }
    if (data.features.leaderboard)
      cards.push(
        card(
          t("streamer.cards.leaderboard.title"),
          "chart",
          t("streamer.cards.leaderboard.description"),
          button(t("streamer.cards.leaderboard.view"), () => openPanel("leaderboard"), false, true),
        ),
      );
    return cards;
  }
  function joinButton(data: StreamerSnapshot, hero = false): HTMLButtonElement {
    const mine = data.queue.mine;
    const sessionId = data.session?.id;
    let label = hero ? t("streamer.join.communityQueue") : t("streamer.join.queue");
    let path = "queue/join";
    if (mine?.status === "called") {
      label = t("streamer.join.ready");
      path = "queue/ready";
    } else if (mine && ["waiting", "ready"].includes(mine.status)) {
      label = t("streamer.join.leave");
      path = "queue/leave";
    } else if (mine?.status === "playing") label = t("streamer.join.inGame");
    else if (mine) label = t("streamer.join.completed");
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
    const label = ((options.official && OFFICIAL_LABELS[name]) || LABELS[name])();
    container.setAttribute("role", "dialog");
    container.setAttribute("aria-label", label);
    // Non-modal by design: the existing global navigation/friends UI stays usable.
    const title = el("h2", "", label);
    title.tabIndex = -1;
    const close = action(t("streamer.panels.close"), closePanel);
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
        unlinkFaceit: () =>
          void faceitAction((signal) => api.unlinkFaceit(signal), t("streamer.notices.faceitUnlinked")),
      });
    if (name === "queue") renderQueue(container);
    if (name === "analytics") {
      container.append(quiet(t("streamer.analytics.intro")));
      const stats = data.stats;
      const grid = el("div", "dc-streamer-stats");
      if (stats)
        for (const [label, value] of [
          [t("streamer.analytics.hubMembers"), stats.memberCount],
          [t("streamer.analytics.joined"), stats.joinedLast7Days],
          [t("streamer.analytics.sessions"), stats.sessionsLast7Days],
          [t("streamer.analytics.players"), stats.playersLast7Days],
          [t("streamer.analytics.seats"), stats.seatsCompletedLast7Days],
        ] as const)
          grid.append(el("article", "dc-streamer-stat", el("strong", "", formatNumber(value)), quiet(label)));
      container.append(grid);
    }
    if (name === "welcome")
      container.append(
        quiet(data.config.onboarding),
        ...(options.official ? [] : [el("h3", "", t("streamer.welcome.sessionRules")), quiet(data.config.queueRules)]),
      );
    if (name === "highlights") {
      container.append(quiet(t("streamer.highlights.intro")));
      const { form, submitButton } = panelForm(
        t("streamer.highlights.publish"),
        (values) => void perform("highlights/add", values, true),
      );
      field(form, "title", t("streamer.highlights.titleField"), "", { required: true, maxLength: 120 });
      field(form, "url", t("streamer.highlights.urlField"), "", { required: true, type: "url", maxLength: 500 });
      field(form, "thumbnailPath", t("streamer.highlights.thumbnailField"), "", { maxLength: 600 });
      form.append(submitButton);
      container.append(form);
      for (const highlight of data.highlights)
        container.append(
          el(
            "div",
            "dc-streamer-row",
            el("span", "", highlight.title),
            button(
              t("streamer.highlights.remove"),
              () => void perform("highlights/remove", { id: highlight.id }, true),
            ),
          ),
        );
    }
    if (name === "giveaway") renderGiveaway(container);
    panelHost.replaceChildren(container);
  }
  function renderSettings(container: HTMLElement, config: StreamerConfig) {
    if (options.official) {
      container.append(quiet(t("streamer.settings.officialIntro")));
      const { form, submitButton } = panelForm(
        t("streamer.settings.saveWelcomeGuide"),
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
      field(form, "tagline", t("streamer.settings.bannerTagline"), config.tagline, { maxLength: 160 });
      field(form, "streamTitle", t("streamer.settings.bannerSubtitle"), config.streamTitle, { maxLength: 140 });
      field(form, "onboarding", t("streamer.settings.welcomeGuide"), config.onboarding, {
        multiline: true,
        maxLength: 1600,
      });
      form.append(submitButton);
      container.append(form);
      return;
    }
    container.append(quiet(t("streamer.settings.intro")));
    const { form, submitButton } = panelForm(
      t("streamer.settings.save"),
      (values) =>
        void perform("settings", { ...values, version: config.version, liveHours: Number(values.liveHours) }, true),
    );
    field(form, "creatorName", t("streamer.settings.creatorName"), config.creatorName, { maxLength: 80 });
    field(form, "tagline", t("streamer.settings.communityTagline"), config.tagline, { maxLength: 160 });
    field(form, "streamUrl", t("streamer.settings.streamUrl"), config.streamUrl, { type: "url", maxLength: 500 });
    field(form, "streamTitle", t("streamer.settings.streamTitle"), config.streamTitle, { maxLength: 140 });
    field(form, "game", t("streamer.settings.game"), config.game, { maxLength: 80 });
    field(form, "language", t("streamer.settings.language"), config.language, { maxLength: 40 });
    field(form, "liveHours", t("streamer.settings.liveHours"), isLive(config, now()) ? "4" : "0", {
      type: "number",
      min: "0",
      max: "12",
      required: true,
    });
    if (snapshot?.features.twitch) {
      const autoLive = el("select", "dc-streamer-input");
      autoLive.name = "twitchAutoLive";
      autoLive.id = "dc-streamer-field-twitch-auto-live";
      autoLive.append(
        new Option(t("streamer.settings.off"), "off"),
        new Option(t("streamer.settings.autoLiveOn"), "on"),
      );
      autoLive.value = config.twitchAutoLive ? "on" : "off";
      const autoLiveLabel = el("label", "", t("streamer.settings.autoLiveLabel"));
      autoLiveLabel.htmlFor = autoLive.id;
      form.append(el("div", "dc-streamer-field", autoLiveLabel, autoLive, quiet(t("streamer.settings.autoLiveHint"))));
      const clips = el("select", "dc-streamer-input");
      clips.name = "twitchClips";
      clips.id = "dc-streamer-field-twitch-clips";
      clips.append(new Option(t("streamer.settings.off"), "off"), new Option(t("streamer.settings.clipsOn"), "on"));
      clips.value = config.twitchClips ? "on" : "off";
      const clipsLabel = el("label", "", t("streamer.settings.clipsLabel"));
      clipsLabel.htmlFor = clips.id;
      form.append(el("div", "dc-streamer-field", clipsLabel, clips, quiet(t("streamer.settings.clipsHint"))));
    }
    field(form, "queueRules", t("streamer.settings.sessionRules"), config.queueRules, {
      multiline: true,
      maxLength: 1600,
    });
    field(form, "onboarding", t("streamer.settings.welcomeGuide"), config.onboarding, {
      multiline: true,
      maxLength: 1600,
    });
    form.append(submitButton);
    container.append(form);
  }
  function renderQueue(container: HTMLElement) {
    if (!snapshot) return;
    const session = snapshot.session;
    if (!session) {
      container.append(quiet(t("streamer.session.intro")));
      const { form, submitButton } = panelForm(
        t("streamer.session.open"),
        (values) =>
          void perform("session/create", {
            ...values,
            partySize: Number(values.partySize),
            readySeconds: Number(values.readySeconds),
          }),
      );
      field(form, "title", t("streamer.session.titleField"), t("streamer.session.defaultTitle"), {
        required: true,
        maxLength: 100,
      });
      field(form, "game", t("streamer.session.gameField"), snapshot.config.game, { required: true, maxLength: 80 });
      field(form, "partySize", t("streamer.session.partySizeField"), "4", {
        type: "number",
        min: "1",
        max: "16",
        required: true,
      });
      field(form, "readySeconds", t("streamer.session.readySecondsField"), "90", {
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
      quiet(
        t("streamer.session.summary", {
          game: session.game,
          count: session.partySize,
          status: t(`streamer.session.status.${session.status}`),
        }),
      ),
      quiet(snapshot.config.queueRules),
    );
    const controls = el("div", "dc-streamer-actions");
    controls.append(
      button(
        session.status === "paused" ? t("streamer.session.resume") : t("streamer.session.pause"),
        () => void perform(`session/${session.status === "paused" ? "resume" : "pause"}`, payload),
      ),
      button(t("streamer.session.callNext"), () => void perform("session/call-next", payload), true),
      button(t("streamer.session.startReady"), () => void perform("session/start-ready", payload)),
      button(t("streamer.session.finishGroup"), () => void perform("session/finish-playing", payload)),
    );
    const end = button(t("streamer.session.end"), () => {
      const confirm = el(
        "div",
        "dc-streamer-confirm",
        quiet(t("streamer.session.endConfirmText")),
        button(t("streamer.session.endConfirm"), () => void perform("session/end", payload)),
        action(t("streamer.session.keep"), () => confirm.remove()),
      );
      controls.after(confirm);
    });
    end.classList.add("is-danger");
    controls.append(end);
    container.append(controls);
    container.append(
      quiet(
        t("streamer.session.counts", {
          waiting: snapshot.queue.waiting,
          called: snapshot.queue.called,
          ready: snapshot.queue.ready,
          playing: snapshot.queue.playing,
        }),
      ),
    );
    const list = el("div", "dc-streamer-queue-list");
    for (const entry of queueRows) {
      const state = el(
        "span",
        `dc-streamer-state is-${entry.status}`,
        t(`streamer.session.entryStatus.${entry.status}`),
      );
      const row = el("div", "dc-streamer-row", el("span", "", entry.name), state);
      if (entry.callExpiresAt && entry.status === "called")
        row.append(
          el(
            "time",
            "dc-streamer-muted",
            t("streamer.session.until", { time: formatDate(entry.callExpiresAt, "time") }),
          ),
        );
      if (entry.status !== "playing")
        row.append(button(t("streamer.session.skip"), () => void perform("queue/skip", { entryId: entry.id })));
      list.append(row);
    }
    if (!queueRows.length) list.append(quiet(t("streamer.session.empty")));
    container.append(list);
    if (queuePageAfter)
      container.append(
        button(t("streamer.session.firstPage"), () => {
          queuePageAfter = undefined;
          void loadQueue(false);
        }),
      );
    if (queueCursor) container.append(button(t("streamer.session.nextPage"), () => void loadQueue(true)));
    container.append(quiet(t("streamer.session.voiceNote")));
  }
  function renderGiveaway(container: HTMLElement) {
    if (!snapshot) return;
    if (!snapshot.features.giveaways) {
      container.append(quiet(t("streamer.giveaways.disabled")));
      return;
    }
    container.append(quiet(t("streamer.giveaways.intro")));
    const { form, submitButton } = panelForm(t("streamer.giveaways.create"), (values) => {
      const date = new Date(String(values.closesAt));
      if (!Number.isFinite(date.getTime())) {
        announce(t("streamer.errors.closingTimeRequired"), true);
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
    field(form, "title", t("streamer.giveaways.titleField"), "", { required: true, maxLength: 120 });
    field(form, "rules", t("streamer.giveaways.rulesField"), "", {
      required: true,
      multiline: true,
      maxLength: 2000,
    });
    field(form, "closesAt", t("streamer.giveaways.closesAtField"), "", { required: true, type: "datetime-local" });
    if (snapshot.features.subRoles) {
      const choice = (name: string, label: string, on: string) => {
        const select = el("select", "dc-streamer-input");
        select.name = name;
        select.id = `dc-streamer-giveaway-${name}`;
        select.append(new Option(t("streamer.giveaways.no"), "off"), new Option(on, "on"));
        const title = el("label", "", label);
        title.htmlFor = select.id;
        form.append(el("div", "dc-streamer-field", title, select));
      };
      choice("subsOnly", t("streamer.giveaways.whoCanEnter"), t("streamer.giveaways.subsOnly"));
      choice("subBonus", t("streamer.giveaways.subscriberBonus"), t("streamer.giveaways.subBonus"));
      field(form, "minMemberDays", t("streamer.giveaways.minDaysField"), "0", {
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
        quiet(
          t("streamer.giveaways.summary", {
            count: giveaway.entryCount,
            status: t(`streamer.giveaways.status.${giveaway.status}`),
          }),
        ),
        giveawayRuleLine(giveaway.conditions) ? quiet(giveawayRuleLine(giveaway.conditions)) : null,
      );
      if (giveaway.status === "open") {
        const draw = button(
          t("streamer.giveaways.draw"),
          () => void perform("giveaways/draw", { id: giveaway.id }, true),
        );
        draw.disabled ||= Date.parse(giveaway.closesAt) > now();
        row.append(
          draw,
          button(t("streamer.giveaways.cancel"), () => void perform("giveaways/cancel", { id: giveaway.id }, true)),
        );
      } else if (giveaway.winnerName) row.append(quiet(t("streamer.giveaways.winner", { name: giveaway.winnerName })));
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
