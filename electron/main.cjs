const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  screen,
  session,
  shell,
  Tray,
  WebContentsView,
} = require("electron");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { scanCaptureApps } = require("./capture-apps.cjs");
const { scanActivity } = require("./activity-scan.cjs");
const { chooseDesktopSource } = require("./source-picker.cjs");
const { showTurnstileChallenge } = require("./turnstile.cjs");
const { resolveAppIconPath } = require("./app-icon.cjs");
const { OVERLAY_SCALE_DEFAULT, clampOverlayScale, overlayBounds, overlayHtml } = require("./voice-overlay.cjs");
const { autoUpdater } = require("electron-updater");
const { configureWindowsUpdateTrust, readUnsignedWindowsUpdatesOptIn } = require("./windows-update-trust.cjs");
const {
  APP_ORIGIN,
  APP_URL,
  isSafeExternalUrl,
  isDownloadableAppUrl,
  isTrustedRendererNavigation,
  requestDisposition,
  resolveLocalRendererPath,
  shouldBlockPrivilegedResource,
} = require("./security-boundary.cjs");

// Keep Electron's crash-dump path disabled so minidumps cannot persist
// message content or session state outside the app's own storage.
app.commandLine.appendSwitch("disable-breakpad");
const TURNSTILE_REQUEST_CHANNEL = "decave:turnstile:verify";
const LOCAL_RENDERER_ROOT = path.resolve(__dirname, "..", "dist");
const RENDERER_SESSION_PARTITION = "persist:decave-local-renderer-v1";
const OVERLAY_SESSION_PARTITION = "persist:decave-overlay-v1";
const BROWSER_SESSION_PARTITION = "persist:decave-browser-v1";
const BROWSER_PERMISSION_TIMEOUT_MS = 30_000;
const BROWSER_PERMISSIONS = new Set([
  "media",
  "audioCapture",
  "videoCapture",
  "notifications",
  "geolocation",
  "clipboard-read",
  "clipboard-sanitized-write",
]);

let mainWindow = null;
let rendererSession = null;
let browserView = null;
let browserViewId = null;
const browserViews = new Map();
const browserPermissionRequests = new Map();
const browserPermissionGrants = new Map();
const browserPermissionOnce = new Map();
let browserSessionConfigured = false;
let tray = null;
let isQuitting = false;
let voiceOverlayWindow = null;
let voiceOverlayState = { enabled: true, connected: false, roomName: "", participants: [] };
let streamerModeEnabled = false;
let updaterStarted = false;
let updaterCheckTimer = null;
let desktopUpdateState = {
  status: app.isPackaged ? "idle" : "disabled",
  currentVersion: app.getVersion(),
  availableVersion: null,
  percent: null,
  transferred: null,
  total: null,
  bytesPerSecond: null,
  checkedAt: null,
  error: null,
};

const DESKTOP_SETTINGS_FILE = "desktop-settings.json";
const DEFAULT_DESKTOP_SETTINGS = Object.freeze({
  openAtLogin: false,
  closeToTray: false,
  voiceOverlayEnabled: true,
  voiceOverlayScale: OVERLAY_SCALE_DEFAULT,
  streamerMode: false,
  keybinds: {
    toggleMute: "CommandOrControl+Shift+M",
    toggleDeafen: "CommandOrControl+Shift+D",
  },
});
let desktopSettings = {
  openAtLogin: DEFAULT_DESKTOP_SETTINGS.openAtLogin,
  closeToTray: DEFAULT_DESKTOP_SETTINGS.closeToTray,
  voiceOverlayEnabled: DEFAULT_DESKTOP_SETTINGS.voiceOverlayEnabled,
  voiceOverlayScale: DEFAULT_DESKTOP_SETTINGS.voiceOverlayScale,
  streamerMode: DEFAULT_DESKTOP_SETTINGS.streamerMode,
  keybinds: { ...DEFAULT_DESKTOP_SETTINGS.keybinds },
};

function isTrustedUrl(value) {
  return isTrustedRendererNavigation(value);
}

