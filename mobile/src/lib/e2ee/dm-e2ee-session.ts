// One device's view of DM encryption: whether this device holds the account's
// keyring, the flows that get it there (first-time setup, recovery code, approval
// from another device, reset), keeping it current (rotation, picking up keys
// other devices rotated to, dropping keys the history setting says to forget),
// other accounts' keys, and decrypting and sealing messages, reactions and group
// chat messages. Platform neutral: the web/desktop app and the mobile app each pass
// an adapter for HTTP and local storage and draw their own UI from `getState()`.
// The mobile app keeps an identical copy (checked by scripts/__tests__/dm-e2ee.test.mjs).

import {
  DmCryptoError,
  deriveAccountKeys,
  generateAccountSeed,
  generateLinkKeyPair,
  generateRecoveryCode,
  isConsistentPublicKey,
  keyChain,
  keyringFromBytes,
  keyringToBytes,
  linkComparisonCode,
  openDirectMessage,
  openFromLinkingDevice,
  openGroupMessage,
  openKeyBackup,
  openReactions,
  openSuccessor,
  publicKeyOf,
  reportProofFor,
  resealKeyBackup,
  rotateAccountKey,
  safetyNumber,
  sealDirectMessage,
  sealForLinkedDevice,
  sealGroupMessage,
  sealKeyBackup,
  sealReactions,
  signRtcDescription,
  verifyRtcDescription,
  type DmAccountKeys,
  type RtcDescriptionAuth,
  type DmChainedKey,
  type DmReportProof,
} from "./dm-e2ee.ts";
import {
  DM_GROUP_MAX_WRAPS,
  DM_KEYRING_MAX,
  isDmSignature,
  parseDmEnvelope,
  parseDmKeyBackup,
  parseDmLinkSealed,
  parseDmPublicKey,
  parseDmSealedSuccessor,
  type DmEnvelope,
  type DmKeyBackup,
  type DmPublicKey,
} from "./dm-e2ee-format.ts";

export type DmE2eeResponse = { ok: boolean; status: number; data: Record<string, unknown> };

/**
 * What a pinned peer key looks like in local storage. `keyId` is the root of the
 * peer's key chain: rotations keep it, a reset changes it.
 */
export type DmKeyPin = { keyId: string; changed?: boolean; verified?: boolean };

/** What this device remembers per account, besides the key itself. */
export type DmDeviceState = {
  pins: Record<string, DmKeyPin>;
  /** A recovery code was created but not yet confirmed as saved; a fresh one is shown next start. */
  recoveryCodeUnconfirmed?: boolean;
};

export type DmE2eeAdapter = {
  /** JSON request to the DeCave API with this device's session. */
  request: (path: string, init?: { method?: string; body?: unknown }) => Promise<DmE2eeResponse>;
  /** The account's keyring as bytes: 32-byte seeds, current key first. */
  loadKeyring: (accountId: string) => Promise<Uint8Array | null>;
  saveKeyring: (accountId: string, keyring: Uint8Array) => Promise<void>;
  forgetKeyring: (accountId: string) => Promise<void>;
  loadDeviceState: (accountId: string) => Promise<DmDeviceState>;
  saveDeviceState: (accountId: string, state: DmDeviceState) => Promise<void>;
  client: "web" | "desktop" | "mobile";
  /** How old the current key gets before this device rotates it (default 30 days). */
  rotateAfterMs?: number;
  /** Clock, for tests. */
  now?: () => number;
};

const DAY_MS = 24 * 60 * 60_000;
const DEFAULT_ROTATE_AFTER_MS = 30 * DAY_MS;

/** History settings the apps offer: days that old messages stay readable, null for always. */
export const DM_HISTORY_CHOICES: ReadonlyArray<number | null> = [null, 365, 90, 30];

export type DmE2eeStatus = "off" | "loading" | "locked" | "ready" | "error";

export type DmLinkApproval = {
  id: string;
  deviceLabel: string;
  code: string;
  linkPublicKey: string;
  expiresAt: string;
};

export type DmE2eeState = {
  status: DmE2eeStatus;
  /** False while the server has encryption switched off: show nothing about it, send plaintext. */
  available: boolean;
  accountId: string | null;
  keyId: string | null;
  error: string;
  /** A recovery code that was just created and must be shown once. */
  pendingRecoveryCode: string | null;
  /** This device asking another device for the key. */
  link: { requestId: string; code: string; state: "waiting" | "denied" | "expired" | "failed" } | null;
  /** Other devices asking this one for the key. */
  approvals: DmLinkApproval[];
  /** Peer key pins, by public user id. */
  pins: Record<string, DmKeyPin>;
  /**
   * How many days after a key is replaced this account's devices keep it (and so
   * can read messages sent while it was current). Null keeps keys for good.
   */
  historyDays: number | null;
};

/** How a message reached the screen. */
export type DmE2eeMark = "encrypted" | "plaintext" | "locked" | "failed";

export type DmLike = {
  id: string;
  fromUserId: string;
  toUserId: string;
  text: string;
  envelope?: DmEnvelope | null;
  replyToId?: string | null;
  reactions?: Record<string, string[]>;
  /** Encrypted reactions: one envelope per account that reacted. */
  reactionEnvelopes?: unknown[] | null;
};

export type GroupMessageLike = {
  id: string;
  fromUserId: string;
  text: string;
  envelope?: DmEnvelope | null;
  replyToId?: string | null;
};

/**
 * The reactions an account has after toggling `emoji`: off if it was on, on if it
 * was off. Poll votes (`poll_<index>`) are single choice, so voting replaces an
 * earlier vote.
 */
export function toggledReactions(reactions: Record<string, string[]> | undefined, me: string, emoji: string): string[] {
  const mine = Object.entries(reactions ?? {})
    .filter(([, users]) => users.includes(me))
    .map(([key]) => key);
  if (mine.includes(emoji)) return mine.filter((key) => key !== emoji);
  const kept = emoji.startsWith("poll_") ? mine.filter((key) => !key.startsWith("poll_")) : mine;
  return [...kept, emoji];
}

/**
 * How a peer's session description checked out: signed by their account key
 * ("verified"), not signed by someone who has no key or isn't known to have one
 * ("unverified"), or signed wrongly or missing a signature it should carry
 * ("rejected": don't connect).
 */
