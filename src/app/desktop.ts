// Bridge to the Electron desktop shell (window.decaveDesktop) and desktop window scaling.

import type {
  DesktopActivityScanResult,
  DesktopSystemSettings,
  DesktopUpdateState,
  DesktopKeybindSettings,
} from "./types";

declare global {
  interface Window {
    decaveDesktop?: {
      isDesktop: true;
      scanActivity: () => Promise<DesktopActivityScanResult>;
      openExternal: (url: string) => Promise<boolean>;
      verifyHuman: (action: string) => Promise<string>;
      getSystemSettings: () => Promise<DesktopSystemSettings & { keybinds: DesktopKeybindSettings }>;
      setSystemSettings: (settings: DesktopSystemSettings) => Promise<DesktopSystemSettings>;
      setKeybinds: (settings: DesktopKeybindSettings) => Promise<DesktopKeybindSettings>;
      setStreamerMode: (enabled: boolean) => Promise<boolean>;
      /** Desktop builds after 0.1.117: streaming/recording apps running now. */
      getCaptureApps?: () => Promise<{ supported: boolean; apps: string[] }>;
      setVoiceOverlayState: (state: {
        enabled: boolean;
        connected: boolean;
        roomName?: string;
        participants: Array<{
          connectionId: string;
          username: string;
          avatarUrl?: string | null;
          speaking: boolean;
          muted: boolean;
          deafened: boolean;
        }>;
      }) => Promise<boolean>;
      getUpdateStatus: () => Promise<DesktopUpdateState>;
      checkForUpdates: () => Promise<DesktopUpdateState>;
      restartToUpdate: () => Promise<boolean>;
      onUpdateStatus: (callback: (state: DesktopUpdateState) => void) => () => void;
      browser: {
        create: (input: { url: string; tabKey: string }) => Promise<{
          id: string;
          url: string;
          title: string;
          canGoBack: boolean;
          canGoForward: boolean;
          zoomFactor: number;
          isFullscreen: boolean;
          findResult: { activeMatchOrdinal: number; matches: number; finalUpdate: boolean } | null;
          bounds: { x: number; y: number; width: number; height: number } | null;
        }>;
        deactivate: (id: string) => Promise<boolean>;
        setBounds: (input: { id: string; x: number; y: number; width: number; height: number }) => Promise<boolean>;
        navigate: (input: { id: string; url: string }) => Promise<boolean>;
        back: (id: string) => Promise<boolean>;
        forward: (id: string) => Promise<boolean>;
        reload: (id: string) => Promise<boolean>;
        zoom: (input: { id: string; delta: number }) => Promise<number>;
        find: (input: { id: string; text: string; forward?: boolean }) => Promise<boolean>;
        stopFind: (id: string) => Promise<boolean>;
        getState: () => Promise<{
          id: string | null;
          url: string;
          title: string;
          canGoBack: boolean;
          canGoForward: boolean;
          zoomFactor: number;
          isFullscreen: boolean;
          findResult: { activeMatchOrdinal: number; matches: number; finalUpdate: boolean } | null;
          bounds: { x: number; y: number; width: number; height: number } | null;
        }>;
        destroy: (id: string) => Promise<boolean>;
        /** Desktop builds after 0.1.128: wipe the in-app browser profile on logout. */
        clearSession?: () => Promise<boolean>;
        onState: (
          callback: (state: {
            id: string | null;
            url: string;
            title: string;
            canGoBack: boolean;
            canGoForward: boolean;
            zoomFactor: number;
            isFullscreen: boolean;
            findResult: { activeMatchOrdinal: number; matches: number; finalUpdate: boolean } | null;
            bounds: { x: number; y: number; width: number; height: number } | null;
            error?: string;
          }) => void,
        ) => () => void;
        onPermissionBlocked: (
          callback: (details: { id: string; permission: string; origin: string }) => void,
        ) => () => void;
        onPermissionRequest: (
          callback: (details: {
            id: string;
            requestId: string;
            permission: string;
            mediaType: string;
            origin: string;
          }) => void,
        ) => () => void;
        respondPermission: (input: { requestId: string; allow: boolean; scope?: "once" | "site" }) => Promise<boolean>;
        onDownloadBlocked: (callback: (details: { id: string; filename: string }) => void) => () => void;
      };
    };
  }
}

