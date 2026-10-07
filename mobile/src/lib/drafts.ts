import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import * as SecureStore from "expo-secure-store";

/** Unsent composer text is isolated by account and never restored from legacy global storage. */
const LEGACY_KEY = "decave.drafts";
const MAX_DRAFTS = 50;
const MAX_LENGTH = 2000;

let accountId: string | null = null;
let accountVersion = 0;
let drafts: Record<string, string> = {};
let editedDraftKeys = new Set<string>();
let listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const storageQueues = new Map<string, Promise<unknown>>();

void SecureStore.deleteItemAsync(LEGACY_KEY).catch(() => undefined);

function accountKey(id: string | null): string | null {
  if (!id) return null;
  const encodedId = Array.from(id, (character) => character.codePointAt(0)!.toString(16)).join(".");
  return `decave.drafts.v2.${encodedId}`;
}

function queueStorageOperation<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = storageQueues.get(key) ?? Promise.resolve();
  const next = previous.then(operation, operation);
  storageQueues.set(key, next.then(() => undefined, () => undefined));
  return next;
}

function notify() {
  listeners.forEach((listener) => listener());
}

/** Switches the in-memory store before auth state changes; late reads/writes are generation-guarded. */
export function setDraftAccount(nextAccountId: string | null): void {
  if (accountId === nextAccountId) return;
  const previousKey = accountKey(accountId);
  accountId = nextAccountId;
  accountVersion += 1;
  const version = accountVersion;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  drafts = {};
  editedDraftKeys = new Set();
  notify();
  if (previousKey) void queueStorageOperation(previousKey, () => SecureStore.deleteItemAsync(previousKey)).catch(() => undefined);
  const key = accountKey(nextAccountId);
  if (!key) return;
  void queueStorageOperation(key, () => SecureStore.getItemAsync(key))
    .then((raw) => {
      if (!raw || version !== accountVersion || accountId !== nextAccountId) return;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      const hydratedDrafts = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>)
          .filter(([, value]) => typeof value === "string")
          .slice(-MAX_DRAFTS)
          .map(([draftKey, value]) => [draftKey, (value as string).slice(0, MAX_LENGTH)]),
      );
      for (const editedKey of editedDraftKeys) {
        if (Object.prototype.hasOwnProperty.call(drafts, editedKey)) hydratedDrafts[editedKey] = drafts[editedKey];
        else delete hydratedDrafts[editedKey];
      }
      drafts = hydratedDrafts;
      notify();
    })
    .catch(() => undefined);
}

export function getDraft(key: string): string {
  return drafts[key] ?? "";
}

export function setDraft(key: string, text: string): void {
  const value = text.slice(0, MAX_LENGTH);
  if ((drafts[key] ?? "") === value) return;
  editedDraftKeys.add(key);
  const next = { ...drafts };
  if (value.trim()) next[key] = value;
  else delete next[key];
  const keys = Object.keys(next);
  if (keys.length > MAX_DRAFTS) delete next[keys[0]];
  drafts = next;
  notify();
  const storageKey = accountKey(accountId);
  if (!storageKey) return;
  const version = accountVersion;
  const snapshot = JSON.stringify(drafts);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (version !== accountVersion || storageKey !== accountKey(accountId)) return;
    void queueStorageOperation(storageKey, () => SecureStore.setItemAsync(storageKey, snapshot)).catch(() => undefined);
  }, 600);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** All drafts, for "Draft" tags in room and DM lists. */
export function useDrafts(): Record<string, string> {
  return useSyncExternalStore(subscribe, () => drafts);
}

/** Composer state backed by the draft store. */
export function useDraftInput(
  key: string,
  paused = false,
): [string, (text: string, save?: boolean) => void, () => void] {
  const draftsSnapshot = useSyncExternalStore(subscribe, () => drafts);
  const [input, setInputState] = useState(() => draftsSnapshot[key] ?? "");
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    setInputState(draftsSnapshot[key] ?? "");
  }, [key, draftsSnapshot[key]]);

  const setInput = useCallback(
    (text: string, save = true) => {
      setInputState(text);
      if (save && !pausedRef.current) setDraft(key, text);
    },
    [key],
  );
  const restoreDraft = useCallback(() => setInputState(getDraft(key)), [key]);
  return [input, setInput, restoreDraft];
}