export type RtcVerdict = "verified" | "unverified" | "rejected";

export class DmE2eeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DmE2eeUnavailableError";
  }
}

type PublishedKey = DmChainedKey & { createdAt: string | null; retiredAt: string | null };

type PeerKeys = {
  current: DmPublicKey | null;
  /** The first key of the current key's chain; what pins and safety numbers use. */
  root: DmPublicKey | null;
  all: Map<string, PublishedKey>;
  fetchedAt: number;
};

function parsePublishedKey(raw: unknown): PublishedKey | null {
  const key = parseDmPublicKey(raw);
  if (!key || !isConsistentPublicKey(key)) return null;
  const record = raw as Record<string, unknown>;
  const previousKeyId = typeof record.previousKeyId === "string" ? record.previousKeyId : null;
  const certificate = isDmSignature(record.certificate) ? record.certificate : null;
  return {
    ...key,
    previousKeyId,
    certificate,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : null,
    retiredAt: typeof record.retiredAt === "string" ? record.retiredAt : null,
  };
}

// Decrypted results are cached by everything the server says about the message
// as well as the signature, so an envelope shown under another id, sender or
// conversation is checked again (and refused) rather than answered from cache.
function messageCacheKey(id: string, from: string, to: string, signature: string): string {
  return `m\n${id}\n${from}\n${to}\n${signature}`;
}

function reactionCacheKey(messageId: string, from: string, to: string, signature: string): string {
  return `r\n${messageId}\n${from}\n${to}\n${signature}`;
}

function groupCacheKey(groupId: string, id: string, from: string, signature: string): string {
  return `g\n${groupId}\n${id}\n${from}\n${signature}`;
}

function bareKey(key: DmPublicKey): DmPublicKey {
  return { keyId: key.keyId, x25519: key.x25519, ed25519: key.ed25519 };
}

const PEER_KEY_TTL_MS = 5 * 60_000;
const LINK_POLL_MS = 3000;

const INITIAL: DmE2eeState = {
  status: "off",
  available: true,
  accountId: null,
  keyId: null,
  error: "",
  pendingRecoveryCode: null,
  link: null,
  approvals: [],
  pins: {},
  historyDays: null,
};

export class DmE2eeSession {
  private state: DmE2eeState = INITIAL;
  /** The current account key (`keyring[0]`), or null while this device can't read. */
  private keys: DmAccountKeys | null = null;
  private keyring: DmAccountKeys[] = [];
  private backup: DmKeyBackup | null = null;
  private syncing: Promise<void> | null = null;
  private peers = new Map<string, PeerKeys>();
  private peerFetches = new Map<string, Promise<PeerKeys>>();
  private opened = new Map<string, { text: string; mark: DmE2eeMark; replyToId?: string }>();
  /** Decrypted reaction envelopes, by signature. */
  private openedReactions = new Map<string, string[] | null>();
  /** Reply links of encrypted messages (they travel inside the ciphertext), so edits keep them. */
  private replies = new Map<string, string>();
  private listeners = new Set<() => void>();
  private generation = 0;
  private linkSecret: Uint8Array | null = null;
  private linkTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryCodeUnconfirmed = false;

  private readonly adapter: DmE2eeAdapter;

  constructor(adapter: DmE2eeAdapter) {
    this.adapter = adapter;
  }

  getState = (): DmE2eeState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<DmE2eeState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private now(): number {
    return this.adapter.now?.() ?? Date.now();
  }

  // ------------------------------------------------------------ lifecycle

  /** Start for a signed-in account: load or create the key, or report it locked. */
  async start(accountId: string): Promise<void> {
    if (this.state.accountId === accountId && this.state.status !== "off" && this.state.status !== "error") return;
    const generation = ++this.generation;
    this.clearMemory();
    this.set({ ...INITIAL, status: "loading", accountId });
    try {
      const [stored, device, me] = await Promise.all([
        this.adapter.loadKeyring(accountId),
        this.adapter.loadDeviceState(accountId).catch((): DmDeviceState => ({ pins: {} })),
        this.adapter.request("/api/dm-keys/me"),
      ]);
      if (generation !== this.generation) return;
      if (!me.ok) throw new Error(String(me.data.error ?? "Could not load your encryption key."));
      if (me.data.enabled === false) {
        // Switched off on the server: no key is created and nothing is shown.
        this.set({ status: "off", available: false });
        return;
      }
      this.recoveryCodeUnconfirmed = device.recoveryCodeUnconfirmed === true;
      this.set({ pins: device.pins ?? {} });
      let local: DmAccountKeys[] | null = null;
      try {
        local = stored ? keyringFromBytes(stored) : null;
      } catch {
        local = null;
      }

      if (!parseDmPublicKey(me.data.key)) {
        // First device for this account: create the key and its recovery code.
        this.readAccount(me.data);
        await this.createKey(accountId, generation, local);
        return;
      }
      await this.applyAccount(accountId, generation, me.data, local);
      if (generation !== this.generation || this.state.status !== "ready") return;
      void this.refreshApprovals();
      // The last recovery code was never confirmed as saved (the app closed first): show a new one.
      if (this.recoveryCodeUnconfirmed) await this.replaceRecoveryCode().catch(() => undefined);
      await this.maintain(accountId, generation, me.data).catch(() => undefined);
    } catch (error) {
      if (generation !== this.generation) return;
      this.set({ status: "error", error: error instanceof Error ? error.message : "Encryption is unavailable." });
    }
  }

  /** Signed out: drop everything in memory, and with `forget` the keys on this device too. */
  async stop({ forget }: { forget: boolean }): Promise<void> {
    const accountId = this.state.accountId;
    this.generation += 1;
    this.clearMemory();
    this.set(INITIAL);
    if (forget && accountId) await this.adapter.forgetKeyring(accountId).catch(() => undefined);
  }

  private clearMemory() {
    this.keys = null;
    this.keyring = [];
    this.backup = null;
    this.syncing = null;
    this.peers.clear();
    this.peerFetches.clear();
    this.opened.clear();
    this.openedReactions.clear();
    this.replies.clear();
    this.linkSecret = null;
    if (this.linkTimer) clearTimeout(this.linkTimer);
    this.linkTimer = null;
  }

