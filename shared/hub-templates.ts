import { STREAMER_HUB_TEMPLATE } from "./streamer-mode.ts";

export type HubTemplateId =
  | "blank"
  | "friends"
  | "gaming"
  | "community"
  | "creator"
  | "esports"
  | "development"
  | "support"
  | "project"
  | "streamer";

export type HubTemplateRoom = {
  name: string;
  type: "text" | "voice" | "forum";
  category: string;
  icon: string;
  private?: boolean;
};

export type HubTemplateDefinition = {
  id: HubTemplateId;
  name: string;
  description: string;
  rooms: readonly HubTemplateRoom[];
};

const text = (name: string, category: string, icon = "💬", isPrivate = false): HubTemplateRoom => ({
  name,
  type: "text",
  category,
  icon,
  ...(isPrivate ? { private: true } : {}),
});
const voice = (name: string, category: string, icon = "🔊", isPrivate = false): HubTemplateRoom => ({
  name,
  type: "voice",
  category,
  icon,
  ...(isPrivate ? { private: true } : {}),
});
const forum = (name: string, category: string, icon = "▤", isPrivate = false): HubTemplateRoom => ({
  name,
  type: "forum",
  category,
  icon,
  ...(isPrivate ? { private: true } : {}),
});

export const HUB_TEMPLATE_DEFINITIONS: readonly HubTemplateDefinition[] = [
  {
    id: "blank",
    name: "Blank",
    description: "A clean starting point for your own Hub structure.",
    rooms: [text("general", "GENERAL"), voice("General Voice", "VOICE")],
  },
  {
    id: "friends",
    name: "Friends / Hangout",
    description: "A lightweight space for friends, chat, and shared media.",
    rooms: [
      text("general", "SOCIAL"),
      text("off-topic", "SOCIAL"),
      text("media-memes", "SOCIAL", "🖼️"),
      voice("Lounge", "VOICE"),
    ],
  },
  {
    id: "gaming",
    name: "Gaming",
    description: "Rooms for finding teammates, sharing clips, and organizing squads.",
    rooms: [
      text("general", "COMMUNITY"),
      text("LFG", "COMMUNITY", "🧭"),
      text("game-discussion", "COMMUNITY"),
      text("clips", "MEDIA", "🎬"),
      text("screenshots", "MEDIA", "📸"),
      voice("Gaming Room", "VOICE"),
      voice("Squad 1", "VOICE"),
      voice("Squad 2", "VOICE"),
      voice("AFK", "VOICE", "💤"),
    ],
  },
  {
    id: "community",
    name: "Community",
    description: "A structured public Hub with information, discussions, events, and voice.",
    rooms: [
      text("welcome", "INFORMATION", "👋"),
      text("announcements", "INFORMATION", "📢"),
      text("rules", "INFORMATION", "📜"),
      text("general", "COMMUNITY"),
      text("media", "COMMUNITY", "🖼️"),
      forum("discussions", "COMMUNITY"),
      text("events", "COMMUNITY", "📅"),
      voice("Lounge", "VOICE"),
      voice("Community Voice", "VOICE"),
    ],
  },
  {
    id: "creator",
    name: "Creator",
    description: "Keep content, feedback, suggestions, and community chat together.",
    rooms: [
      text("announcements", "INFORMATION", "📢"),
      text("uploads", "CONTENT", "📺"),
      text("clips", "CONTENT", "🎬"),
      forum("feedback", "COMMUNITY"),
      text("suggestions", "COMMUNITY", "💡"),
      text("community-chat", "COMMUNITY"),
      voice("Creator Room", "VOICE"),
    ],
  },
  {
    id: "esports",
    name: "Esports / Clan",
    description: "Coordinate rosters, scrims, strategy, clips, and private staff work.",
    rooms: [
      text("announcements", "INFORMATION", "📢"),
      text("roster", "INFORMATION", "📋"),
      text("LFG", "COMPETITIVE", "🧭"),
      text("scrims", "COMPETITIVE", "⚔️"),
      text("strategy", "COMPETITIVE", "🧠"),
      text("clips", "MEDIA", "🎬"),
      text("staff", "STAFF", "🛡️", true),
      voice("Squad 1", "VOICE"),
      voice("Squad 2", "VOICE"),
    ],
  },
  {
    id: "development",
    name: "Development",
    description: "A focused project space for bugs, releases, ideas, and team voice.",
    rooms: [
      text("general", "COMMUNITY"),
      text("development", "DEVELOPMENT", "🛠️"),
      forum("bugs", "DEVELOPMENT"),
      forum("feature-requests", "DEVELOPMENT", "💡"),
      text("releases", "DEVELOPMENT", "🚀"),
      text("showcase", "DEVELOPMENT", "✨"),
      voice("Team Voice", "VOICE"),
    ],
  },
  {
    id: "support",
    name: "Support",
    description: "Help users find answers, report issues, and reach the support team.",
    rooms: [
      text("FAQ", "INFORMATION", "❔"),
      forum("help", "SUPPORT", "🆘"),
      text("known-issues", "SUPPORT", "⚠️"),
      text("general-discussion", "COMMUNITY"),
      text("staff-support", "STAFF", "🛡️", true),
    ],
  },
  {
    id: "project",
    name: "Project / Team",
    description: "Organize updates, tasks, docs, deadlines, and team rooms.",
    rooms: [
      text("general", "GENERAL"),
      text("updates", "PROJECT", "📣"),
      text("tasks", "PROJECT", "✅"),
      text("docs-files", "PROJECT", "📁"),
      text("deadlines", "PROJECT", "⏱️"),
      voice("Team Room", "VOICE"),
    ],
  },
];

/**
 * Keep the default template list unchanged for deployments that have not
 * enabled Streamer Hubs. The feature flag is supplied by the host because
 * this shared module has no access to server configuration.
 */
export function getHubTemplateDefinitions(streamerHubsEnabled = false): readonly HubTemplateDefinition[] {
  return streamerHubsEnabled ? [...HUB_TEMPLATE_DEFINITIONS, STREAMER_HUB_TEMPLATE] : HUB_TEMPLATE_DEFINITIONS;
}

export function getHubTemplate(id: unknown, streamerHubsEnabled = false): HubTemplateDefinition {
  return (
    getHubTemplateDefinitions(streamerHubsEnabled).find((template) => template.id === id) ?? HUB_TEMPLATE_DEFINITIONS[0]
  );
}