function isTrustedOrigin(value) {
  try {
    return new URL(value).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

function desktopSettingsPath() {
  return path.join(app.getPath("userData"), DESKTOP_SETTINGS_FILE);
}

function cleanDesktopSettings(value) {
  const raw = value && typeof value === "object" ? value : {};
  const keybinds = raw.keybinds && typeof raw.keybinds === "object" ? raw.keybinds : {};
  return {
    openAtLogin: raw.openAtLogin === true,
    closeToTray: raw.closeToTray === true,
    voiceOverlayEnabled: raw.voiceOverlayEnabled !== false,
    voiceOverlayScale: clampOverlayScale(raw.voiceOverlayScale ?? OVERLAY_SCALE_DEFAULT),
    streamerMode: raw.streamerMode === true,
    keybinds: {
      toggleMute:
        typeof keybinds.toggleMute === "string" && keybinds.toggleMute.length <= 64
          ? keybinds.toggleMute
          : DEFAULT_DESKTOP_SETTINGS.keybinds.toggleMute,
      toggleDeafen:
        typeof keybinds.toggleDeafen === "string" && keybinds.toggleDeafen.length <= 64
          ? keybinds.toggleDeafen
          : DEFAULT_DESKTOP_SETTINGS.keybinds.toggleDeafen,
    },
  };
}

async function loadDesktopSettings() {
  try {
    desktopSettings = cleanDesktopSettings(JSON.parse(await fs.readFile(desktopSettingsPath(), "utf8")));
  } catch {
    desktopSettings = cleanDesktopSettings(DEFAULT_DESKTOP_SETTINGS);
  }
  streamerModeEnabled = desktopSettings.streamerMode === true;
}

async function persistDesktopSettings() {
  try {
    await fs.mkdir(path.dirname(desktopSettingsPath()), { recursive: true });
    await fs.writeFile(desktopSettingsPath(), JSON.stringify(desktopSettings, null, 2), "utf8");
  } catch (error) {
    console.warn("Could not persist DeCave desktop settings:", error);
  }
}

function trustedMainRenderer(event) {
  return Boolean(
    mainWindow &&
    !mainWindow.isDestroyed() &&
    event?.sender === mainWindow.webContents &&
    isTrustedUrl(event.sender.getURL()),
  );
}

function publicUpdateState() {
  return { ...desktopUpdateState };
}

function publishUpdateState(patch) {
  desktopUpdateState = { ...desktopUpdateState, ...patch };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("decave:update:status", publicUpdateState());
  }
  return publicUpdateState();
}

async function checkForDesktopUpdate() {
  if (!app.isPackaged || !updaterStarted) return publicUpdateState();
  if (["checking", "downloading"].includes(desktopUpdateState.status)) {
    return publicUpdateState();
  }
  publishUpdateState({ status: "checking", checkedAt: new Date().toISOString(), error: null });
  try {
    await autoUpdater.checkForUpdates();
  } catch {
    publishUpdateState({
      status: "error",
      error: "DeCave could not check for updates. Check your connection and try again.",
    });
  }
  return publicUpdateState();
}

function startDesktopUpdater() {
  if (updaterStarted || !app.isPackaged || (process.platform !== "win32" && process.platform !== "darwin")) return;
  if (process.platform === "win32") {
    try {
      const allowUnsignedUpdates = readUnsignedWindowsUpdatesOptIn(path.join(app.getAppPath(), "package.json"));
      const trustMode = configureWindowsUpdateTrust({
        configPath: path.join(process.resourcesPath, "app-update.yml"),
        executablePath: process.execPath,
        allowUnsignedUpdates,
        autoUpdater,
      });
      if (trustMode === "unsigned") {
        console.warn("DeCave Windows updates are not publisher-authenticated; integrity relies on update-feed hashes.");
      }
    } catch (error) {
      publishUpdateState({
        status: "error",
        error: "Automatic updates are disabled because the installed Windows publisher could not be verified.",
      });
      console.error("DeCave Windows updater disabled:", error instanceof Error ? error.message : "verification failed");
      return;
    }
  }
  updaterStarted = true;
  autoUpdater.logger = console;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.disableWebInstaller = true;

  autoUpdater.on("checking-for-update", () => {
    publishUpdateState({ status: "checking", checkedAt: new Date().toISOString(), error: null });
  });
  autoUpdater.on("update-available", (info) => {
    publishUpdateState({
      status: "downloading",
      availableVersion: typeof info?.version === "string" ? info.version : null,
      percent: 0,
      transferred: 0,
      total: null,
      bytesPerSecond: null,
      error: null,
    });
  });
  autoUpdater.on("update-not-available", () => {
    publishUpdateState({
      status: "up-to-date",
      availableVersion: null,
      percent: null,
      transferred: null,
      total: null,
      bytesPerSecond: null,
      error: null,
    });
  });
  autoUpdater.on("download-progress", (progress) => {
    publishUpdateState({
      status: "downloading",
      percent: Number.isFinite(progress?.percent) ? Math.max(0, Math.min(100, progress.percent)) : null,
      transferred: Number.isFinite(progress?.transferred) ? progress.transferred : null,
      total: Number.isFinite(progress?.total) ? progress.total : null,
      bytesPerSecond: Number.isFinite(progress?.bytesPerSecond) ? progress.bytesPerSecond : null,
      error: null,
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    publishUpdateState({
      status: "downloaded",
      availableVersion: typeof info?.version === "string" ? info.version : desktopUpdateState.availableVersion,
      percent: 100,
      error: null,
    });
  });
  autoUpdater.on("error", () => {
    publishUpdateState({
      status: "error",
      error: "DeCave could not complete the update. Please try again later.",
    });
  });

  const initialCheck = setTimeout(() => void checkForDesktopUpdate(), 12_000);
  initialCheck.unref?.();
  updaterCheckTimer = setInterval(() => void checkForDesktopUpdate(), 4 * 60 * 60 * 1000);
  updaterCheckTimer.unref?.();
}

function sendVoiceShortcut(action) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("decave:global-voice-action", action);
}

function validAccelerator(value) {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 64 &&
    /^[A-Za-z0-9+]+$/.test(value) &&
    !value.startsWith("+") &&
    !value.endsWith("+") &&
    !value.includes("++")
  );
}

function registerVoiceShortcuts(keybinds = desktopSettings.keybinds) {
  globalShortcut.unregisterAll();
  const mute = validAccelerator(keybinds.toggleMute)
    ? keybinds.toggleMute
    : DEFAULT_DESKTOP_SETTINGS.keybinds.toggleMute;
  const deafen = validAccelerator(keybinds.toggleDeafen)
    ? keybinds.toggleDeafen
    : DEFAULT_DESKTOP_SETTINGS.keybinds.toggleDeafen;
  if (mute === deafen) throw new Error("Mute and deafen keybinds must be different.");

  const registeredMute = globalShortcut.register(mute, () => sendVoiceShortcut("toggleMute"));
  const registeredDeafen = globalShortcut.register(deafen, () => sendVoiceShortcut("toggleDeafen"));
  if (!registeredMute || !registeredDeafen) {
    globalShortcut.unregisterAll();
    throw new Error("One of those shortcuts is already in use by Windows or another app.");
  }
  desktopSettings.keybinds = { toggleMute: mute, toggleDeafen: deafen };
  return { ...desktopSettings.keybinds };
}

function ensureTray() {
  if (!desktopSettings.closeToTray) {
    if (tray) {
      tray.destroy();
      tray = null;
    }
    return;
  }
  if (tray) return;
  const icon = nativeImage.createFromPath(resolveAppIconPath());
  tray = new Tray(icon);
  tray.setToolTip("DeCave");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Open DeCave",
        click: () => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        },
      },
      { type: "separator" },
      { label: "Mute / Unmute", click: () => sendVoiceShortcut("toggleMute") },
      { label: "Deafen / Undeafen", click: () => sendVoiceShortcut("toggleDeafen") },
      { type: "separator" },
      {
        label: "Quit DeCave",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("double-click", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
  });
}

function applyLoginSetting() {
  if (process.platform !== "win32" && process.platform !== "darwin") return;
  try {
    app.setLoginItemSettings({
      openAtLogin: desktopSettings.openAtLogin,
      openAsHidden: false,
    });
  } catch (error) {
    console.warn("Could not update DeCave startup setting:", error);
  }
}