  /** The account's keys as `/api/dm-keys/me` lists them, by id. */
  private ownKeys(data: Record<string, unknown>): Map<string, PublishedKey & { sealedForPrevious: unknown }> {
    const keys = new Map<string, PublishedKey & { sealedForPrevious: unknown }>();
    for (const raw of Array.isArray(data.keys) ? data.keys : []) {
      const key = parsePublishedKey(raw);
      if (key) keys.set(key.keyId, { ...key, sealedForPrevious: (raw as Record<string, unknown>).sealedForPrevious });
    }
    return keys;
  }

  private readAccount(data: Record<string, unknown>) {
    this.backup = parseDmKeyBackup(data.backup);
    const days = data.historyDays;
    this.set({ historyDays: typeof days === "number" && Number.isInteger(days) && days > 0 ? days : null });
  }

  /**
   * Bring this device up to the account's current key: it already has it, or it
   * has an earlier key and picks up the keys the account rotated to since, or it
   * is locked until another device or the recovery code gives it the key.
   */
  private async applyAccount(
    accountId: string,
    generation: number,
    data: Record<string, unknown>,
    local: DmAccountKeys[] | null,
  ) {
    this.readAccount(data);
    const serverKey = parseDmPublicKey(data.key);
    if (!serverKey) return;
    let keyring = local ?? [];
    if (keyring.length && keyring[0].keyId !== serverKey.keyId) {
      keyring = this.catchUp(accountId, keyring, serverKey.keyId, this.ownKeys(data));
      if (keyring[0].keyId === serverKey.keyId) await this.adapter.saveKeyring(accountId, keyringToBytes(keyring));
    }
    if (generation !== this.generation) return;
    if (keyring.length && keyring[0].keyId === serverKey.keyId) {
      const changed = this.keys?.keyId !== keyring[0].keyId || this.keyring.length !== keyring.length;
      this.keyring = keyring;
      this.keys = keyring[0];
      if (changed) this.opened.clear();
      this.set({ status: "ready", keyId: serverKey.keyId, error: "" });
      return;
    }
    // A key from before a reset can't follow the account any more.
    if (keyring.length) await this.adapter.forgetKeyring(accountId);
    this.keys = null;
    this.keyring = [];
    this.set({ status: "locked", keyId: serverKey.keyId });
  }

  /** Follow the account's rotations forward from `keyring[0]`, opening each new key with the one before. */
  private catchUp(
    accountId: string,
    keyring: DmAccountKeys[],
    targetKeyId: string,
    published: Map<string, PublishedKey & { sealedForPrevious: unknown }>,
  ): DmAccountKeys[] {
    let ring = keyring;
    for (let step = 0; step < DM_KEYRING_MAX && ring[0].keyId !== targetKeyId; step += 1) {
      const previous = ring[0];
      const next = [...published.values()].find((key) => key.previousKeyId === previous.keyId);
      const sealed = next ? parseDmSealedSuccessor(next.sealedForPrevious) : null;
      if (!next || !sealed || !next.certificate) break;
      try {
        ring = [openSuccessor(sealed, previous, accountId, bareKey(next), next.certificate), ...ring];
      } catch {
        break;
      }
    }
    return ring.slice(0, DM_KEYRING_MAX);
  }

  /**
   * Keep the keyring healthy once ready: rotate an old current key, drop keys the
   * history setting says to forget, and keep the recovery backup in step.
   */
  private async maintain(
    accountId: string,
    generation: number,
    data: Record<string, unknown>,
    { rotate = true }: { rotate?: boolean } = {},
  ) {
    if (!this.keys) return;
    const published = this.ownKeys(data);
    const createdAt = Date.parse(String(published.get(this.keys.keyId)?.createdAt ?? ""));
    const rotateAfter = this.adapter.rotateAfterMs ?? DEFAULT_ROTATE_AFTER_MS;
    if (rotate && Number.isFinite(createdAt) && this.now() - createdAt > rotateAfter) {
      await this.rotate(accountId, generation);
      return;
    }
    if (generation !== this.generation) return;
    const kept = this.keysToKeep(published);
    if (kept.length !== this.keyring.length) {
      this.keyring = kept;
      await this.adapter.saveKeyring(accountId, keyringToBytes(kept));
      this.opened.clear();
    }
    await this.syncBackup(accountId);
  }

  /** The keyring without keys the history setting says to forget. The current key always stays. */
  private keysToKeep(published: Map<string, PublishedKey>): DmAccountKeys[] {
    const days = this.state.historyDays;
    if (days === null) return this.keyring.slice(0, DM_KEYRING_MAX);
    const cutoff = this.now() - days * DAY_MS;
    return this.keyring.filter((keys, index) => {
      if (index === 0) return true;
      const retiredAt = Date.parse(String(published.get(keys.keyId)?.retiredAt ?? ""));
      return !Number.isFinite(retiredAt) || retiredAt > cutoff;
    });
  }

  /** Update the recovery backup when it doesn't hold exactly this keyring. */
  private async syncBackup(accountId: string) {
    const backup = this.backup;
    if (!backup || !this.keys) return;
    const ids = this.keyring.map((keys) => keys.keyId);
    if (backup.keys.length === ids.length && backup.keys.every((id, index) => id === ids[index])) return;
    const next = resealKeyBackup(backup, this.keyring, accountId);
    const response = await this.adapter.request("/api/dm-keys/me/backup", { method: "PUT", body: { backup: next } });
    if (response.ok) this.backup = next;
  }

