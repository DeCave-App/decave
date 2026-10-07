import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { apiFetch } from "@/src/lib/api";
import { enqueuePushAction, processPendingPushActions, type PendingPushAction } from "@/src/lib/push-revocation-queue";

const PENDING_SESSION_ACTIONS_KEY = "decave.push.pending-session-actions.v1";
type PendingSessionAction = PendingPushAction;

let registeredToken: string | null = null;
let sessionGeneration = 0;
let serialized: Promise<void> = Promise.resolve();
let storageSerialized: Promise<void> = Promise.resolve();

function projectId(): string | undefined {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = serialized.then(operation, operation);
  serialized = result.then(() => undefined, () => undefined);
  return result;
}

function serializeStorage<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageSerialized.then(operation, operation);
  storageSerialized = result.then(() => undefined, () => undefined);
  return result;
}

function actionKey(action: PendingSessionAction): string {
  return action.kind === "logout"
    ? `logout:${action.sessionToken}`
    : `unlink:${action.sessionToken}:${action.pushToken}`;
}

async function boundedRequest<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try { return await operation(controller.signal); }
  finally { clearTimeout(timer); }
}

async function readPending(): Promise<PendingSessionAction[] | null> {
  try {
    const raw = await SecureStore.getItemAsync(PENDING_SESSION_ACTIONS_KEY);
    const value: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is PendingSessionAction =>
      !!item && typeof item === "object" &&
      typeof (item as PendingSessionAction).sessionToken === "string" &&
      ((item as PendingSessionAction).kind === "logout" ||
        ((item as PendingSessionAction).kind === "unlink" &&
          typeof (item as { pushToken?: unknown }).pushToken === "string")),
    );
  } catch {
    return null;
  }
}

async function writePending(actions: PendingSessionAction[]): Promise<boolean> {
  try {
    if (actions.length) await SecureStore.setItemAsync(PENDING_SESSION_ACTIONS_KEY, JSON.stringify(actions));
    else await SecureStore.deleteItemAsync(PENDING_SESSION_ACTIONS_KEY);
    return true;
  } catch {
    return false;
  }
}

async function drainPendingUnlocked(): Promise<boolean> {
  const pending = await serializeStorage(readPending);
  if (!pending) return false;
  const processed = await processPendingPushActions(pending, (action) => boundedRequest((signal) => action.kind === "logout"
        ? apiFetch("/api/auth/logout", { method: "POST", signal }, action.sessionToken)
        : apiFetch(
            "/api/push-tokens",
            { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: action.pushToken }), signal },
            action.sessionToken,
          )));
  const acknowledged = new Set(processed.acknowledged.map(actionKey));
  const remaining = await serializeStorage(async () => {
    const latest = await readPending();
    if (!latest) return null;
    const next = latest.filter((action) => !acknowledged.has(actionKey(action)));
    return await writePending(next) ? next : null;
  });
  return remaining !== null && remaining.length === 0;
}

async function queueAction(action: PendingSessionAction): Promise<boolean> {
  return serializeStorage(async () => {
    const pending = await readPending();
    if (!pending) return false;
    const next = enqueuePushAction(pending, action);
    if (next.length === pending.length && next.every((item, index) => item === pending[index])) return true;
    return writePending(next);
  });
}

/** Stops in-flight registrations from reviving the session being cleared. */
export function clearPushMemory(): void {
  sessionGeneration += 1;
  registeredToken = null;
}

/** Durably retain the old session before local auth storage is cleared. */
export async function queuePushSessionRevocation(sessionToken: string): Promise<boolean> {
  clearPushMemory();
  return queueAction({ kind: "logout", sessionToken });
}

/** Drain revocations/unlinks; bounded network requests keep logout responsive. */
export async function drainPendingPushActions(): Promise<boolean> {
  return serialize(drainPendingUnlocked);
}

export async function revokePushSession(sessionToken: string): Promise<boolean> {
  const queued = await queuePushSessionRevocation(sessionToken);
  if (queued) return drainPendingPushActions();
  try {
    // Storage can fail on a damaged/locked device. Still attempt server revocation;
    // retain the saved credential until the server confirms logout if offline.
    const response = await boundedRequest((signal) => apiFetch("/api/auth/logout", { method: "POST", signal }, sessionToken));
    return response.ok || response.status === 401;
  } catch {
    return false;
  }
}

/**
 * Registers this device's Expo push token. Old account logout/unlink actions
 * are retried first, so a new account cannot inherit the previous binding.
 */
export async function registerForPush(sessionToken: string): Promise<void> {
  const generation = sessionGeneration;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted" || generation !== sessionGeneration) return;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId: projectId() });
    if (!data || generation !== sessionGeneration) return;
    await serialize(async () => {
      if (generation !== sessionGeneration || !(await drainPendingUnlocked())) return;
      const response = await boundedRequest((signal) => apiFetch(
        "/api/push-tokens",
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: data, platform: Platform.OS }), signal },
        sessionToken,
      ));
      if (response.ok && generation === sessionGeneration) registeredToken = data;
    });
  } catch (error) {
    // Simulators and builds without push entitlements cannot get a token.
    console.warn("[push] registration skipped", error);
  }
}

/** Unlinks the active binding and persists a retry under its original session on failure. */
export async function unregisterPush(sessionToken: string): Promise<void> {
  const token = registeredToken;
  sessionGeneration += 1;
  registeredToken = null;
  await serialize(async () => {
    let pushToken = token;
    if (!pushToken) {
      try {
        const permission = await Notifications.getPermissionsAsync();
        if (permission.status === "granted") {
          pushToken = (await Notifications.getExpoPushTokenAsync({ projectId: projectId() })).data;
        }
      } catch { return; }
    }
    if (!pushToken) return;
    const queued = await queueAction({ kind: "unlink", sessionToken, pushToken });
    if (queued) await drainPendingUnlocked();
    else {
      try {
        await boundedRequest((signal) => apiFetch(
          "/api/push-tokens",
          { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: pushToken }), signal },
          sessionToken,
        ));
      } catch {}
    }
  });
}
