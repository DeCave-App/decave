const { contextBridge, ipcRenderer } = require("electron");

const REQUEST_EVENT = "decave-desktop-request";
const RESPONSE_EVENT = "decave-desktop-response";
const MARKER = "data-decave-desktop";
const bridge = {
  isDesktop: true,
  bridgeVersion: "activity-2.0",
  scanActivity: () => ipcRenderer.invoke("decave:activity:scan"),
  openExternal: (url) => ipcRenderer.invoke("decave:open-external", url),
  verifyHuman: (action) => ipcRenderer.invoke("decave:turnstile:verify", action),
  getSystemSettings: () => ipcRenderer.invoke("decave:desktop:get-settings"),
  setSystemSettings: (settings) => ipcRenderer.invoke("decave:desktop:set-settings", settings),
  setKeybinds: (settings) => ipcRenderer.invoke("decave:desktop:set-keybinds", settings),
  setStreamerMode: (enabled) => ipcRenderer.invoke("decave:desktop:set-streamer-mode", enabled),
  getCaptureApps: () => ipcRenderer.invoke("decave:desktop:capture-apps"),
  setVoiceOverlayState: (state) => ipcRenderer.invoke("decave:desktop:set-voice-overlay-state", state),
  getUpdateStatus: () => ipcRenderer.invoke("decave:update:get-status"),
  checkForUpdates: () => ipcRenderer.invoke("decave:update:check"),
  restartToUpdate: () => ipcRenderer.invoke("decave:update:restart"),
  // DM encryption key at rest, wrapped with the OS keychain (null when unavailable).
  e2eeKeys: {
    protect: (seedBase64) => ipcRenderer.invoke("decave:e2ee:protect-key", seedBase64),
    unprotect: (protectedBase64) => ipcRenderer.invoke("decave:e2ee:unprotect-key", protectedBase64),
  },
  browser: {
    create: (input) => ipcRenderer.invoke("decave:browser:create", input),
    deactivate: (id) => ipcRenderer.invoke("decave:browser:deactivate", id),
    setBounds: (input) => ipcRenderer.invoke("decave:browser:set-bounds", input),
    navigate: (input) => ipcRenderer.invoke("decave:browser:navigate", input),
    back: (id) => ipcRenderer.invoke("decave:browser:back", id),
    forward: (id) => ipcRenderer.invoke("decave:browser:forward", id),
    reload: (id) => ipcRenderer.invoke("decave:browser:reload", id),
    zoom: (input) => ipcRenderer.invoke("decave:browser:zoom", input),
    find: (input) => ipcRenderer.invoke("decave:browser:find", input),
    stopFind: (id) => ipcRenderer.invoke("decave:browser:stop-find", id),
    getState: () => ipcRenderer.invoke("decave:browser:get-state"),
    destroy: (id) => ipcRenderer.invoke("decave:browser:destroy", id),
    clearSession: () => ipcRenderer.invoke("decave:browser:clear-session"),
    onState: (callback) => {
      if (typeof callback !== "function") return () => {};
      const listener = (_event, state) => callback(state);
      ipcRenderer.on("decave:browser:state", listener);
      return () => ipcRenderer.removeListener("decave:browser:state", listener);
    },
    onPermissionBlocked: (callback) => {
      if (typeof callback !== "function") return () => {};
      const listener = (_event, details) => callback(details);
      ipcRenderer.on("decave:browser:permission-blocked", listener);
      return () => ipcRenderer.removeListener("decave:browser:permission-blocked", listener);
    },
    onPermissionRequest: (callback) => {
      if (typeof callback !== "function") return () => {};
      const listener = (_event, details) => callback(details);
      ipcRenderer.on("decave:browser:permission-request", listener);
      return () => ipcRenderer.removeListener("decave:browser:permission-request", listener);
    },
    respondPermission: (input) => ipcRenderer.invoke("decave:browser:respond-permission", input),
    onDownloadBlocked: (callback) => {
      if (typeof callback !== "function") return () => {};
      const listener = (_event, details) => callback(details);
      ipcRenderer.on("decave:browser:download-blocked", listener);
      return () => ipcRenderer.removeListener("decave:browser:download-blocked", listener);
    },
  },
  onUpdateStatus: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("decave:update:status", listener);
    return () => ipcRenderer.removeListener("decave:update:status", listener);
  },
};

