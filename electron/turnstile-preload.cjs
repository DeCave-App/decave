const { contextBridge, ipcRenderer } = require("electron");

const TURNSTILE_RESULT_CHANNEL = "decave:turnstile:result";

// This preload runs only in the isolated, unprivileged Turnstile window. The
// remote challenge can return its opaque result, but receives no filesystem,
// account-session, activity, key-storage, or cryptographic capability.
contextBridge.exposeInMainWorld("ReactNativeWebView", {
  postMessage(value) {
    if (typeof value !== "string" || value.length > 4096) return;
    ipcRenderer.send(TURNSTILE_RESULT_CHANNEL, value);
  },
});