  /** Replace the account key; the old one signs and seals the new one. */
  private async rotate(accountId: string, generation: number) {
    const current = this.keys;
    const backup = this.backup;
    if (!current) return;
    const { next, certificate, sealedForPrevious } = rotateAccountKey(current, accountId);
    const keyring = [next, ...this.keyring].slice(0, DM_KEYRING_MAX);
    const response = await this.adapter.request("/api/dm-keys/me/rotate", {
      method: "POST",
      body: {
        key: publicKeyOf(next),
        previousKeyId: current.keyId,
        certificate,
        sealedForPrevious,
        backup: backup ? resealKeyBackup(backup, keyring, accountId) : null,
      },
    });
    if (generation !== this.generation) return;
    if (!response.ok) {
      // Another device rotated first: pick up its key instead.
      if (response.data.code === "DM_KEY_STALE") await this.syncOwnKey();
      return;
    }
    await this.adapter.saveKeyring(accountId, keyringToBytes(keyring));
    this.keyring = keyring;
    this.keys = next;
    this.peers.delete(accountId);
    this.set({ keyId: next.keyId });
    // Let the backup and history rules settle on the new keyring.
    const me = await this.adapter.request("/api/dm-keys/me");
    if (me.ok && generation === this.generation) {
      this.readAccount(me.data);
      // Only just rotated: don't rotate again, whatever the clock says.
      await this.maintain(accountId, generation, me.data, { rotate: false });
    }
  }

  /** The account's key changed somewhere else (rotated or reset): follow it. */
  private syncOwnKey(): Promise<void> {
    const accountId = this.state.accountId;
    if (!accountId) return Promise.resolve();
    if (this.syncing) return this.syncing;
    const generation = this.generation;
    this.syncing = (async () => {
      const me = await this.adapter.request("/api/dm-keys/me");
      if (!me.ok || generation !== this.generation) return;
      const local = this.keyring.length ? this.keyring : null;
      await this.applyAccount(accountId, generation, me.data, local);
      if (this.state.status === "ready") await this.maintain(accountId, generation, me.data);
    })()
      .catch(() => undefined)
      .finally(() => {
        this.syncing = null;
      });
    return this.syncing;
  }

  private async createKey(accountId: string, generation: number, existing: DmAccountKeys[] | null) {
    // Reuse keys this device already has if the server lost track of them.
    const keyring = existing?.length ? existing : [deriveAccountKeys(generateAccountSeed())];
    const keys = keyring[0];
    const code = generateRecoveryCode();
    const backup = sealKeyBackup(keyring, code, accountId);
    const response = await this.adapter.request("/api/dm-keys/me", {
      method: "POST",
      body: { key: publicKeyOf(keys), backup },
    });
    if (generation !== this.generation) return;
    if (!response.ok) {
      // Another device created the key first: this one is locked until it gets that key.
      if (response.data.code === "DM_KEY_EXISTS") {
        this.generation += 1;
        this.set({ status: "off" });
        await this.start(accountId);
        return;
      }
      throw new Error(String(response.data.error ?? "Could not set up encryption."));
    }
    await this.adapter.saveKeyring(accountId, keyringToBytes(keyring));
    this.keyring = keyring;
    this.keys = keys;
    this.backup = backup;
    await this.showRecoveryCode(code);
    this.set({ status: "ready", keyId: keys.keyId });
  }

  private async showRecoveryCode(code: string) {
    this.recoveryCodeUnconfirmed = true;
    await this.saveDevice();
    this.set({ pendingRecoveryCode: code });
  }

  acknowledgeRecoveryCode() {
    this.recoveryCodeUnconfirmed = false;
    void this.saveDevice();
    this.set({ pendingRecoveryCode: null });
  }

  private async saveDevice() {
    const accountId = this.state.accountId;
    if (!accountId) return;
    await this.adapter
      .saveDeviceState(accountId, { pins: this.state.pins, recoveryCodeUnconfirmed: this.recoveryCodeUnconfirmed })
      .catch(() => undefined);
  }

  private async adopt(keyring: DmAccountKeys[]) {
    const accountId = this.state.accountId;
    if (!accountId || !keyring.length) return;
    await this.adapter.saveKeyring(accountId, keyringToBytes(keyring));
    this.keyring = keyring;
    this.keys = keyring[0];
    this.opened.clear();
    this.openedReactions.clear();
    this.set({ status: "ready", keyId: keyring[0].keyId, link: null, error: "" });
    void this.refreshApprovals();
  }

  // ------------------------------------------------------------ unlocking

  async unlockWithRecoveryCode(code: string): Promise<void> {
    const accountId = this.state.accountId;
    if (!accountId) throw new DmE2eeUnavailableError("Sign in first.");
    // Always fetch it fresh: the code may have been replaced from another device.
    const me = await this.adapter.request("/api/dm-keys/me");
    if (!me.ok) throw new DmE2eeUnavailableError(String(me.data.error ?? "Could not load your recovery backup."));
    this.readAccount(me.data);
    if (!this.backup) throw new DmE2eeUnavailableError("There is no recovery backup for this account.");
    if (this.state.keyId && this.backup.keyId !== this.state.keyId) {
      throw new DmE2eeUnavailableError("The recovery backup is out of date. Approve this device from another one.");
    }
    await this.adopt(openKeyBackup(this.backup, code, accountId));
  }

  /** Ask the account's other devices for the key. Resolves when the request is open. */
  async requestLink(): Promise<void> {
    const accountId = this.state.accountId;
    if (!accountId || this.state.status !== "locked") return;
    const pair = generateLinkKeyPair();
    const response = await this.adapter.request("/api/dm-keys/link-requests", {
      method: "POST",
      body: { linkPublicKey: pair.publicKey, client: this.adapter.client },
    });
    const request = response.data.request as { id?: unknown } | undefined;
    if (!response.ok || typeof request?.id !== "string") {
      throw new DmE2eeUnavailableError(String(response.data.error ?? "Could not ask your other devices."));
    }
    this.linkSecret = pair.secret;
    this.set({
      link: {
        requestId: request.id,
        code: linkComparisonCode(accountId, request.id, pair.publicKey),
        state: "waiting",
      },
    });
    this.scheduleLinkPoll(LINK_POLL_MS);
  }

  cancelLink() {
    const link = this.state.link;
    if (this.linkTimer) clearTimeout(this.linkTimer);
    this.linkTimer = null;
    this.linkSecret = null;
    this.set({ link: null });
    if (link?.state === "waiting") {
      void this.adapter.request(`/api/dm-keys/link-requests/${link.requestId}/deny`, { method: "POST", body: {} });
    }
  }

  private scheduleLinkPoll(delay: number) {
    if (this.linkTimer) clearTimeout(this.linkTimer);
    this.linkTimer = setTimeout(() => void this.pollLink(), delay);
  }