try {
  contextBridge.exposeInMainWorld("decaveDesktop", bridge);
} catch (error) {
  console.warn("DeCave contextBridge exposure failed; DOM bridge remains available:", error);
}

function markDesktopBridge() {
  try {
    document.documentElement?.setAttribute(MARKER, "1");
  } catch {
    // The document can be between navigations.
  }
}

async function handleRequest(event) {
  const detail = event?.detail;
  if (typeof detail !== "string") return;

  let request;
  try {
    request = JSON.parse(detail);
  } catch {
    return;
  }

  const id = typeof request?.id === "string" ? request.id : "";
  const action = typeof request?.action === "string" ? request.action : "";
  if (
    !id ||
    ![
      "scanActivity",
      "openExternal",
      "verifyHuman",
      "getSystemSettings",
      "setSystemSettings",
      "setKeybinds",
      "setStreamerMode",
      "getCaptureApps",
      "setVoiceOverlayState",
      "getUpdateStatus",
      "checkForUpdates",
      "restartToUpdate",
      "clearBrowserSession",
    ].includes(action)
  ) {
    return;
  }

  try {
    let result;
    if (action === "scanActivity") {
      result = await ipcRenderer.invoke("decave:activity:scan");
    } else if (action === "openExternal") {
      const url = request?.payload && typeof request.payload.url === "string" ? request.payload.url : "";
      result = await ipcRenderer.invoke("decave:open-external", url);
    } else if (action === "verifyHuman") {
      const verificationAction =
        request?.payload && typeof request.payload.action === "string" ? request.payload.action : "";
      result = await ipcRenderer.invoke("decave:turnstile:verify", verificationAction);
    } else if (action === "getSystemSettings") {
      result = await ipcRenderer.invoke("decave:desktop:get-settings");
    } else if (action === "setSystemSettings") {
      result = await ipcRenderer.invoke("decave:desktop:set-settings", request?.payload?.settings);
    } else if (action === "setKeybinds") {
      result = await ipcRenderer.invoke("decave:desktop:set-keybinds", request?.payload?.settings);
    } else if (action === "setStreamerMode") {
      result = await ipcRenderer.invoke("decave:desktop:set-streamer-mode", request?.payload?.enabled);
    } else if (action === "getCaptureApps") {
      result = await ipcRenderer.invoke("decave:desktop:capture-apps");
    } else if (action === "setVoiceOverlayState") {
      result = await ipcRenderer.invoke("decave:desktop:set-voice-overlay-state", request?.payload?.state);
    } else if (action === "getUpdateStatus") {
      result = await ipcRenderer.invoke("decave:update:get-status");
    } else if (action === "checkForUpdates") {
      result = await ipcRenderer.invoke("decave:update:check");
    } else if (action === "clearBrowserSession") {
      result = await ipcRenderer.invoke("decave:browser:clear-session");
    } else {
      result = await ipcRenderer.invoke("decave:update:restart");
    }

    document.dispatchEvent(
      new CustomEvent(RESPONSE_EVENT, {
        detail: JSON.stringify({ id, ok: true, result }),
      }),
    );
  } catch (error) {
    document.dispatchEvent(
      new CustomEvent(RESPONSE_EVENT, {
        detail: JSON.stringify({
          id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      }),
    );
  }
}

markDesktopBridge();
document.addEventListener(REQUEST_EVENT, handleRequest);

window.addEventListener("DOMContentLoaded", markDesktopBridge, { once: true });
window.addEventListener("pageshow", markDesktopBridge);

console.log("DeCave desktop Activity bridge v2 loaded.");
