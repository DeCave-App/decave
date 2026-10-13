// Catalog namespaces, one per app area. Each locale has one JSON file per namespace.

export const NAMESPACES = [
  "common",
  "auth",
  "settings",
  "hub",
  "chat",
  "forum",
  "events",
  "voice",
  "dm",
  "social",
  "discover",
  "bots",
  "streamer",
  "safety",
  "admin",
  "errors",
  "email",
  "push",
  "desktop",
  "official",
] as const;

export type Namespace = (typeof NAMESPACES)[number];

export const DEFAULT_NAMESPACE = "common" satisfies Namespace;