function safeOverlayAvatarUrl(value) {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value, APP_ORIGIN);
    if (url.origin !== APP_ORIGIN || url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

function positionVoiceOverlay() {
  if (!voiceOverlayWindow || voiceOverlayWindow.isDestroyed()) return;
  // Games are often on a secondary monitor. Anchoring to the display nearest
  // the active pointer keeps the overlay with the game instead of marooning it
  // on the primary desktop.
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  voiceOverlayWindow.setBounds(
    overlayBounds(display.workArea, voiceOverlayState.participants.length, desktopSettings.voiceOverlayScale),
  );
}

async function ensureVoiceOverlayWindow() {
  if (voiceOverlayWindow && !voiceOverlayWindow.isDestroyed()) return voiceOverlayWindow;
  // The main renderer session intentionally rejects data/file main frames.
  // Keep this static, no-network overlay in its own isolated partition so the
  // trusted renderer's navigation filter cannot reject it before it appears.
  const overlaySession = session.fromPartition(OVERLAY_SESSION_PARTITION);
  voiceOverlayWindow = new BrowserWindow({
    width: 260,
    height: 160,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    webPreferences: {
      session: overlaySession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: false,
    },
  });
  voiceOverlayWindow.setIgnoreMouseEvents(true, { forward: true });
  voiceOverlayWindow.setAlwaysOnTop(true, "screen-saver");
  // Keep the voice cards above borderless/fullscreen game windows where the
  // platform permits it. Reapply the topmost level after every show because
  // some Windows display-mode changes reset the window z-order.
  try {
    voiceOverlayWindow.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
  } catch {
    // This is unavailable on some window managers; always-on-top still works.
  }
  voiceOverlayWindow.setContentProtection(streamerModeEnabled);
  voiceOverlayWindow.on("closed", () => {
    voiceOverlayWindow = null;
  });
  try {
    await voiceOverlayWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(overlayHtml())}`);
  } catch (error) {
    console.warn("Could not load the DeCave in-game voice overlay:", error);
    if (!voiceOverlayWindow.isDestroyed()) voiceOverlayWindow.destroy();
    voiceOverlayWindow = null;
    return null;
  }
  positionVoiceOverlay();
  return voiceOverlayWindow;
}

async function renderVoiceOverlay() {
  const shouldShow =
    desktopSettings.voiceOverlayEnabled &&
    voiceOverlayState.enabled !== false &&
    voiceOverlayState.connected === true &&
    Array.isArray(voiceOverlayState.participants) &&
    voiceOverlayState.participants.length > 0;
  if (!shouldShow) {
    if (voiceOverlayWindow && !voiceOverlayWindow.isDestroyed()) voiceOverlayWindow.hide();
    return;
  }
  const overlay = await ensureVoiceOverlayWindow();
  if (!overlay || overlay.isDestroyed()) return;
  overlay.setAlwaysOnTop(true, "screen-saver");
  try {
    overlay.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
  } catch {}
  positionVoiceOverlay();
  const safeState = {
    scale: clampOverlayScale(desktopSettings.voiceOverlayScale) / 100,
    roomName: voiceOverlayState.roomName,
    participants: voiceOverlayState.participants.slice(0, 12).map((participant) => ({
      connectionId: typeof participant.connectionId === "string" ? participant.connectionId : "",
      username: typeof participant.username === "string" ? participant.username.slice(0, 32) : "Unknown",
      avatarUrl: safeOverlayAvatarUrl(participant.avatarUrl),
      speaking: participant.speaking === true,
      muted: participant.muted === true,
      deafened: participant.deafened === true,
    })),
  };
  await overlay.webContents
    .executeJavaScript(`window.decaveRender(${JSON.stringify(safeState)})`, true)
    .catch(() => undefined);
  if (overlay.isMinimized()) overlay.restore();
  overlay.showInactive();
}

async function applyDesktopSettings() {
  applyLoginSetting();
  ensureTray();
  try {
    registerVoiceShortcuts(desktopSettings.keybinds);
  } catch (error) {
    console.warn("Could not register saved DeCave keybinds:", error);
    desktopSettings.keybinds = { ...DEFAULT_DESKTOP_SETTINGS.keybinds };
    try {
      registerVoiceShortcuts(desktopSettings.keybinds);
    } catch {}
  }
  await renderVoiceOverlay();
}

function rendererContentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".ico":
      return "image/x-icon";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function localRendererHeaders(filePath) {
  return {
    "content-type": rendererContentType(filePath),
    "cache-control": filePath.endsWith(".html") ? "no-store" : "private, max-age=31536000, immutable",
    "content-security-policy":
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://rtc.live.cloudflare.com wss://app.de-cave.com; frame-src 'none'; object-src 'none'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    "permissions-policy": "camera=(self), microphone=(self), display-capture=(self), geolocation=()",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

async function localRendererResponse(url, method) {
  const candidate = resolveLocalRendererPath(LOCAL_RENDERER_ROOT, url.pathname);
  if (!candidate) return new Response("Not found", { status: 404 });
  try {
    const bytes = await fs.readFile(candidate);
    return new Response(method === "HEAD" ? null : bytes, {
      headers: localRendererHeaders(candidate),
    });
  } catch (error) {
    if (error?.code === "ENOENT") return new Response("Not found", { status: 404 });
    throw error;
  }
}

function setCookieValues(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const value = headers.get("set-cookie");
  return value ? [value] : [];
}

async function syncRendererCookies(url, headers) {
  if (!rendererSession || new URL(url).origin !== APP_ORIGIN) return;
  for (const rawCookie of setCookieValues(headers)) {
    const parts = String(rawCookie)
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean);
    const separator = parts[0]?.indexOf("=") ?? -1;
    if (separator <= 0) continue;
    const name = parts[0].slice(0, separator).trim();
    const value = parts[0].slice(separator + 1).trim();
    const attributes = new Map(
      parts.slice(1).map((part) => {
        const index = part.indexOf("=");
        return index < 0 ? [part.toLowerCase(), ""] : [part.slice(0, index).toLowerCase(), part.slice(index + 1)];
      }),
    );
    if (attributes.get("max-age") === "0") {
      await rendererSession.cookies.remove(APP_ORIGIN, name).catch(() => {});
      continue;
    }
    await rendererSession.cookies
      .set({
        url: APP_ORIGIN,
        name,
        value,
        path: attributes.get("path") || "/",
        secure: attributes.has("secure"),
        httpOnly: attributes.has("httponly"),
        sameSite: attributes.has("samesite")
          ? String(attributes.get("samesite")).toLowerCase() === "strict"
            ? "strict"
            : String(attributes.get("samesite")).toLowerCase() === "none"
              ? "no_restriction"
              : "lax"
          : "lax",
        ...(attributes.has("max-age") && Number.isFinite(Number(attributes.get("max-age")))
          ? { expirationDate: Math.floor(Date.now() / 1000) + Number(attributes.get("max-age")) }
          : {}),
      })
      .catch(() => {});
  }
}

async function networkRendererResponse(request) {
  const headers = new Headers(request.headers);
  // Chromium supplies browser-only hop-by-hop/encoding headers. Node's fetch
  // manages these itself, and forwarding them can leave a custom-protocol
  // request waiting indefinitely on some Electron builds.
  for (const header of ["accept-encoding", "connection", "content-length", "host"]) {
    headers.delete(header);
  }
  if (new URL(request.url).origin === APP_ORIGIN && rendererSession) {
    const cookies = await rendererSession.cookies.get({ url: APP_ORIGIN }).catch(() => []);
    if (cookies.length > 0) {
      headers.set("cookie", cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "));
    }
  }
  const method = String(request.method || "GET").toUpperCase();
  const init = {
    method,
    headers,
    redirect: "manual",
  };
  if (method !== "GET" && method !== "HEAD") {
    init.body = await request.arrayBuffer();
    init.duplex = "half";
  }
  const upstream = await fetch(request.url, init);
  await syncRendererCookies(request.url, upstream.headers);
  const responseHeaders = new Headers(upstream.headers);
  // Node fetch transparently decodes compressed responses after removing the
  // request's accept-encoding header; stale entity headers would make the
  // renderer attempt to decode the body a second time.
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

async function installLocalRenderer() {
  const indexPath = path.join(LOCAL_RENDERER_ROOT, "index.html");
  try {
    await fs.access(indexPath);
  } catch {
    throw new Error("The signed local renderer is missing. Run the web build before starting Electron.");
  }
  const secureSession = session.fromPartition(RENDERER_SESSION_PARTITION);
  await secureSession.clearStorageData({
    storages: ["serviceworkers", "cachestorage"],
  });
  secureSession.webRequest.onBeforeRequest((details, callback) => {
    callback({
      cancel: shouldBlockPrivilegedResource(details.url, details.resourceType, details.method, details.initiator),
    });
  });
  await secureSession.protocol.handle("https", async (request) => {
    const disposition = requestDisposition(request.url, request.method);
    if (disposition === "network") {
      return networkRendererResponse(request);
    }
    if (disposition !== "local") return new Response("Bad request", { status: 400 });
    const url = new URL(request.url);
    return localRendererResponse(url, request.method);
  });
  rendererSession = secureSession;
  return secureSession;
}

function configurePermissions(ses) {
  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (
      !mainWindow ||
      mainWindow.isDestroyed() ||
      webContents !== mainWindow.webContents ||
      !isTrustedOrigin(requestingOrigin) ||
      !isTrustedUrl(webContents.getURL())
    ) {
      return false;
    }

    return ["media", "display-capture", "fullscreen", "notifications", "clipboard-sanitized-write"].includes(
      permission,
    );
  });

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details?.requestingUrl || details?.requestingOrigin || webContents.getURL();

    const allowed =
      Boolean(mainWindow) &&
      !mainWindow.isDestroyed() &&
      webContents === mainWindow.webContents &&
      isTrustedUrl(requestingUrl) &&
      ["media", "display-capture", "fullscreen", "notifications", "clipboard-sanitized-write"].includes(permission);

    callback(allowed);
  });

  ses.setDisplayMediaRequestHandler(
    async (request, callback) => {
      if (!isTrustedOrigin(request.securityOrigin)) {
        callback({});
        return;
      }

      try {
        const source = await chooseDesktopSource(mainWindow);
        if (!source) {
          callback({});
          return;
        }

        // Chromium swaps "loopback" for the process-excluding
        // "loopbackWithoutChrome" device when the page asks for
        // restrictOwnAudio and the OS supports it; the renderer checks the
        // track's deviceId before sending any system audio.
        callback({
          video: source,
          ...(request.audioRequested ? { audio: "loopback" } : {}),
        });
      } catch (error) {
        console.error("DeCave screen-share picker failed:", error);
        callback({});
      }
    },
    { useSystemPicker: true },
  );
}

function normalizeBrowserUrl(value) {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function browserOrigin(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function browserPermissionKey(origin, permission, mediaType = "") {
  return `${origin}\u0000${permission}\u0000${mediaType}`;
}

function cancelBrowserPermissionRequestsForView(id) {
  for (const [requestId, request] of browserPermissionRequests) {
    if (request.id !== id) continue;
    clearTimeout(request.timer);
    browserPermissionRequests.delete(requestId);
    try {
      request.callback(false);
    } catch {}
  }
}

function publishBrowserPermissionBlocked(id, permission, origin = "") {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("decave:browser:permission-blocked", { id, permission, origin });
  }
}

function browserEntry(id = browserViewId) {
  return id ? (browserViews.get(id) ?? null) : null;
}

function browserState(id = browserViewId) {
  const entry = browserEntry(id);
  const contents = entry?.view.webContents;
  return {
    id: entry?.id ?? null,
    url: contents && !contents.isDestroyed() ? contents.getURL() : "",
    title: contents && !contents.isDestroyed() ? contents.getTitle() : "",
    canGoBack: Boolean(contents && !contents.isDestroyed() && contents.canGoBack()),
    canGoForward: Boolean(contents && !contents.isDestroyed() && contents.canGoForward()),
    zoomFactor: entry?.zoomFactor ?? 1,
    isFullscreen: entry?.isFullscreen === true,
    findResult: entry?.findResult ?? null,
    bounds: entry?.bounds ?? null,
  };
}

function publishBrowserState(patch = {}, id = browserViewId) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("decave:browser:state", { ...browserState(id), ...patch });
  }
}

function activateBrowserView(id) {
  const entry = browserEntry(id);
  if (!entry || !mainWindow || mainWindow.isDestroyed()) return false;
  if (browserViewId && browserViewId !== id) {
    const previous = browserEntry(browserViewId);
    if (previous?.isFullscreen && mainWindow) {
      try {
        mainWindow.setFullScreen(false);
      } catch {}
      previous.isFullscreen = false;
    }
    try {
      if (previous) mainWindow.contentView.removeChildView(previous.view);
    } catch {}
  }
  try {
    if (browserViewId !== id) mainWindow.contentView.addChildView(entry.view);
  } catch {}
  browserView = entry.view;
  browserViewId = entry.id;
  if (entry.bounds) {
    try {
      entry.view.setBounds(entry.bounds);
    } catch {}
  }
  publishBrowserState({}, id);
  return true;
}

function deactivateBrowserView(id) {
  if (!browserViewId || id !== browserViewId) return false;
  cancelBrowserPermissionRequestsForView(id);
  const entry = browserEntry(id);
  if (entry?.isFullscreen && mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.setFullScreen(false);
    } catch {}
    entry.isFullscreen = false;
  }
  try {
    if (entry && mainWindow && !mainWindow.isDestroyed()) mainWindow.contentView.removeChildView(entry.view);
  } catch {}
  browserView = null;
  browserViewId = null;
  return true;
}

function destroyBrowserView(id = null) {
  const entries = id ? [browserEntry(id)].filter(Boolean) : [...browserViews.values()];
  for (const entry of entries) {
    cancelBrowserPermissionRequestsForView(entry.id);
    if (entry.id === browserViewId) {
      browserView = null;
      browserViewId = null;
    }
    browserViews.delete(entry.id);
    try {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.contentView.removeChildView(entry.view);
    } catch {}
    try {
      if (!entry.view.webContents.isDestroyed()) entry.view.webContents.destroy();
    } catch {}
  }
}

function installBrowserView(view, id) {
  const contents = view.webContents;
  const guardNavigation = (event, url) => {
    if (!normalizeBrowserUrl(url)) event.preventDefault();
    else publishBrowserState({}, id);
  };
  contents.on("will-navigate", guardNavigation);
  contents.on("will-redirect", guardNavigation);
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  const clearFind = () => {
    const entry = browserEntry(id);
    if (!entry) return;
    entry.findText = "";
    entry.findResult = null;
    try {
      contents.stopFindInPage("clearSelection");
    } catch {}
  };
  contents.on("did-navigate", () => {
    clearFind();
    publishBrowserState({}, id);
  });
  contents.on("did-navigate-in-page", () => {
    clearFind();
    publishBrowserState({}, id);
  });
  contents.on("page-title-updated", (_event, title) => publishBrowserState({ title }, id));
  contents.on("did-finish-load", () => publishBrowserState({}, id));
  contents.on("did-fail-load", (_event, errorDescription) => publishBrowserState({ error: errorDescription }, id));
  contents.on("found-in-page", (_event, result) => {
    const entry = browserEntry(id);
    if (!entry) return;
    entry.findResult = {
      activeMatchOrdinal: Number.isFinite(result?.activeMatchOrdinal) ? result.activeMatchOrdinal : 0,
      matches: Number.isFinite(result?.matches) ? result.matches : 0,
      finalUpdate: result?.finalUpdate === true,
    };
    publishBrowserState({ findResult: entry.findResult }, id);
  });
  contents.on("enter-html-full-screen", () => {
    const entry = browserEntry(id);
    if (!entry || browserViewId !== id || !mainWindow || mainWindow.isDestroyed()) return;
    entry.isFullscreen = true;
    try {
      mainWindow.setFullScreen(true);
    } catch {}
    publishBrowserState({}, id);
  });
  contents.on("leave-html-full-screen", () => {
    const entry = browserEntry(id);
    if (!entry) return;
    entry.isFullscreen = false;
    if (browserViewId === id && mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.setFullScreen(false);
      } catch {}
    }
    publishBrowserState({}, id);
  });
}

function configureBrowserSession() {
  if (browserSessionConfigured) return;
  const browserSession = session.fromPartition(BROWSER_SESSION_PARTITION);
  browserSessionConfigured = true;
  browserSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const origin = browserOrigin(requestingOrigin || details?.requestingUrl || "");
    if (!origin || !BROWSER_PERMISSIONS.has(permission)) return false;
    if (webContents) {
      const entry = [...browserViews.values()].find((candidate) => candidate.view.webContents === webContents);
      if (!entry) return false;
    }
    const mediaType = typeof details?.mediaType === "string" ? details.mediaType : "";
    const key = browserPermissionKey(origin, permission, mediaType);
    if (browserPermissionGrants.get(key) === true) return true;
    const onceExpiresAt = browserPermissionOnce.get(key) ?? 0;
    if (onceExpiresAt > Date.now()) return true;
    if (onceExpiresAt) browserPermissionOnce.delete(key);
    return false;
  });
  browserSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (webContents !== browserView?.webContents) {
      callback(false);
      return;
    }
    const origin = browserOrigin(details?.requestingOrigin || details?.requestingUrl || webContents.getURL());
    if (!origin || !BROWSER_PERMISSIONS.has(permission) || !browserViewId) {
      publishBrowserPermissionBlocked(
        browserViewId,
        typeof permission === "string" ? permission : "unknown",
        origin || "",
      );
      callback(false);
      return;
    }
    const mediaType = typeof details?.mediaType === "string" ? details.mediaType : "";
    if (mainWindow && !mainWindow.isDestroyed()) {
      const requestId = randomUUID();
      const timer = setTimeout(() => {
        const request = browserPermissionRequests.get(requestId);
        if (!request) return;
        browserPermissionRequests.delete(requestId);
        try {
          request.callback(false);
        } catch {}
      }, BROWSER_PERMISSION_TIMEOUT_MS);
      browserPermissionRequests.set(requestId, { id: browserViewId, callback, timer, origin, permission, mediaType });
      mainWindow.webContents.send("decave:browser:permission-request", {
        id: browserViewId,
        requestId,
        permission: typeof permission === "string" ? permission : "unknown",
        mediaType,
        origin,
      });
      return;
    }
    publishBrowserPermissionBlocked(browserViewId, typeof permission === "string" ? permission : "unknown", origin);
    callback(false);
  });
  browserSession.on("will-download", (_event, item) => {
    item.cancel();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("decave:browser:download-blocked", {
        id: browserViewId,
        filename: item.getFilename(),
      });
    }
  });
}

function createMainWindow() {
  if (!rendererSession) {
    throw new Error("The local-renderer session has not been installed.");
  }
  const windowIconPath = resolveAppIconPath();
  const windowIcon = windowIconPath ? nativeImage.createFromPath(windowIconPath) : nativeImage.createEmpty();
  // Open at the designed size when it fits, otherwise fill most of the screen;
  // the renderer scales the interface to whatever size the window ends up.
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.min(1500, Math.round(workArea.width * 0.94)),
    height: Math.min(940, Math.round(workArea.height * 0.94)),
    minWidth: Math.min(1050, workArea.width),
    minHeight: Math.min(680, workArea.height),
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#070b14",
    title: "DeCave",
    icon: windowIcon,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      session: rendererSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      // Voice capture, health checks, and WebRTC recovery must remain active
      // while the desktop window is minimized or covered by another app.
      backgroundThrottling: false,
      devTools: !app.isPackaged,
      navigateOnDragDrop: false,
    },
  });

  if (!windowIcon.isEmpty()) mainWindow.setIcon(windowIcon);
  mainWindow.setContentProtection(streamerModeEnabled);

  mainWindow.webContents.setWindowOpenHandler(({ url, frameName }) => {
    // The renderer uses one same-origin about:blank child window for stream
    // Pop Out. Keep popup creation deny-by-default and allow only this exact
    // named window from the already-trusted main renderer.
    if (url === "about:blank" && frameName === "decave-stream") {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 1100,
          height: 700,
          minWidth: 480,
          minHeight: 320,
          autoHideMenuBar: true,
          backgroundColor: "#05070d",
          title: "DeCave Stream",
          icon: windowIcon,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            navigateOnDragDrop: false,
          },
        },
      };
    }

    if (isTrustedUrl(url)) {
      mainWindow.loadURL(url);
      return { action: "deny" };
    }

    if (isDownloadableAppUrl(url)) {
      mainWindow.webContents.downloadURL(url);
    } else if (isSafeExternalUrl(url) && !isTrustedOrigin(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("did-create-window", (childWindow, details) => {
    const isStreamPopout = details.url === "about:blank" && details.frameName === "decave-stream";

    // Defense in depth: setWindowOpenHandler should make this unreachable for
    // every other request, but never leave an unexpected renderer-created
    // BrowserWindow alive if Electron behavior changes.
    if (!isStreamPopout) {
      if (!childWindow.isDestroyed()) childWindow.close();
      return;
    }

    if (!windowIcon.isEmpty()) childWindow.setIcon(windowIcon);
    childWindow.setMenuBarVisibility(false);

    // The pop-out is only a presentation surface populated by the opener.
    // It must not create more windows, attach webviews, or navigate away from
    // about:blank into arbitrary content.
    childWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const guardStreamPopoutNavigation = (event, url) => {
      if (url === "about:blank") return;
      event.preventDefault();
    };
    childWindow.webContents.on("will-navigate", guardStreamPopoutNavigation);
    childWindow.webContents.on("will-redirect", guardStreamPopoutNavigation);
    childWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
  });

  const guardMainNavigation = (event, url) => {
    if (isTrustedUrl(url)) return;
    event.preventDefault();
    // Settings → Support uses mailto: links; hand them to the mail app.
    if (/^mailto:support@de-cave\.com(?:\?|$)/i.test(url)) {
      void shell.openExternal(url);
    } else if (isDownloadableAppUrl(url)) {
      mainWindow.webContents.downloadURL(url);
    } else if (isSafeExternalUrl(url) && !isTrustedOrigin(url)) {
      void shell.openExternal(url);
    }
  };
  mainWindow.webContents.on("will-navigate", guardMainNavigation);
  mainWindow.webContents.on("will-redirect", guardMainNavigation);
  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());

  mainWindow.once("ready-to-show", () => {
    if (!windowIcon.isEmpty()) mainWindow.setIcon(windowIcon);
    mainWindow.show();
    // The design reference is a full-workspace canvas. Keep normal packaged
    // window behavior, but allow the local visual-test launcher to present a
    // single maximized canvas for pixel comparison.
    if (process.env.DECAVE_LOCAL_TEST === "1" && !mainWindow.isMaximized()) mainWindow.maximize();
    mainWindow.focus();
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting && desktopSettings.closeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    destroyBrowserView();
    mainWindow = null;
    // The optional voice overlay is a hidden BrowserWindow, so Electron's
    // window-all-closed event does not fire when the visible window closes.
    // Explicitly quit here unless the user intentionally enabled tray mode;
    // otherwise an invisible process keeps the single-instance lock and makes
    // subsequent shortcut launches appear to do nothing.
    if (!desktopSettings.closeToTray && !isQuitting) {
      isQuitting = true;
      app.quit();
    }
  });

  void mainWindow.loadURL(APP_URL).catch((error) => {
    console.error("The packaged local renderer failed to load:", error);
    app.exit(1);
  });
}

function trustedBrowserRequest(event, requestedId) {
  return trustedMainRenderer(event) && Boolean(browserViewId && requestedId === browserViewId);
}

ipcMain.handle("decave:browser:create", async (event, rawInput) => {
  if (!trustedMainRenderer(event)) throw new Error("Untrusted renderer requested a browser view.");
  const url = normalizeBrowserUrl(rawInput?.url);
  if (!url) throw new Error("Browser navigation requires an HTTPS URL without credentials.");
  const tabKey =
    typeof rawInput?.tabKey === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(rawInput.tabKey) ? rawInput.tabKey : null;
  if (!tabKey) throw new Error("Browser tabs require a valid local tab key.");
  const existing = [...browserViews.values()].find((entry) => entry.tabKey === tabKey);
  if (existing) {
    activateBrowserView(existing.id);
    return browserState(existing.id);
  }
  if (browserViews.size >= 8) throw new Error("The browser tab limit has been reached.");
  const id = randomUUID();
  const view = new WebContentsView({
    webPreferences: {
      partition: BROWSER_SESSION_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
      navigateOnDragDrop: false,
    },
  });
  configureBrowserSession();
  browserViews.set(id, {
    id,
    tabKey,
    view,
    bounds: null,
    zoomFactor: 1,
    isFullscreen: false,
    findText: "",
    findResult: null,
  });
  installBrowserView(view, id);
  activateBrowserView(id);
  try {
    await view.webContents.loadURL(url);
  } catch (error) {
    destroyBrowserView(id);
    throw error;
  }
  publishBrowserState({}, id);
  return browserState(id);
});

ipcMain.handle("decave:browser:deactivate", (event, rawId) => {
  if (!trustedMainRenderer(event) || typeof rawId !== "string") return false;
  return deactivateBrowserView(rawId);
});

ipcMain.handle("decave:browser:respond-permission", (event, rawInput) => {
  if (!trustedMainRenderer(event)) return false;
  const requestId =
    typeof rawInput?.requestId === "string" && /^[0-9a-f-]{36}$/i.test(rawInput.requestId) ? rawInput.requestId : "";
  const request = requestId ? browserPermissionRequests.get(requestId) : null;
  if (!request) return false;
  clearTimeout(request.timer);
  browserPermissionRequests.delete(requestId);
  const allow =
    rawInput.allow === true &&
    request.id === browserViewId &&
    browserEntry(request.id)?.view.webContents === browserView?.webContents;
  if (allow) {
    const key = browserPermissionKey(request.origin, request.permission, request.mediaType);
    if (rawInput.scope === "site") browserPermissionGrants.set(key, true);
    if (rawInput.scope === "once") browserPermissionOnce.set(key, Date.now() + BROWSER_PERMISSION_TIMEOUT_MS);
  }
  try {
    request.callback(allow);
  } catch {}
  return true;
});

ipcMain.handle("decave:browser:set-bounds", (event, rawInput) => {
  if (!trustedBrowserRequest(event, rawInput?.id) || !browserView) return false;
  const number = (value, fallback) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
  const width = Math.min(10000, Math.max(120, Math.round(number(rawInput.width, 120))));
  const height = Math.min(10000, Math.max(80, Math.round(number(rawInput.height, 80))));
  const bounds = {
    x: Math.max(0, Math.round(number(rawInput.x, 0))),
    y: Math.max(0, Math.round(number(rawInput.y, 0))),
    width,
    height,
  };
  const entry = browserEntry(browserViewId);
  if (entry) entry.bounds = bounds;
  browserView.setBounds(bounds);
  return true;
});

ipcMain.handle("decave:browser:navigate", async (event, rawInput) => {
  if (!trustedBrowserRequest(event, rawInput?.id) || !browserView) return false;
  const url = normalizeBrowserUrl(rawInput?.url);
  if (!url) return false;
  await browserView.webContents.loadURL(url);
  publishBrowserState();
  return true;
});

ipcMain.handle("decave:browser:back", (event, rawId) => {
  if (!trustedBrowserRequest(event, rawId) || !browserView) return false;
  if (browserView.webContents.canGoBack()) browserView.webContents.goBack();
  return true;
});

ipcMain.handle("decave:browser:forward", (event, rawId) => {
  if (!trustedBrowserRequest(event, rawId) || !browserView) return false;
  if (browserView.webContents.canGoForward()) browserView.webContents.goForward();
  return true;
});

ipcMain.handle("decave:browser:reload", (event, rawId) => {
  if (!trustedBrowserRequest(event, rawId) || !browserView) return false;
  browserView.webContents.reload();
  return true;
});

ipcMain.handle("decave:browser:zoom", (event, rawInput) => {
  if (!trustedBrowserRequest(event, rawInput?.id) || !browserView) return 1;
  const entry = browserEntry(browserViewId);
  if (!entry) return 1;
  const delta = typeof rawInput?.delta === "number" && Number.isFinite(rawInput.delta) ? rawInput.delta : 0;
  const factor = Math.min(2, Math.max(0.5, delta === 0 ? 1 : (entry.zoomFactor ?? 1) + delta));
  entry.zoomFactor = factor;
  browserView.webContents.setZoomFactor(factor);
  publishBrowserState({ zoomFactor: factor });
  return factor;
});

ipcMain.handle("decave:browser:find", (event, rawInput) => {
  if (!trustedBrowserRequest(event, rawInput?.id) || !browserView) return false;
  const entry = browserEntry(browserViewId);
  if (!entry) return false;
  const text = typeof rawInput?.text === "string" ? rawInput.text.trim().slice(0, 200) : "";
  if (!text) {
    entry.findText = "";
    entry.findResult = null;
    try {
      browserView.webContents.stopFindInPage("clearSelection");
    } catch {}
    publishBrowserState({ findResult: null }, browserViewId);
    return true;
  }
  const forward = rawInput?.forward !== false;
  if (entry.findText !== text) {
    try {
      browserView.webContents.stopFindInPage("clearSelection");
    } catch {}
    entry.findText = text;
  }
  browserView.webContents.findInPage(text, { forward, findNext: true, matchCase: false });
  return true;
});

ipcMain.handle("decave:browser:stop-find", (event, rawId) => {
  if (!trustedBrowserRequest(event, rawId) || !browserView) return false;
  const entry = browserEntry(browserViewId);
  if (!entry) return false;
  entry.findText = "";
  entry.findResult = null;
  try {
    browserView.webContents.stopFindInPage("clearSelection");
  } catch {}
  publishBrowserState({ findResult: null }, browserViewId);
  return true;
});

ipcMain.handle("decave:browser:get-state", (event) => {
  if (!trustedMainRenderer(event)) throw new Error("Untrusted renderer requested browser state.");
  return browserState();
});

ipcMain.handle("decave:browser:destroy", (event, rawId) => {
  if (!trustedMainRenderer(event) || typeof rawId !== "string" || !browserViews.has(rawId)) return false;
  destroyBrowserView(rawId);
  return true;
});

// Logout wipes the in-app browser profile so the next account on this device
// does not inherit the previous user's web sessions.
ipcMain.handle("decave:browser:clear-session", async (event) => {
  if (!trustedMainRenderer(event)) return false;
  destroyBrowserView();
  browserPermissionGrants.clear();
  browserPermissionOnce.clear();
  const browserSession = session.fromPartition(BROWSER_SESSION_PARTITION);
  await browserSession.clearStorageData();
  await browserSession.clearCache();
  return true;
});

ipcMain.handle("decave:activity:scan", async (event) => {
  if (!trustedMainRenderer(event)) {
    throw new Error("Untrusted renderer requested an activity scan.");
  }
  return scanActivity();
});

ipcMain.handle("decave:open-external", async (event, rawUrl) => {
  if (!trustedMainRenderer(event)) return false;
  if (typeof rawUrl !== "string" || !isSafeExternalUrl(rawUrl)) return false;
  await shell.openExternal(rawUrl);
  return true;
});

ipcMain.handle("decave:update:get-status", async (event) => {
  if (!trustedMainRenderer(event)) {
    throw new Error("Untrusted renderer requested desktop update status.");
  }
  return publicUpdateState();
});

ipcMain.handle("decave:update:check", async (event) => {
  if (!trustedMainRenderer(event)) {
    throw new Error("Untrusted renderer requested a desktop update check.");
  }
  return checkForDesktopUpdate();
});

ipcMain.handle("decave:update:restart", async (event) => {
  if (!trustedMainRenderer(event)) {
    throw new Error("Untrusted renderer requested desktop update installation.");
  }
  if (!app.isPackaged || desktopUpdateState.status !== "downloaded") return false;
  isQuitting = true;
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return true;
});

// DM encryption keys (docs/security/DM-E2EE.md): the renderer keeps the account
// key in IndexedDB, wrapped here with the OS keychain so a copied profile folder
// can't be read without the user's OS login. Without a real keychain (Linux with
// no secret service falls back to a hard-coded key) this refuses and the
// renderer keeps the key as before.
function osKeychainAvailable() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (process.platform === "linux" && typeof safeStorage.getSelectedStorageBackend === "function") {
      return safeStorage.getSelectedStorageBackend() !== "basic_text";
    }
    return true;
  } catch {
    return false;
  }
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
// A keyring: 32-byte keys, at most 120 of them (shared/dm-e2ee-format.ts).
const KEYRING_MAX_BYTES = 120 * 32;

ipcMain.handle("decave:e2ee:protect-key", async (event, seedBase64) => {
  if (!trustedMainRenderer(event)) {
    throw new Error("Untrusted renderer asked to protect an encryption key.");
  }
  if (
    typeof seedBase64 !== "string" ||
    seedBase64.length > Math.ceil(KEYRING_MAX_BYTES / 3) * 4 ||
    !BASE64.test(seedBase64)
  ) {
    throw new Error("Invalid encryption key.");
  }
  const seed = Buffer.from(seedBase64, "base64");
  if (seed.length < 32 || seed.length % 32 !== 0 || seed.length > KEYRING_MAX_BYTES) {
    seed.fill(0);
    throw new Error("Invalid encryption key.");
  }
  if (!osKeychainAvailable()) {
    seed.fill(0);
    return null;
  }
  try {
    return safeStorage.encryptString(seed.toString("base64")).toString("base64");
  } finally {
    seed.fill(0);
  }
});

ipcMain.handle("decave:e2ee:unprotect-key", async (event, protectedBase64) => {
  if (!trustedMainRenderer(event)) {
    throw new Error("Untrusted renderer asked to unprotect an encryption key.");
  }
  if (typeof protectedBase64 !== "string" || protectedBase64.length > 16384 || !BASE64.test(protectedBase64)) {
    throw new Error("Invalid protected key.");
  }
  if (!osKeychainAvailable()) return null;
  return safeStorage.decryptString(Buffer.from(protectedBase64, "base64"));
});

ipcMain.handle("decave:desktop:get-settings", async (event) => {
  if (!trustedMainRenderer(event)) {
    throw new Error("Untrusted renderer requested desktop settings.");
  }
  let openAtLogin = desktopSettings.openAtLogin;
  if (process.platform === "win32") {
    try {
      openAtLogin = app.getLoginItemSettings().openAtLogin;
    } catch {}
  }
  return {
    openAtLogin,
    closeToTray: desktopSettings.closeToTray,
    voiceOverlayEnabled: desktopSettings.voiceOverlayEnabled,
    voiceOverlayScale: desktopSettings.voiceOverlayScale,
    keybinds: { ...desktopSettings.keybinds },
  };
});

ipcMain.handle("decave:desktop:set-settings", async (event, rawSettings) => {
  if (!trustedMainRenderer(event)) {
    throw new Error("Untrusted renderer attempted to change desktop settings.");
  }
  const next = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
  desktopSettings = {
    ...desktopSettings,
    openAtLogin: next.openAtLogin === true,
    closeToTray: next.closeToTray === true,
    voiceOverlayEnabled: next.voiceOverlayEnabled !== false,
    voiceOverlayScale:
      next.voiceOverlayScale === undefined
        ? desktopSettings.voiceOverlayScale
        : clampOverlayScale(next.voiceOverlayScale),
  };
  await persistDesktopSettings();
  applyLoginSetting();
  ensureTray();
  await renderVoiceOverlay();
  return {
    openAtLogin: desktopSettings.openAtLogin,
    closeToTray: desktopSettings.closeToTray,
    voiceOverlayEnabled: desktopSettings.voiceOverlayEnabled,
    voiceOverlayScale: desktopSettings.voiceOverlayScale,
  };
});

ipcMain.handle("decave:desktop:set-keybinds", async (event, rawKeybinds) => {
  if (!trustedMainRenderer(event)) {
    throw new Error("Untrusted renderer attempted to change global shortcuts.");
  }
  const previous = { ...desktopSettings.keybinds };
  try {
    const next = {
      toggleMute: typeof rawKeybinds?.toggleMute === "string" ? rawKeybinds.toggleMute : previous.toggleMute,
      toggleDeafen: typeof rawKeybinds?.toggleDeafen === "string" ? rawKeybinds.toggleDeafen : previous.toggleDeafen,
    };
    const registered = registerVoiceShortcuts(next);
    await persistDesktopSettings();
    return registered;
  } catch (error) {
    try {
      registerVoiceShortcuts(previous);
    } catch {}
    throw error;
  }
});

ipcMain.handle("decave:desktop:set-streamer-mode", async (event, enabled) => {
  if (!trustedMainRenderer(event)) {
    throw new Error("Untrusted renderer attempted to change capture protection.");
  }
  streamerModeEnabled = enabled === true;
  desktopSettings.streamerMode = streamerModeEnabled;
  await persistDesktopSettings();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setContentProtection(streamerModeEnabled);
  }
  if (voiceOverlayWindow && !voiceOverlayWindow.isDestroyed()) {
    voiceOverlayWindow.setContentProtection(streamerModeEnabled);
  }
  return streamerModeEnabled;
});

// Settings → Privacy → "Turn on Streamer mode while streaming": the renderer
// polls this and switches Streamer mode on while OBS & co. are running.
ipcMain.handle("decave:desktop:capture-apps", async (event) => {
  if (!trustedMainRenderer(event)) {
    throw new Error("Untrusted renderer requested running capture apps.");
  }
  return scanCaptureApps();
});

ipcMain.handle("decave:desktop:set-voice-overlay-state", async (event, rawState) => {
  if (!trustedMainRenderer(event)) {
    throw new Error("Untrusted renderer attempted to update the voice overlay.");
  }
  const participants = Array.isArray(rawState?.participants) ? rawState.participants.slice(0, 24) : [];
  voiceOverlayState = {
    enabled: rawState?.enabled !== false,
    connected: rawState?.connected === true,
    roomName: typeof rawState?.roomName === "string" ? rawState.roomName.slice(0, 40) : "",
    participants,
  };
  await renderVoiceOverlay();
  return true;
});

ipcMain.handle(TURNSTILE_REQUEST_CHANNEL, async (event, requestedAction) => {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender !== mainWindow.webContents ||
    !isTrustedUrl(event.sender.getURL())
  ) {
    throw new Error("Untrusted renderer requested security verification.");
  }
  return showTurnstileChallenge(mainWindow, requestedAction);
});

if (process.platform === "win32") app.setAppUserModelId("com.decave.desktop");
app.setName("DeCave");

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      if (rendererSession) createMainWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app
    .whenReady()
    .then(async () => {
      await loadDesktopSettings();
      const secureSession = await installLocalRenderer();
      configurePermissions(secureSession);
      createMainWindow();
      await applyDesktopSettings();
      startDesktopUpdater();

      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
      });
    })
    .catch((error) => {
      console.error("DeCave refused to start without its secure local renderer:", error);
      app.exit(1);
    });
}

app.on("before-quit", () => {
  isQuitting = true;
  if (updaterCheckTimer) clearInterval(updaterCheckTimer);
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (desktopSettings.closeToTray && !isQuitting) return;
  if (process.platform !== "darwin") app.quit();
});
