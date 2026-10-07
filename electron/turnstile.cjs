// Cloudflare Turnstile for the desktop app: the isolated challenge window,
// revealing it when the check needs the user, and settling the pending request.

const { normalizeTurnstileAction, isTrustedTurnstileUrl, APP_URL } = require("./security-boundary.cjs");
const { session, BrowserWindow, ipcMain } = require("electron");
const { resolveAppIconPath } = require("./app-icon.cjs");
const path = require("node:path");

const TURNSTILE_RESULT_CHANNEL = "decave:turnstile:result";

const TURNSTILE_SESSION_PARTITION = "decave-turnstile-v1";

const TURNSTILE_BACKGROUND_GRACE_MS = 8_000;

let turnstileWindow = null;

let pendingTurnstile = null;

let turnstileRevealTimer = null;

let turnstileWindowReady = false;

let turnstileRevealRequested = false;

function settleTurnstile(token, error) {
  const pending = pendingTurnstile;
  pendingTurnstile = null;

  if (turnstileRevealTimer) {
    clearTimeout(turnstileRevealTimer);
    turnstileRevealTimer = null;
  }
  turnstileWindowReady = false;
  turnstileRevealRequested = false;

  if (pending?.timeout) clearTimeout(pending.timeout);
  if (pending) {
    if (error) pending.reject(error);
    else pending.resolve(token);
  }

  const challengeWindow = turnstileWindow;
  turnstileWindow = null;
  if (challengeWindow && !challengeWindow.isDestroyed()) challengeWindow.close();
}

function revealTurnstileChallenge() {
  if (turnstileRevealTimer) {
    clearTimeout(turnstileRevealTimer);
    turnstileRevealTimer = null;
  }
  turnstileRevealRequested = true;
  const challengeWindow = turnstileWindow;
  if (!challengeWindow || challengeWindow.isDestroyed() || !turnstileWindowReady) return;
  if (challengeWindow.isMinimized()) challengeWindow.restore();
  challengeWindow.show();
  challengeWindow.focus();
}

ipcMain.on(TURNSTILE_RESULT_CHANNEL, (event, rawMessage) => {
  if (
    !pendingTurnstile ||
    !turnstileWindow ||
    turnstileWindow.isDestroyed() ||
    event.sender !== turnstileWindow.webContents ||
    typeof rawMessage !== "string" ||
    rawMessage.length > 4096
  ) {
    return;
  }

  let message;
  try {
    message = JSON.parse(rawMessage);
  } catch {
    return;
  }

  if (message?.type === "turnstile-success") {
    const token = typeof message.token === "string" ? message.token : "";
    if (!token || token.length > 2048 || /[\u0000-\u001f\u007f]/.test(token)) {
      settleTurnstile("", new Error("Security verification returned an invalid token."));
      return;
    }
    settleTurnstile(token);
    return;
  }

  if (message?.type === "turnstile-error" || message?.type === "turnstile-expired") {
    // Keep the same pending verification alive and expose the challenge only
    // when the managed background path cannot finish on its own.
    revealTurnstileChallenge();
  }
});

async function showTurnstileChallenge(parentWindow, requestedAction) {
  const action = normalizeTurnstileAction(requestedAction);
  if (!action) throw new Error("Unsupported security-verification action.");

  if (pendingTurnstile) {
    settleTurnstile("", new Error("Security verification was replaced by a new request."));
  }

  const isolatedSession = session.fromPartition(TURNSTILE_SESSION_PARTITION);
  await isolatedSession.clearStorageData();
  isolatedSession.setPermissionCheckHandler(() => false);
  isolatedSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  const challengeWindow = new BrowserWindow({
    parent: parentWindow ?? undefined,
    // Keep the background attempt from blocking the login window. Once
    // revealed, the challenge receives focus like a normal owned window.
    modal: false,
    width: 470,
    height: 620,
    minWidth: 390,
    minHeight: 500,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#070b16",
    title: "DeCave security verification",
    icon: resolveAppIconPath(),
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "turnstile-preload.cjs"),
      session: isolatedSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: false,
      navigateOnDragDrop: false,
    },
  });
  turnstileWindow = challengeWindow;
  turnstileWindowReady = false;
  turnstileRevealRequested = false;

  challengeWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const guardChallengeNavigation = (event, url) => {
    if (!isTrustedTurnstileUrl(url)) event.preventDefault();
  };
  challengeWindow.webContents.on("will-navigate", guardChallengeNavigation);
  challengeWindow.webContents.on("will-redirect", guardChallengeNavigation);
  challengeWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());

  challengeWindow.once("ready-to-show", () => {
    turnstileWindowReady = true;
    if (turnstileRevealRequested) revealTurnstileChallenge();
  });
  challengeWindow.on("closed", () => {
    if (turnstileWindow === challengeWindow) turnstileWindow = null;
    if (turnstileRevealTimer) {
      clearTimeout(turnstileRevealTimer);
      turnstileRevealTimer = null;
    }
    turnstileWindowReady = false;
    turnstileRevealRequested = false;
    if (pendingTurnstile) {
      const pending = pendingTurnstile;
      pendingTurnstile = null;
      clearTimeout(pending.timeout);
      pending.resolve("");
    }
  });

  const result = new Promise((resolve, reject) => {
    pendingTurnstile = {
      resolve,
      reject,
      timeout: setTimeout(() => {
        settleTurnstile("", new Error("Security verification timed out."));
      }, 120_000),
    };
  });
  turnstileRevealTimer = setTimeout(() => revealTurnstileChallenge(), TURNSTILE_BACKGROUND_GRACE_MS);

  try {
    await challengeWindow.loadURL(`${APP_URL}/mobile/turnstile?action=${encodeURIComponent(action)}`);
  } catch {
    settleTurnstile("", new Error("Security verification could not be loaded."));
  }

  return result;
}

module.exports = { showTurnstileChallenge };
