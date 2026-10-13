// What the DeCave Official Hub overview shows every member: what the project
// is, the latest announcements, the roadmap and where to get help.
// The announcement posts in #announcements are seeded by
// migrations/0066_official_hub_project_content.sql; keep both in step.
// The text lives in shared/i18n/locales/<lang>/streamer.json under "official".

import { t } from "./i18n";

export function officialAbout() {
  return {
    title: t("streamer.official.about.title"),
    body: t("streamer.official.about.body"),
    facts: [
      { label: t("streamer.official.about.facts.stageLabel"), value: t("streamer.official.about.facts.stageValue") },
      { label: t("streamer.official.about.facts.agesLabel"), value: t("streamer.official.about.facts.agesValue") },
      {
        label: t("streamer.official.about.facts.platformsLabel"),
        value: t("streamer.official.about.facts.platformsValue"),
      },
      { label: t("streamer.official.about.facts.priceLabel"), value: t("streamer.official.about.facts.priceValue") },
    ],
    alphaNote: t("streamer.official.about.alphaNote"),
  };
}

export type OfficialAnnouncement = { date: string; title: string; body: string; tag: string };

const ANNOUNCEMENTS = ["adults", "release128", "welcome"] as const;

export function officialAnnouncements(): OfficialAnnouncement[] {
  return ANNOUNCEMENTS.map((id) => ({
    date: t(`streamer.official.announcements.${id}.date`),
    tag: t(`streamer.official.announcements.${id}.tag`),
    title: t(`streamer.official.announcements.${id}.title`),
    body: t(`streamer.official.announcements.${id}.body`),
  }));
}

const ROADMAP = ["shipped", "inProgress", "next", "later"] as const;

export function officialRoadmap() {
  return ROADMAP.map((id) => ({
    state: t(`streamer.official.roadmap.${id}.state`),
    title: t(`streamer.official.roadmap.${id}.title`),
    body: t(`streamer.official.roadmap.${id}.body`),
  }));
}

const RESOURCES = [
  { id: "website", href: "https://de-cave.com/" },
  { id: "help", href: "https://de-cave.com/help" },
  { id: "roadmap", href: "https://de-cave.com/roadmap" },
  { id: "guidelines", href: "https://de-cave.com/guidelines" },
  { id: "privacy", href: "https://de-cave.com/privacy" },
  { id: "terms", href: "https://de-cave.com/terms" },
] as const;

export function officialResources() {
  return RESOURCES.map(({ id, href }) => ({
    label: t(`streamer.official.resources.${id}.label`),
    detail: t(`streamer.official.resources.${id}.detail`),
    href,
  }));
}
