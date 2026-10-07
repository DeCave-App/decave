// What the DeCave Official Hub overview shows every member: what the project
// is, the latest announcements, the roadmap and where to get help.
// The announcement posts in #announcements are seeded by
// migrations/0066_official_hub_project_content.sql; keep both in step.

export const OFFICIAL_ABOUT = {
  title: "About DeCave",
  body: "DeCave is a home for the people you play with: Hubs with text, voice and forum rooms, friends and DMs, Squad Finder, events and screen sharing on web, Windows and Mac. It is built by a small independent team and shaped by the people using it.",
  facts: [
    { label: "Stage", value: "Alpha" },
    { label: "Ages", value: "18+ only" },
    { label: "Platforms", value: "Web · Windows · Mac" },
    { label: "Price", value: "Free" },
  ],
  alphaNote:
    "DeCave is an alpha, not a finished release. Expect rough edges, frequent updates and the occasional reset of experimental features. Your feedback decides what we fix next.",
};

export type OfficialAnnouncement = { date: string; title: string; body: string; tag: string };

export const OFFICIAL_ANNOUNCEMENTS: OfficialAnnouncement[] = [
  {
    date: "5 Oct 2026",
    tag: "Policy",
    title: "DeCave is now for adults 18+",
    body: "Accounts are now for people aged 18 and over. If you confirmed an age under 18 earlier, you'll be asked to confirm your birth date again.",
  },
  {
    date: "5 Oct 2026",
    tag: "Release",
    title: "Release 0.1.128: clearer voice controls and screen sharing",
    body: "Voice controls are easier to reach during a call. Muting another participant's shared screen no longer silences their voice, and iOS gained a speaker toggle and screen broadcast.",
  },
  {
    date: "Pinned",
    tag: "Alpha",
    title: "Welcome to the DeCave alpha",
    body: "Thanks for joining early. Read #rules, check #faq, and use Feedback in the left rail to tell us what's broken or missing.",
  },
];

export const OFFICIAL_ROADMAP = [
  {
    state: "Shipped",
    title: "A home for the whole session",
    body: "Hubs, voice and screen sharing, friends and DMs, Squad Finder, Discover, events and the desktop apps.",
  },
  {
    state: "In progress",
    title: "Desktop polish and trust",
    body: "Windows code signing, steadier voice and screen sharing, reliability and safety fixes.",
  },
  { state: "Next", title: "Mobile up to date", body: "Fresh Android and iOS builds on the same path as desktop." },
  { state: "Later", title: "Bigger rooms", body: "A media-server path for larger voice and screen-share rooms." },
];

export const OFFICIAL_RESOURCES = [
  { label: "DeCave website", detail: "de-cave.com", href: "https://de-cave.com/" },
  { label: "Help center", detail: "Answers to common questions", href: "https://de-cave.com/help" },
  { label: "Roadmap", detail: "What's live and what's next", href: "https://de-cave.com/roadmap" },
  { label: "Community guidelines", detail: "How we keep Hubs kind", href: "https://de-cave.com/guidelines" },
  { label: "Privacy policy", detail: "What we collect and why", href: "https://de-cave.com/privacy" },
  { label: "Terms of service", detail: "The rules for using DeCave", href: "https://de-cave.com/terms" },
];
