import {
  isCreator,
  isLive,
  localMediaPath,
  type QueuePage,
  type StreamerEvent,
  type StreamerSnapshot,
  type StreamerConfig,
} from "../../shared/streamer-mode";
import { createStreamerApi, type StreamerTransport } from "./api";
import { action, el, field, formValues, icon } from "./dom";
import { OFFICIAL_ABOUT, OFFICIAL_ANNOUNCEMENTS, OFFICIAL_RESOURCES, OFFICIAL_ROADMAP } from "./official-content";
import { localeForLanguage, preferredTimeOptions } from "../app/locale";

export type StreamerActions = {
  /** Must delegate to the EXISTING native event composer/calendar, not a new DB. */
  createEvent(): void;
  openCalendar(): void;
  openEvent(event: StreamerEvent, mode: "view" | "manage"): void;
  composeAnnouncement(): void;
  findSquad(): void;
  manageHub(): void;
  /** Resolve only media already authorized for every member of this Hub. */
  mediaUrl(path: string): string;
  openModeration?: () => void;
  /** Opens a room of this Hub by name; returns false when it does not exist. */
  openRoom?: (name: string) => boolean;
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
  transport: StreamerTransport;
  actions: StreamerActions;
};
type Panel = "settings" | "queue" | "analytics" | "giveaway" | "welcome" | null;
type Controller = { update(options: StreamerOverviewOptions): void; destroy(): void };
const LABELS: Record<Exclude<Panel, null>, string> = {
  settings: "Stream settings",
  queue: "Community session",
  analytics: "Community activity",
  giveaway: "Community giveaway",
  welcome: "Welcome to this Hub",
};
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
  // de-cave.com pages open in a new tab on web; on desktop the main process
  // routes allowlisted https links to the system browser.
  function openSite(url: string) {
    if (!/^https:\/\/de-cave\.com(\/|$)/.test(url)) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }
  function planNext() {
    clearTimeout(timeout);
    if (disposed || document.hidden) return;
    const fast = panel === "queue" || snapshot?.queue.mine?.status === "called";
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
        if (panel && panel !== "welcome") closePanel();
      }
      offset = Date.parse(value.serverTime) - Date.now();
      failures = 0;
      lastError = "";
      announce("");
      renderContent();
      // Do not replace an open settings/giveaway form during polling.
      if (panel === "queue" && value.session) await loadQueue(false);
      else if (panel === "queue" && previousSession) renderPanel();
      if (panel === "analytics") renderPanel();
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
      await api.mutate(path, payload, controller.signal);
      if (disposed) return;
      announce("Saved.");
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
        else if (panel && !["settings", "giveaway"].includes(panel)) renderPanel();
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
    if (!ownerView() && next !== "welcome") return;
    focusBeforePanel = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel = next;
    queueRows = [];
    queueCursor = undefined;
    queuePageAfter = undefined;
    renderPanel();
    panelHost.querySelector<HTMLElement>("h2")?.focus();
    if (next === "queue") void loadQueue(false);
  }
  function panelForm(submitLabel: string, submit: (values: Record<string, unknown>) => void) {
    const form = el("form", "dc-streamer-form");
    const submitButton = el("button", "dc-streamer-button is-primary", submitLabel);
    submitButton.type = "submit";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!busy && form.reportValidity()) submit(formValues(form));
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
      visual.className = "dc-streamer-hero-image";
      hero.append(visual);
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
    if (owner)
      heroActions.append(
        button(data.session ? "Manage Live Session" : "Start Community Session", () => openPanel("queue"), true),
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
    const sections: Node[] = [toolbar];
    if (previewMember)
      sections.push(
        el(
          "div",
          "dc-streamer-preview-note",
          "Member preview — participation actions are disabled. Your permissions have not changed.",
        ),
      );
    sections.push(heroRow, tiles, events);
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
      quiet("These settings update your DeCave Overview only. Live status is manual and expires automatically."),
    );
    const { form, submitButton } = panelForm(
      "Save Stream Settings",
      (values) =>
        void perform("settings", { ...values, version: config.version, liveHours: Number(values.liveHours) }, true),
    );
    field(form, "creatorName", "Creator display name", config.creatorName, { maxLength: 80 });
    field(form, "tagline", "Community tagline", config.tagline, { maxLength: 160 });
    field(form, "streamTitle", "Stream title", config.streamTitle, { maxLength: 140 });
    field(form, "game", "Game", config.game, { maxLength: 80 });
    field(form, "language", "Language", config.language, { maxLength: 40 });
    field(form, "liveHours", "Manual live status (hours; 0 = offline)", isLive(config, now()) ? "4" : "0", {
      type: "number",
      min: "0",
      max: "12",
      required: true,
    });
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
      void perform("giveaways/create", { ...values, closesAt: date.toISOString() }, true);
    });
    field(form, "title", "Giveaway title", "", { required: true, maxLength: 120 });
    field(form, "rules", "Eligibility, prize, and fulfilment rules", "", {
      required: true,
      multiline: true,
      maxLength: 2000,
    });
    field(form, "closesAt", "Closes at (your local time)", "", { required: true, type: "datetime-local" });
    form.append(submitButton);
    container.append(form);
    for (const giveaway of snapshot.giveaways) {
      const row = el(
        "article",
        "dc-streamer-giveaway",
        el("h3", "", giveaway.title),
        quiet(`${giveaway.entryCount} entries · ${giveaway.status}`),
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