const DESKTOP_BRIDGE_REQUEST_EVENT = "decave-desktop-request";
const DESKTOP_BRIDGE_RESPONSE_EVENT = "decave-desktop-response";
const DESKTOP_BRIDGE_MARKER = "data-decave-desktop";

export function hasDesktopActivityBridge(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (window.decaveDesktop?.isDesktop) return true;
  return document.documentElement?.getAttribute(DESKTOP_BRIDGE_MARKER) === "1";
}

function invokeDesktopEventBridge<T>(
  action:
    | "scanActivity"
    | "openExternal"
    | "verifyHuman"
    | "getSystemSettings"
    | "setSystemSettings"
    | "setKeybinds"
    | "setStreamerMode"
    | "setVoiceOverlayState"
    | "getUpdateStatus"
    | "checkForUpdates"
    | "restartToUpdate"
    | "clearBrowserSession",
  payload?: Record<string, unknown>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("DeCave desktop bridge is unavailable."));
      return;
    }

    const requestId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `decave-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    let settled = false;
    const cleanup = () => {
      document.removeEventListener(DESKTOP_BRIDGE_RESPONSE_EVENT, onResponse as EventListener);
      window.clearTimeout(timeoutId);
    };

    const onResponse = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (typeof detail !== "string") return;

      let message: {
        id?: string;
        ok?: boolean;
        result?: unknown;
        error?: string;
      };
      try {
        message = JSON.parse(detail) as typeof message;
      } catch {
        return;
      }

      if (message.id !== requestId) return;
      settled = true;
      cleanup();

      if (message.ok) resolve(message.result as T);
      else reject(new Error(message.error || "Desktop bridge request failed."));
    };

    document.addEventListener(DESKTOP_BRIDGE_RESPONSE_EVENT, onResponse as EventListener);

    const timeoutId = window.setTimeout(
      () => {
        if (settled) return;
        cleanup();
        reject(new Error("DeCave desktop bridge timed out."));
      },
      action === "verifyHuman" ? 125_000 : 8_000,
    );

    document.dispatchEvent(
      new CustomEvent<string>(DESKTOP_BRIDGE_REQUEST_EVENT, {
        detail: JSON.stringify({ id: requestId, action, payload: payload ?? {} }),
      }),
    );
  });
}

export async function scanDesktopActivityBridge(): Promise<DesktopActivityScanResult> {
  if (window.decaveDesktop?.isDesktop) {
    return window.decaveDesktop.scanActivity();
  }
  return invokeDesktopEventBridge<DesktopActivityScanResult>("scanActivity");
}

export async function openDesktopExternalUrl(url: string): Promise<boolean> {
  if (window.decaveDesktop?.isDesktop) {
    return window.decaveDesktop.openExternal(url);
  }
  return invokeDesktopEventBridge<boolean>("openExternal", { url });
}

export async function verifyDesktopHuman(action: string): Promise<string> {
  if (window.decaveDesktop?.isDesktop) {
    return window.decaveDesktop.verifyHuman(action);
  }
  return invokeDesktopEventBridge<string>("verifyHuman", { action });
}

export async function getDesktopSystemSettings(): Promise<
  DesktopSystemSettings & { keybinds: DesktopKeybindSettings }
> {
  if (window.decaveDesktop?.isDesktop && typeof window.decaveDesktop.getSystemSettings === "function")
    return window.decaveDesktop.getSystemSettings();
  return invokeDesktopEventBridge<DesktopSystemSettings & { keybinds: DesktopKeybindSettings }>("getSystemSettings");
}

export async function setDesktopSystemSettings(settings: DesktopSystemSettings): Promise<DesktopSystemSettings> {
  if (window.decaveDesktop?.isDesktop && typeof window.decaveDesktop.setSystemSettings === "function")
    return window.decaveDesktop.setSystemSettings(settings);
  return invokeDesktopEventBridge<DesktopSystemSettings>("setSystemSettings", { settings });
}

export async function setDesktopKeybinds(settings: DesktopKeybindSettings): Promise<DesktopKeybindSettings> {
  if (window.decaveDesktop?.isDesktop && typeof window.decaveDesktop.setKeybinds === "function")
    return window.decaveDesktop.setKeybinds(settings);
  return invokeDesktopEventBridge<DesktopKeybindSettings>("setKeybinds", { settings });
}

export async function setDesktopStreamerMode(enabled: boolean): Promise<boolean> {
  if (window.decaveDesktop?.isDesktop && typeof window.decaveDesktop.setStreamerMode === "function")
    return window.decaveDesktop.setStreamerMode(enabled);
  return invokeDesktopEventBridge<boolean>("setStreamerMode", { enabled });
}

export async function setDesktopVoiceOverlayState(state: {
  enabled: boolean;
  connected: boolean;
  roomName?: string;
  participants: Array<{
    connectionId: string;
    username: string;
    avatarUrl?: string | null;
    speaking: boolean;
    muted: boolean;
    deafened: boolean;
  }>;
}): Promise<boolean> {
  if (window.decaveDesktop?.isDesktop && typeof window.decaveDesktop.setVoiceOverlayState === "function")
    return window.decaveDesktop.setVoiceOverlayState(state);
  return invokeDesktopEventBridge<boolean>("setVoiceOverlayState", { state });
}

export async function getDesktopUpdateStatus(): Promise<DesktopUpdateState> {
  if (window.decaveDesktop?.isDesktop && typeof window.decaveDesktop.getUpdateStatus === "function")
    return window.decaveDesktop.getUpdateStatus();
  return invokeDesktopEventBridge<DesktopUpdateState>("getUpdateStatus");
}

export async function checkDesktopForUpdates(): Promise<DesktopUpdateState> {
  if (window.decaveDesktop?.isDesktop && typeof window.decaveDesktop.checkForUpdates === "function")
    return window.decaveDesktop.checkForUpdates();
  return invokeDesktopEventBridge<DesktopUpdateState>("checkForUpdates");
}

export async function restartDesktopToUpdate(): Promise<boolean> {
  if (window.decaveDesktop?.isDesktop && typeof window.decaveDesktop.restartToUpdate === "function")
    return window.decaveDesktop.restartToUpdate();
  return invokeDesktopEventBridge<boolean>("restartToUpdate");
}

/** Clears the desktop in-app browser profile; resolves false on web or older desktop builds. */
export async function clearDesktopBrowserSession(): Promise<boolean> {
  if (!hasDesktopActivityBridge()) return false;
  if (window.decaveDesktop?.isDesktop) {
    if (typeof window.decaveDesktop.browser?.clearSession !== "function") return false;
    return window.decaveDesktop.browser.clearSession();
  }
  return invokeDesktopEventBridge<boolean>("clearBrowserSession");
}

// The desktop layout is designed for a 1440x900 window. Smaller windows (laptop
// screens, or a window the user shrinks) scale the whole interface down to fit
// instead of cropping it; the Accessibility size setting applies on top.
const DESKTOP_DESIGN_WIDTH = 1440;
const DESKTOP_DESIGN_HEIGHT = 900;
const DESKTOP_MIN_FIT_SCALE = 0.7;

export function desktopFitScale(): number {
  if (!window.decaveDesktop?.isDesktop) return 1;
  const fit = Math.min(window.innerWidth / DESKTOP_DESIGN_WIDTH, window.innerHeight / DESKTOP_DESIGN_HEIGHT);
  return Math.max(DESKTOP_MIN_FIT_SCALE, Math.min(1, Math.floor(fit * 100) / 100));
}

export const requestDesktopNotifications = async () => {
  if (typeof Notification === "undefined") return;
  try {
    await Notification.requestPermission();
  } catch {}
};