  private async pollLink() {
    const link = this.state.link;
    const accountId = this.state.accountId;
    const secret = this.linkSecret;
    if (!link || link.state !== "waiting" || !accountId || !secret) return;
    try {
      const response = await this.adapter.request(`/api/dm-keys/link-requests/${link.requestId}`);
      if (this.state.link?.requestId !== link.requestId) return;
      const status = response.ok ? response.data.status : "expired";
      if (status === "pending") {
        this.scheduleLinkPoll(LINK_POLL_MS);
        return;
      }
      if (status === "approved") {
        const sealed = parseDmLinkSealed(response.data.sealed);
        if (!sealed) throw new Error("bad sealed key");
        const keyring = openFromLinkingDevice(sealed, secret, accountId, link.requestId);
        if (this.state.keyId && keyring[0].keyId !== this.state.keyId) throw new Error("wrong key");
        this.linkSecret = null;
        await this.adopt(keyring);
        return;
      }
      this.set({ link: { ...link, state: status === "denied" ? "denied" : "expired" } });
    } catch {
      if (this.state.link?.requestId === link.requestId) this.set({ link: { ...link, state: "failed" } });
    }
  }

  /** Throw away the account's keys and start again. Everyone sees that the key changed. */
  async resetKey(currentPassword: string): Promise<void> {
    const accountId = this.state.accountId;
    if (!accountId) throw new DmE2eeUnavailableError("Sign in first.");
    const keys = deriveAccountKeys(generateAccountSeed());
    const code = generateRecoveryCode();
    const backup = sealKeyBackup([keys], code, accountId);
    const response = await this.adapter.request("/api/dm-keys/me", {
      method: "POST",
      body: { key: publicKeyOf(keys), backup, reset: true, currentPassword },
    });
    if (!response.ok) throw new DmE2eeUnavailableError(String(response.data.error ?? "Could not reset your key."));
    this.backup = backup;
    this.peers.delete(accountId);
    await this.adopt([keys]);
    await this.showRecoveryCode(code);
  }

  /** Replace the recovery code. The old code stops working. */
  async replaceRecoveryCode(): Promise<void> {
    const accountId = this.state.accountId;
    if (!accountId || !this.keys) throw new DmE2eeUnavailableError("This device can't read encrypted messages yet.");
    const code = generateRecoveryCode();
    const backup = sealKeyBackup(this.keyring, code, accountId);
    const response = await this.adapter.request("/api/dm-keys/me/backup", { method: "PUT", body: { backup } });
    if (!response.ok) throw new DmE2eeUnavailableError(String(response.data.error ?? "Could not save the new code."));
    this.backup = backup;
    await this.showRecoveryCode(code);
  }

  /**
   * How long this account's devices keep replaced keys, in days (null: always).
   * Shorter means a stolen device or recovery code reads less of the past, and
   * older encrypted messages become unreadable on this account's devices.
   */
  async setHistoryDays(days: number | null): Promise<void> {
    const accountId = this.state.accountId;
    if (!accountId || !this.keys) throw new DmE2eeUnavailableError("This device can't read encrypted messages yet.");
    if (!DM_HISTORY_CHOICES.includes(days)) throw new DmE2eeUnavailableError("Choose one of the offered options.");
    const response = await this.adapter.request("/api/dm-keys/me/settings", {
      method: "PUT",
      body: { historyDays: days },
    });
    if (!response.ok) throw new DmE2eeUnavailableError(String(response.data.error ?? "Could not save the setting."));
    const me = await this.adapter.request("/api/dm-keys/me");
    if (!me.ok) return;
    this.readAccount(me.data);
    await this.maintain(accountId, this.generation, me.data);
  }

  // ------------------------------------------------------------ approving other devices

  async refreshApprovals(): Promise<void> {
    const accountId = this.state.accountId;
    if (this.state.status !== "ready" || !accountId) return;
    const response = await this.adapter.request("/api/dm-keys/link-requests");
    if (!response.ok || !Array.isArray(response.data.requests)) return;
    const approvals: DmLinkApproval[] = [];
    for (const raw of response.data.requests as Array<Record<string, unknown>>) {
      if (raw.fromThisDevice === true || typeof raw.id !== "string" || typeof raw.linkPublicKey !== "string") continue;
      approvals.push({
        id: raw.id,
        deviceLabel: typeof raw.deviceLabel === "string" ? raw.deviceLabel : "New device",
        linkPublicKey: raw.linkPublicKey,
        expiresAt: typeof raw.expiresAt === "string" ? raw.expiresAt : "",
        code: linkComparisonCode(accountId, raw.id, raw.linkPublicKey),
      });
    }
    this.set({ approvals });
  }

  async answerApproval(requestId: string, approve: boolean): Promise<void> {
    const accountId = this.state.accountId;
    const approval = this.state.approvals.find((item) => item.id === requestId);
    this.set({ approvals: this.state.approvals.filter((item) => item.id !== requestId) });
    if (!approval || !accountId) return;
    if (!approve || !this.keys) {
      await this.adapter.request(`/api/dm-keys/link-requests/${requestId}/deny`, { method: "POST", body: {} });
      return;
    }
    const sealed = sealForLinkedDevice(this.keyring, approval.linkPublicKey, accountId, requestId);
    const response = await this.adapter.request(`/api/dm-keys/link-requests/${requestId}/approve`, {
      method: "POST",
      body: { sealed },
    });
    if (!response.ok) throw new DmE2eeUnavailableError(String(response.data.error ?? "Could not approve the device."));
  }

