// Hub Home layout: which sections a Hub shows on its landing page, in what
// order, plus the owner-written Welcome message and Rules. Shared by the
// Worker (validation/storage) and the client (rendering/editing).

export const HUB_HOME_SECTION_IDS = ["welcome", "now", "catchUp", "about", "rules", "events", "members"] as const;
export type HubHomeSectionId = (typeof HUB_HOME_SECTION_IDS)[number];

export type HubHomeSection = { id: HubHomeSectionId; visible: boolean };

export type HubHomeConfig = {
  sections: HubHomeSection[];
  /** Short message shown at the top of Hub Home. Empty hides the section. */
  welcome: string;
  /** One rule per line. Empty hides the section. */
  rules: string;
};

export const HUB_HOME_LIMITS = { welcome: 1000, rules: 2000, ruleLines: 20 } as const;

export const HUB_HOME_SECTION_LABELS: Record<HubHomeSectionId, { title: string; hint: string }> = {
  welcome: { title: "Welcome message", hint: "A short note you write for everyone who opens the Hub." },
  now: { title: "Happening now", hint: "Live voice rooms and the next event." },
  catchUp: { title: "Catch up", hint: "Rooms with new messages, different for each member." },
  about: { title: "About", hint: "The Hub description and tags." },
  rules: { title: "Rules", hint: "One rule per line, numbered automatically." },
  events: { title: "Upcoming events", hint: "The next events from the Hub calendar." },
  members: { title: "Members", hint: "Who is here and how many are online." },
};

export const DEFAULT_HUB_HOME: HubHomeConfig = {
  sections: HUB_HOME_SECTION_IDS.map((id) => ({ id, visible: true })),
  welcome: "",
  rules: "",
};

const isSectionId = (value: unknown): value is HubHomeSectionId =>
  typeof value === "string" && (HUB_HOME_SECTION_IDS as readonly string[]).includes(value);

/**
 * Normalise stored or submitted sections: unknown ids and duplicates are
 * dropped, missing sections are appended (visible) in their default order,
 * so adding a section type later never hides it on existing Hubs.
 */
export function normalizeHubHomeSections(raw: unknown): HubHomeSection[] {
  const seen = new Set<HubHomeSectionId>();
  const sections: HubHomeSection[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const id = item && typeof item === "object" ? (item as { id?: unknown }).id : item;
      if (!isSectionId(id) || seen.has(id)) continue;
      seen.add(id);
      const visible = item && typeof item === "object" ? (item as { visible?: unknown }).visible !== false : true;
      sections.push({ id, visible });
    }
  }
  for (const id of HUB_HOME_SECTION_IDS) if (!seen.has(id)) sections.push({ id, visible: true });
  return sections;
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // Normalise line endings and strip control characters other than newlines and tabs.
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

export function normalizeHubHomeRules(value: unknown): string {
  return cleanText(value, HUB_HOME_LIMITS.rules)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, HUB_HOME_LIMITS.ruleLines)
    .join("\n");
}

export function normalizeHubHomeConfig(raw: unknown): HubHomeConfig {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    sections: normalizeHubHomeSections(value.sections),
    welcome: cleanText(value.welcome, HUB_HOME_LIMITS.welcome),
    rules: normalizeHubHomeRules(value.rules),
  };
}

/** Rules as a list, with leading "1." / "-" / "•" markers removed. */
export function hubRulesList(rules: string): string[] {
  return rules
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, HUB_HOME_LIMITS.ruleLines);
}

/** Move a section one step up (-1) or down (+1); returns a new list. */
export function moveHubHomeSection(
  sections: readonly HubHomeSection[],
  id: HubHomeSectionId,
  delta: -1 | 1,
): HubHomeSection[] {
  const index = sections.findIndex((section) => section.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= sections.length) return [...sections];
  const next = [...sections];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
