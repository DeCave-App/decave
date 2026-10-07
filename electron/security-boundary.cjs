const path = require("node:path");

const APP_URL = "https://app.de-cave.com";
const APP_ORIGIN = new URL(APP_URL).origin;
const NETWORK_PATH_PREFIXES = Object.freeze(["/api", "/ws", "/uploads", "/mobile"]);
const DOWNLOAD_PATH_PREFIXES = Object.freeze(["/uploads"]);
const TURNSTILE_PATH = "/mobile/turnstile";
const TURNSTILE_ACTIONS = new Set(["login", "register", "forgot"]);
const CODE_RESOURCE_TYPES = new Set(["script", "stylesheet", "worker", "sharedWorker", "serviceWorker"]);
const SAFE_EXTERNAL_HOSTS = new Set([
  // The public website (legal pages, help) opens in the system browser.
  "de-cave.com",
  "steamcommunity.com",
  "steampowered.com",
  "reddit.com",
  "spotify.com",
  "netflix.com",
  "discord.com",
  "x.com",
  "twitter.com",
  "instagram.com",
  "tiktok.com",
  "facebook.com",
  "linkedin.com",
  "threads.net",
  "github.com",
  "wikipedia.org",
  "primevideo.com",
  "crunchyroll.com",
]);
// No third-party media players are embedded in the desktop renderer, so no
// frame host (and no frame-initiated remote code) is approved.
const MEDIA_FRAME_HOSTS = new Set([]);
const MEDIA_RESOURCE_HOSTS = new Set([...MEDIA_FRAME_HOSTS]);

function parsedUrl(value) {
  try {
    return value instanceof URL ? value : new URL(value);
  } catch {
    return null;
  }
}

function pathMatchesPrefix(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isNetworkAppRequest(value, method) {
  const url = parsedUrl(value);
  if (!url || url.origin !== APP_ORIGIN) return false;

  const normalizedMethod = String(method || "GET").toUpperCase();
  if (normalizedMethod !== "GET" && normalizedMethod !== "HEAD") return true;
  return NETWORK_PATH_PREFIXES.some((prefix) => pathMatchesPrefix(url.pathname, prefix));
}

function requestDisposition(value, method) {
  const url = parsedUrl(value);
  if (!url) return "reject";
  if (url.origin !== APP_ORIGIN) return "network";
  return isNetworkAppRequest(url, method) ? "network" : "local";
}

function isTrustedRendererNavigation(value) {
  const url = parsedUrl(value);
  return Boolean(
    url &&
    url.origin === APP_ORIGIN &&
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !isNetworkAppRequest(url, "GET"),
  );
}

function hostMatchesAllowedDomain(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

function isSafeExternalUrl(value) {
  const url = parsedUrl(value);
  if (!url || url.protocol !== "https:" || url.username || url.password || url.port) return false;
  return [...SAFE_EXTERNAL_HOSTS].some((domain) => hostMatchesAllowedDomain(url.hostname.toLowerCase(), domain));
}

function isApprovedMediaFrameUrl(value) {
  const url = parsedUrl(value);
  return Boolean(url && url.protocol === "https:" && MEDIA_FRAME_HOSTS.has(url.hostname.toLowerCase()));
}

function isApprovedMediaResource(value, initiator) {
  const url = parsedUrl(value);
  const source = parsedUrl(initiator);
  return Boolean(
    url &&
    source &&
    url.protocol === "https:" &&
    source.protocol === "https:" &&
    MEDIA_RESOURCE_HOSTS.has(url.hostname.toLowerCase()) &&
    MEDIA_FRAME_HOSTS.has(source.hostname.toLowerCase()),
  );
}

function shouldBlockPrivilegedResource(value, resourceType, method, initiator) {
  const url = parsedUrl(value);
  if (!url) return true;

  if (resourceType === "mainFrame") return !isTrustedRendererNavigation(url);
  if (resourceType === "subFrame" || resourceType === "object") return !isApprovedMediaFrameUrl(url);
  if (!CODE_RESOURCE_TYPES.has(resourceType)) return false;

  if (url.origin === APP_ORIGIN) return isNetworkAppRequest(url, method);
  return !isApprovedMediaResource(url, initiator);
}

function isDownloadableAppUrl(value) {
  const url = parsedUrl(value);
  return Boolean(
    url &&
    url.origin === APP_ORIGIN &&
    DOWNLOAD_PATH_PREFIXES.some((prefix) => pathMatchesPrefix(url.pathname, prefix)),
  );
}

function isTrustedTurnstileUrl(value) {
  const url = parsedUrl(value);
  return Boolean(
    url &&
    url.origin === APP_ORIGIN &&
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    url.pathname === TURNSTILE_PATH,
  );
}

function normalizeTurnstileAction(value) {
  return typeof value === "string" && TURNSTILE_ACTIONS.has(value) ? value : null;
}

function resolveLocalRendererPath(rendererRoot, pathname) {
  let requestedPath;
  try {
    requestedPath = decodeURIComponent(String(pathname)).replace(/^\/+/, "");
  } catch {
    return null;
  }

  if (requestedPath.includes("\0") || /^[A-Za-z]:[\\/]/.test(requestedPath) || requestedPath.startsWith("\\\\")) {
    return null;
  }
  const assetRequest = requestedPath.startsWith("assets/") || /\.[A-Za-z0-9]{1,8}$/.test(requestedPath);
  const candidate = assetRequest ? path.resolve(rendererRoot, requestedPath) : path.join(rendererRoot, "index.html");
  const resolvedRoot = path.resolve(rendererRoot);
  const insideRoot = candidate === resolvedRoot || candidate.startsWith(`${resolvedRoot}${path.sep}`);

  return insideRoot ? candidate : null;
}

module.exports = {
  APP_ORIGIN,
  APP_URL,
  NETWORK_PATH_PREFIXES,
  TURNSTILE_PATH,
  isSafeExternalUrl,
  isApprovedMediaFrameUrl,
  isDownloadableAppUrl,
  isNetworkAppRequest,
  isTrustedRendererNavigation,
  isTrustedTurnstileUrl,
  normalizeTurnstileAction,
  requestDisposition,
  resolveLocalRendererPath,
  shouldBlockPrivilegedResource,
};