  /** Feed realtime events here; returns true when the event was about encryption. */
  handleRealtimeEvent(event: { type?: unknown; userId?: unknown }): boolean {
    if (event.type === "DM_LINK_REQUEST" || event.type === "DM_LINK_RESOLVED") {
      void this.refreshApprovals();
      if (this.state.link?.state === "waiting") this.scheduleLinkPoll(0);
      return true;
    }
    if (event.type === "DM_KEYS_CHANGED") {
      if (typeof event.userId === "string") {
        this.peers.delete(event.userId);
        // This account's key was rotated or reset on another device.
        if (event.userId === this.state.accountId && this.state.status === "ready") void this.syncOwnKey();
      }
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ peer keys

  private async peerKeys(userId: string, refresh = false): Promise<PeerKeys> {
    const cached = this.peers.get(userId);
    if (cached && !refresh && this.now() - cached.fetchedAt < PEER_KEY_TTL_MS) return cached;
    const pending = this.peerFetches.get(userId);
    if (pending && !refresh) return pending;
    const fetching = (async () => {
      const response = await this.adapter.request(`/api/dm-keys/users/${encodeURIComponent(userId)}`);
      if (!response.ok) throw new DmE2eeUnavailableError("Could not load their encryption key.");
      const all = new Map<string, PublishedKey>();
      // A key whose id isn't derived from its material is a forgery; parsePublishedKey drops it.
      for (const raw of Array.isArray(response.data.keys) ? response.data.keys : []) {
        const key = parsePublishedKey(raw);
        if (key) all.set(key.keyId, key);
      }
      const currentRaw = parseDmPublicKey(response.data.current);
      const currentKey = currentRaw ? (all.get(currentRaw.keyId) ?? null) : null;
      const chain = currentKey ? keyChain(userId, currentKey, all) : [];
      const result: PeerKeys = {
        current: currentKey ? bareKey(currentKey) : null,
        root: chain.length ? bareKey(chain[chain.length - 1]) : null,
        all,
        fetchedAt: this.now(),
      };
      this.peers.set(userId, result);
      if (userId !== this.state.accountId) await this.pin(userId, result.root);
      return result;
    })().finally(() => this.peerFetches.delete(userId));
    this.peerFetches.set(userId, fetching);
    return fetching;
  }

  /**
   * Trust a peer's first key; flag later changes until the user has seen them.
   * Pins hold the root of the peer's key chain, so a rotation (signed by the old
   * key) is not a change, while a reset is.
   */
  private async pin(userId: string, root: DmPublicKey | null) {
    const accountId = this.state.accountId;
    if (!root || !accountId) return;
    const existing = this.state.pins[userId];
    if (existing?.keyId === root.keyId) return;
    this.set({ pins: { ...this.state.pins, [userId]: { keyId: root.keyId, changed: Boolean(existing) } } });
    await this.saveDevice();
  }

  async acknowledgeKeyChange(userId: string, verified = false): Promise<void> {
    const accountId = this.state.accountId;
    const existing = this.state.pins[userId];
    if (!accountId || !existing) return;
    this.set({ pins: { ...this.state.pins, [userId]: { keyId: existing.keyId, verified } } });
    await this.saveDevice();
  }

  /** True when `userId` has a key, so anything sent to them must be encrypted. */
  async peerHasKey(userId: string, refresh = false): Promise<boolean> {
    return Boolean((await this.peerKeys(userId, refresh)).current);
  }

  /**
   * Whether messages to `userId` will be encrypted, and the safety number when
   * they are. The number comes from both accounts' root keys, so it stays the
   * same across rotations.
   */
  async conversationInfo(userId: string): Promise<{ encrypted: boolean; safetyNumber: string | null }> {
    const accountId = this.state.accountId;
    if (!accountId || !this.keys) return { encrypted: false, safetyNumber: null };
    const [peer, own] = await Promise.all([this.peerKeys(userId), this.peerKeys(accountId).catch(() => null)]);
    if (!peer.current || !peer.root) return { encrypted: false, safetyNumber: null };
    const myRoot = own?.current?.keyId === this.keys.keyId && own.root ? own.root : publicKeyOf(this.keys);
    return {
      encrypted: true,
      safetyNumber: safetyNumber({ userId: accountId, key: myRoot }, { userId, key: peer.root }),
    };
  }

  // ------------------------------------------------------------ messages

  /**
   * Decrypt one message, and its encrypted reactions. Never throws: a message
   * that can't be read is marked instead. With `peerId`, an encrypted message
   * must be between this account and that peer, so the server can't show a
   * message from another conversation here.
   */
  async open<T extends DmLike>(message: T, peerId?: string): Promise<T & { text: string; e2ee: DmE2eeMark }> {
    const opened = await this.openText(message, peerId);
    if (!message.reactionEnvelopes?.length) return opened;
    return { ...opened, reactions: await this.mergeReactions(message, peerId) };
  }

  private async openText<T extends DmLike>(
    message: T,
    peerId?: string,
  ): Promise<T & { text: string; e2ee: DmE2eeMark }> {
    const envelope = message.envelope ? parseDmEnvelope(message.envelope) : null;
    if (!envelope) return { ...message, e2ee: message.envelope ? "failed" : "plaintext" };
    if (peerId !== undefined) {
      const me = this.state.accountId;
      const between =
        (envelope.from === me && envelope.to === peerId) || (envelope.from === peerId && envelope.to === me);
      if (!between) return { ...message, text: "", e2ee: "failed" };
    }
    const cached = this.opened.get(messageCacheKey(message.id, message.fromUserId, message.toUserId, envelope.s));
    if (cached) return this.withReply({ ...message, text: cached.text, e2ee: cached.mark }, cached.replyToId);
    if (!this.keys) return { ...message, text: "", e2ee: "locked" };
    let result: { text: string; mark: DmE2eeMark; replyToId?: string };
    try {
      const senderKey = await this.senderKey(message.fromUserId, envelope.sk);
      if (!senderKey) throw new DmCryptoError("Unknown sender key.", "bad-signature");
      const payload = openDirectMessage({
        envelope,
        reader: this.keyring,
        senderKey,
        expected: { id: message.id, from: message.fromUserId, to: message.toUserId },
      });
      result = { text: payload.t, mark: "encrypted", replyToId: payload.r };
    } catch (error) {
      // A network failure is worth retrying later; a bad message is not.
      if (error instanceof DmE2eeUnavailableError) return { ...message, text: "", e2ee: "failed" };
      result = { text: "", mark: this.unreadableMark(error) };
    }
    this.opened.set(messageCacheKey(message.id, message.fromUserId, message.toUserId, envelope.s), result);
    return this.withReply({ ...message, text: result.text, e2ee: result.mark }, result.replyToId);
  }

  /** "locked" when the message was for a key this device dropped or never had, "failed" when it is bad. */
  private unreadableMark(error: unknown): DmE2eeMark {
    return error instanceof DmCryptoError && error.code === "no-key" ? "locked" : "failed";
  }

  /** Add the encrypted reactions to a message's reaction map (same shape: emoji to account ids). */
  private async mergeReactions(message: DmLike, peerId?: string): Promise<Record<string, string[]>> {
    const merged: Record<string, string[]> = {};
    for (const [emoji, users] of Object.entries(message.reactions ?? {})) merged[emoji] = [...users];
    const me = this.state.accountId;
    const seen = new Set<string>();
    for (const raw of message.reactionEnvelopes ?? []) {
      const envelope = parseDmEnvelope(raw);
      if (!envelope || seen.has(envelope.from) || !this.keys || !me) continue;
      // Only the two people in this conversation react, each to the other.
      const other = envelope.from === message.fromUserId ? message.toUserId : message.fromUserId;
      const allowed =
        (envelope.from === message.fromUserId || envelope.from === message.toUserId) &&
        envelope.to === other &&
        (peerId === undefined || envelope.from === me || envelope.from === peerId);
      if (!allowed) continue;
      seen.add(envelope.from);
      let emojis = this.openedReactions.get(reactionCacheKey(message.id, envelope.from, other, envelope.s));
      if (emojis === undefined) {
        try {
          const senderKey = await this.senderKey(envelope.from, envelope.sk);
          emojis = senderKey
            ? openReactions({
                envelope,
                reader: this.keyring,
                senderKey,
                expected: { messageId: message.id, from: envelope.from, to: other },
              })
            : null;
        } catch (error) {
          if (error instanceof DmE2eeUnavailableError) continue;
          emojis = null;
        }
        this.openedReactions.set(reactionCacheKey(message.id, envelope.from, other, envelope.s), emojis);
      }
      for (const emoji of emojis ?? []) {
        const users = (merged[emoji] ??= []);
        if (!users.includes(envelope.from)) users.push(envelope.from);
      }
    }
    return merged;
  }

  private withReply<T extends DmLike | GroupMessageLike>(message: T, replyToId: string | undefined): T {
    if (!replyToId) return message;
    this.replies.set(message.id, replyToId);
    return { ...message, replyToId };
  }

  /**
   * Proof for reporting an encrypted message: its envelope and its content key,
   * so the safety team can check the sender really sent it. Null for a message
   * that isn't encrypted or that this device can't read. `scope` is "group" for
   * a group chat message.
   */
  reportProof(message: { envelope?: unknown }, scope: "message" | "group" = "message"): DmReportProof | null {
    const envelope = message.envelope
      ? parseDmEnvelope(message.envelope, scope === "group" ? DM_GROUP_MAX_WRAPS : undefined)
      : null;
    if (!envelope || !this.keys) return null;
    try {
      return reportProofFor(envelope, this.keyring, scope);
    } catch {
      return null;
    }
  }

  openAll<T extends DmLike>(
    messages: readonly T[],
    peerId?: string,
  ): Promise<Array<T & { text: string; e2ee: DmE2eeMark }>> {
    return Promise.all(messages.map((message) => this.open(message, peerId)));
  }

  private async senderKey(userId: string, keyId: string): Promise<DmPublicKey | null> {
    if (userId === this.state.accountId) {
      const own = this.keyring.find((keys) => keys.keyId === keyId);
      if (own) return publicKeyOf(own);
    }
    const peer = await this.peerKeys(userId);
    const known = peer.all.get(keyId) ?? (await this.peerKeys(userId, true)).all.get(keyId); // maybe they changed key since we looked
    return known ? bareKey(known) : null;
  }

  private requireKeys(): DmAccountKeys {
    if (this.keys) return this.keys;
    throw new DmE2eeUnavailableError(
      this.state.status === "locked"
        ? "Unlock encrypted messages on this device to send this."
        : "Encryption isn't ready on this device yet.",
    );
  }

  /**
   * Prepare an outgoing message to `peerId`: an envelope when both accounts can
   * encrypt, plaintext only when the peer has no key at all. Throws when this
   * device is locked and the conversation needs encryption.
   */
  async seal(
    peerId: string,
    text: string,
    options: { id?: string; refreshKeys?: boolean; replyToId?: string | null } = {},
  ): Promise<{ envelope: DmEnvelope } | { text: string }> {
    const accountId = this.state.accountId;
    if (!accountId) throw new DmE2eeUnavailableError("Sign in first.");
    if (!this.state.available) return { text };
    const peer = await this.peerKeys(peerId, options.refreshKeys);
    if (!peer.current) return { text };
    const keys = this.requireKeys();
    const id = options.id ?? crypto.randomUUID();
    // An edit keeps the reply link of the message it replaces.
    const replyToId = options.replyToId ?? (options.id ? this.replies.get(options.id) : undefined) ?? undefined;
    const envelope = sealDirectMessage({
      id,
      from: accountId,
      to: peerId,
      payload: replyToId ? { t: text, r: replyToId } : { t: text },
      sender: keys,
      recipientKey: peer.current,
    });
    this.opened.set(messageCacheKey(id, accountId, peerId, envelope.s), { text, mark: "encrypted", replyToId });
    if (replyToId) this.replies.set(id, replyToId);
    return { envelope };
  }

  /**
   * This account's reactions to an encrypted DM, sealed to replace its previous
   * ones: `emojis` is the full new set (empty to remove them all; see
   * toggledReactions).
   */
  async sealReactions(
    peerId: string,
    messageId: string,
    emojis: readonly string[],
    options: { refreshKeys?: boolean } = {},
  ): Promise<DmEnvelope> {
    const accountId = this.state.accountId;
    if (!accountId) throw new DmE2eeUnavailableError("Sign in first.");
    const peer = await this.peerKeys(peerId, options.refreshKeys);
    if (!peer.current) throw new DmE2eeUnavailableError("They can't receive encrypted reactions.");
    const envelope = sealReactions({
      messageId,
      from: accountId,
      to: peerId,
      emojis,
      sender: this.requireKeys(),
      recipientKey: peer.current,
    });
    this.openedReactions.set(reactionCacheKey(messageId, accountId, peerId, envelope.s), [...emojis]);
    return envelope;
  }

  // ------------------------------------------------------------ group chats

  /**
   * Whether a group's messages are encrypted: once the server has marked the group
   * encrypted, or as soon as every member has a key (the server then refuses
   * plaintext). `memberIds` includes this account.
   */
  async groupEncrypted(memberIds: readonly string[], markedEncrypted: boolean, refresh = false): Promise<boolean> {
    if (!this.state.available || !this.state.accountId) return false;
    if (markedEncrypted) return true;
    const others = memberIds.filter((id) => id !== this.state.accountId);
    if (!this.keys && this.state.status !== "locked") return false;
    const keys = await Promise.all(others.map((id) => this.peerKeys(id, refresh).then((peer) => peer.current)));
    return keys.every(Boolean);
  }

  /** Decrypt a group chat message. The envelope must name this group and the server's sender. */
  async openGroup<T extends GroupMessageLike>(
    message: T,
    groupId: string,
  ): Promise<T & { text: string; e2ee: DmE2eeMark }> {
    const envelope = message.envelope ? parseDmEnvelope(message.envelope, DM_GROUP_MAX_WRAPS) : null;
    if (!envelope) return { ...message, e2ee: message.envelope ? "failed" : "plaintext" };
    if (envelope.to !== groupId || envelope.from !== message.fromUserId)
      return { ...message, text: "", e2ee: "failed" };
    const cached = this.opened.get(groupCacheKey(groupId, message.id, message.fromUserId, envelope.s));
    if (cached) return this.withReply({ ...message, text: cached.text, e2ee: cached.mark }, cached.replyToId);
    if (!this.keys) return { ...message, text: "", e2ee: "locked" };
    let result: { text: string; mark: DmE2eeMark; replyToId?: string };
    try {
      const senderKey = await this.senderKey(message.fromUserId, envelope.sk);
      if (!senderKey) throw new DmCryptoError("Unknown sender key.", "bad-signature");
      const payload = openGroupMessage({
        envelope,
        reader: this.keyring,
        senderKey,
        expected: { id: message.id, from: message.fromUserId, groupId },
      });
      result = { text: payload.t, mark: "encrypted", replyToId: payload.r };
    } catch (error) {
      if (error instanceof DmE2eeUnavailableError) return { ...message, text: "", e2ee: "failed" };
      result = { text: "", mark: this.unreadableMark(error) };
    }
    this.opened.set(groupCacheKey(groupId, message.id, message.fromUserId, envelope.s), result);
    return this.withReply({ ...message, text: result.text, e2ee: result.mark }, result.replyToId);
  }

  openGroupAll<T extends GroupMessageLike>(
    messages: readonly T[],
    groupId: string,
  ): Promise<Array<T & { text: string; e2ee: DmE2eeMark }>> {
    return Promise.all(messages.map((message) => this.openGroup(message, groupId)));
  }

  /**
   * Prepare a group chat message: an envelope wrapped for every member when the
   * group is encrypted, plaintext otherwise. Throws when the group is encrypted
   * but this device is locked or a member has no key.
   */
  async sealGroup(
    groupId: string,
    memberIds: readonly string[],
    text: string,
    options: { markedEncrypted: boolean; refreshKeys?: boolean; replyToId?: string | null },
  ): Promise<{ envelope: DmEnvelope } | { text: string }> {
    const accountId = this.state.accountId;
    if (!accountId) throw new DmE2eeUnavailableError("Sign in first.");
    if (!(await this.groupEncrypted(memberIds, options.markedEncrypted, options.refreshKeys))) return { text };
    const keys = this.requireKeys();
    const others = [...new Set(memberIds)].filter((id) => id !== accountId);
    const memberKeys = await Promise.all(
      others.map((id) => this.peerKeys(id, options.refreshKeys).then((peer) => peer.current)),
    );
    if (memberKeys.some((key) => !key)) {
      throw new DmE2eeUnavailableError("Someone in this group can't receive encrypted messages yet.");
    }
    const id = crypto.randomUUID();
    const replyToId = options.replyToId ?? undefined;
    const envelope = sealGroupMessage({
      id,
      from: accountId,
      groupId,
      payload: replyToId ? { t: text, r: replyToId } : { t: text },
      sender: keys,
      memberKeys: memberKeys as DmPublicKey[],
    });
    this.opened.set(groupCacheKey(groupId, id, accountId, envelope.s), { text, mark: "encrypted", replyToId });
    if (replyToId) this.replies.set(id, replyToId);
    return { envelope };
  }

  // ------------------------------------------------------------ calls

  /**
   * Sign a local session description for `peerId`, so they can check its DTLS
   * fingerprints came from this account. Null when encryption is off or this
   * device has no key.
   */
  signRtc(peerId: string, sdp: string | undefined): RtcDescriptionAuth | null {
    const accountId = this.state.accountId;
    if (!this.state.available || !accountId || !this.keys || !sdp) return null;
    return signRtcDescription(this.keys, accountId, peerId, sdp);
  }

  /**
   * Check a peer's session description. A peer who has a key (or whose key this
   * device has pinned) must sign; a wrong signature is always rejected. With
   * `strict` (direct calls), a missing signature from such a peer is rejected
   * too; voice rooms treat it as unverified, so a peer whose device is locked
   * can still be heard, marked as not verified.
   */
  async verifyRtc(
    peerId: string,
    sdp: string | undefined,
    auth: unknown,
    { strict = false }: { strict?: boolean } = {},
  ): Promise<RtcVerdict> {
    const accountId = this.state.accountId;
    if (!this.state.available || !accountId || !sdp) return "unverified";
    const claimed =
      auth && typeof auth === "object" && typeof (auth as RtcDescriptionAuth).k === "string"
        ? (auth as RtcDescriptionAuth)
        : null;
    const signature = claimed && typeof claimed.s === "string" ? claimed : null;
    let peer: PeerKeys | null = null;
    try {
      peer = await this.peerKeys(peerId);
      if (signature && peer.current?.keyId !== signature.k) peer = await this.peerKeys(peerId, true);
    } catch {
      peer = null;
    }
    const expectsSignature = Boolean(peer?.current) || Boolean(this.state.pins[peerId]);
    if (!signature) return expectsSignature && strict ? "rejected" : "unverified";
    if (!peer?.current) return "rejected";
    return verifyRtcDescription(peer.current, peerId, accountId, sdp, signature) ? "verified" : "rejected";
  }
}
