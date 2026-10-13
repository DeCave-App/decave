import { dmMessageForClient, type ChannelMessageRow } from "./lib/messages";
import {
  checkOutgoingDm,
  checkOutgoingGroupMessage,
  dmE2eeEnabled,
  dmPushText,
  insertDirectMessageWithAttachmentGuard,
} from "./lib/dm-e2ee";
import { DM_GROUP_MAX_WRAPS, parseDmEnvelope } from "../shared/dm-e2ee-format";
import { DurableObject } from "cloudflare:workers";
import {
  canAccessRoom as dbCanAccessRoom,
  canCreateForumPost,
  canPostInChatRoom,
  isForumStaff,
  isTimedOut,
  ensureGroupChatSchema,
  getHub,
  groupChatMemberIds,
  getRole,
  getRoom,
  hasPermission,
  isGroupChatMember,
  nowIso,
  officialHubPostingDecision,
  publicIdOf,
  publicUser,
  userByReference,
  type GroupChatRow,
  type RoomRow,
  type ServerRole,
  type UserRow,
  presenceOnline,
  publicUserWithPresence,
  tokenHash,
} from "./db";
import type { Env } from "./index";
import { consumeSessionBoundWsToken, isActiveSession } from "./lib/sessions";
import {
  RealtimeDirectory,
  RealtimeLookup,
  SessionValidityCache,
  type PresenceHint,
  type RosterEntry,
  type RosterSocket,
} from "./lib/realtime-roster";
import { isBlockedEitherDirection } from "./trust-safety";
import {
  FORUM_POST_PREFIX,
  FORUM_TAG_LIMITS,
  parseForumPostPayload,
  rawForumPostJson,
  safeJsonStringArray,
  validateForumPostExtras,
} from "../shared/forum";
import { pushPreview, sendPush } from "./push";
import { loadPushSettings, pushText, shouldPush, type PushContext } from "./push-policy";
import { nextBotTimerAt, runAllDueBotTimers } from "./bots/timers";
import { inBackground, queueBotEvent, queueHubMessage, voiceRoomsOf } from "./bots/events";
import { createRealtimeClient, RealtimeSfuError, screenSfuEnabled } from "./lib/realtime-sfu";
import {
  canPull,
  EMPTY_SFU_FIELDS,
  keyRelayPayload,
  MAX_SFU_PULLS,
  parseMid,
  parseRequestId,
  parseRid,
  parseSdp,
  pruneViewerPull,
  sfuCloses,
  sfuDisabledResult,
  sfuErrorResult,
  sfuResult,
  trackNameFor,
  type ScreenSfuSocketFields,
  stopReleasesPublish,
} from "./screen-sfu-room";

/**
 * Send phone notifications that respect each recipient's synced settings
 * (levels, muted Hubs, quiet hours, preview privacy). Recipients are grouped
 * by preview style so each group gets one Expo request.
 */
async function pushWithPolicy(
  env: Env,
  userIds: readonly string[],
  context: PushContext,
  message: { sender: string; where: string | null; text: string; route: string; threadId: string },
): Promise<void> {
  if (!userIds.length) return;
  const settings = await loadPushSettings(env.DB, userIds);
  const groups = new Map<string, string[]>();
  for (const id of userIds) {
    const entry = settings.get(id);
    if (!entry || !shouldPush(entry, context)) continue;
    const list = groups.get(entry.preview) ?? [];
    list.push(id);
    groups.set(entry.preview, list);
  }
  for (const [, ids] of groups) {
    const { title, body } = pushText(settings.get(ids[0])!, message.sender, message.where, pushPreview(message.text));
    await sendPush(env, ids, { title, body, route: message.route, threadId: message.threadId });
  }
}

const REALTIME_MESSAGE_TYPES = new Set([
  "IDENTIFY",
  "PING",
  "JOIN_SERVER",
  "JOIN_CHANNEL",
  "TYPING",
  "CHAT_MESSAGE",
  "DM_MESSAGE",
  "GROUP_MESSAGE",
  "DM_CALL_START",
  "DM_CALL_ACCEPT",
  "DM_CALL_UPGRADE_VIDEO",
  "DM_CALL_DECLINE",
  "DM_CALL_END",
  "VOICE_JOIN",
  "VOICE_LEAVE",
  "VOICE_MUTE",
  "VOICE_DEAFEN",
  "VOICE_SCREEN_STATE",
  "VOICE_SOUNDBOARD_PLAY",
  "VOICE_CAMERA_STATE",
  "RTC_DESCRIPTION",
  "RTC_ICE_CANDIDATE",
  "RTC_SCREEN_WATCH",
  "RTC_SCREEN_KEY",
  "RTC_SCREEN_KEY_REQUEST",
  "RTC_SCREEN_MESH_REQUEST",
  "RTC_SFU_PUBLISH",
  "RTC_SFU_PULL",
  "RTC_SFU_LAYER",
  "RTC_SFU_RENEGOTIATE",
  "RTC_SFU_STOP",
  "VOICE_SFU_CAPABLE",
  "VOICE_MODERATE",
  "VOICE_STATE_REQUEST",
]);

const MAX_REALTIME_TYPE_LENGTH = 64;
const REALTIME_TOTAL_WINDOW_MS = 10_000;
const REALTIME_TOTAL_LIMIT = 600;
const IDENTIFY_WINDOW_MS = 60_000;
const IDENTIFY_LIMIT = 5;
const PING_WINDOW_MS = 60_000;
const PING_LIMIT = 30;
const MAX_IDENTIFY_FAILURES = 5;
const MAX_REALTIME_RATE_VIOLATIONS = 3;
const WS_ADMISSION_WINDOW_MS = 60_000;
const WS_HANDSHAKE_LIMIT_PER_ADDRESS = 60;
const WS_IDENTIFY_FAILURE_LIMIT_PER_ADDRESS = 60;
const WS_CONNECTION_LIMIT_PER_ADDRESS = 32;
// Hibernated sockets cost no CPU; this only bounds one object's memory.
const WS_CONNECTION_LIMIT_GLOBAL = 12_000;
// How long a validated session may receive broadcasts before D1 is asked again.
const SESSION_RECHECK_MS = 30_000;
// User rows and memberships shared by presence passes (see RealtimeDirectory).
const DIRECTORY_TTL_MS = 10_000;
// Presence changes are applied in one batched pass per window.
const PRESENCE_FLUSH_MS = 250;
// Older clients without "presence-diff" get one coalesced full roster per window.
const LEGACY_ROSTER_FLUSH_MS = 1_000;
// REST presence projections (/internal/online-users) reuse one answer this long.
const ONLINE_USERS_CACHE_MS = 2_000;
// Mesh voice: every participant uploads one stream per listener, which stops
// working well beyond this. Rooms without an explicit limit use it.
export const DEFAULT_VOICE_ROOM_LIMIT = 10;
const WS_ADMISSION_KEY_LIMIT = 4_096;
const BOT_TIMER_MIN_DELAY_MS = 1_000;
const BOT_TIMER_FAILURE_BACKOFF_MS = 30_000;
const WS_AUTH_DEADLINE_MS = 30_000;
const UNKNOWN_WS_ADDRESS = "unknown";
const MAX_CLIENT_MESSAGE_ID_LENGTH = 128;

type VoiceParticipant = {
  connectionId: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  channelId: number;
  role: ServerRole | null;
  muted: boolean;
  selfMuted: boolean;
  deafened: boolean;
  selfDeafened: boolean;
  serverMuted: boolean;
  serverDeafened: boolean;
  screenSharing: boolean;
  allowStreamPreview: boolean;
  cameraSharing: boolean;
  screenSfu: { sessionId: string; trackName: string } | null;
  sfuScreenCapable: boolean;
  /** The sharer's display MediaStream id (only while screen sharing). */
  screenStreamId: string | null;
};

type RealtimeRateBucket = { startedAt: number; count: number };
type WebSocketAdmissionWindow = { startedAt: number; attempts: number; identifyFailures: number };

type SocketState = {
  connectionId: string;
  authDeadlineAt: number;
  client: "mobile" | "web" | "desktop";
  userId: string | null;
  sessionHash: string | null;
  username: string | null;
  serverId: number;
  channelId: number;
  voiceChannelId: number | null;
  voiceMuted: boolean;
  voiceDeafened: boolean;
  voiceServerMuted: boolean;
  voiceServerDeafened: boolean;
  screenSharing: boolean;
  screenStreamId?: string | null;
  allowStreamPreview: boolean;
  cameraSharing: boolean;
  dmCallId: string | null;
  dmCallPeerUserId: string | null;
  dmCallPeerConnectionId: string | null;
  dmCallIncoming: boolean;
  dmCallAccepted: boolean;
  dmCallVideo: boolean;
  identifiedAt: number;
  identifyFailures: number;
  rateLimitViolations: number;
  lastPresenceTouchAt: number;
  /** Client applies USERS_DIFF frames instead of needing full USERS_UPDATE rosters. */
  presenceDiff?: boolean;
  /** Public user id cached at voice join (saves a D1 read per screen-key relay). */
  publicUserId?: string | null;
} & ScreenSfuSocketFields;

let presenceTableReady = false;

async function touchRealtimePresence(db: D1Database, userId: string): Promise<void> {
  if (!presenceTableReady) {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS decave_presence_activity (
        user_id TEXT PRIMARY KEY,
        last_seen_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
      )`,
      )
      .run();
    presenceTableReady = true;
  }
  await db
    .prepare(
      `INSERT INTO decave_presence_activity(user_id,last_seen_at)
       VALUES(?,?)
       ON CONFLICT(user_id) DO UPDATE SET last_seen_at=excluded.last_seen_at`,
    )
    .bind(userId, nowIso())
    .run();
}

// Keep Durable Object / WebSocket room authorization identical to the HTTP API.
// The db helper covers the baseline Hub rules; the explicit grant table is the
// source of truth for normal members selected for a private room.
async function canAccessRoom(
  db: D1Database,
  room: { id: number; hub_id: number; private: number },
  userId: string,
): Promise<boolean> {
  if (await dbCanAccessRoom(db, room as never, userId)) return true;
  if (room.private !== 1) return false;

  const role = await getRole(db, room.hub_id, userId);
  if (!role) return false;
  if (role === "owner" || role === "admin") return true;

  const grant = await db
    .prepare("SELECT 1 FROM decave_room_members WHERE room_id=? AND user_id=? LIMIT 1")
    .bind(room.id, userId)
    .first();
  return Boolean(grant);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True only for an explicit @username, not @everyone. */
function directMention(text: string, username: string): boolean {
  const escapedUsername = escapeRegExp(username.trim());
  if (!escapedUsername) return false;
  return new RegExp(`(^|\\s)@${escapedUsername}(?=$|\\s|[.,!?;:()\\[\\]{}])`, "i").test(text);
}

function messageMentions(text: string, username: string): boolean {
  const escapedUsername = escapeRegExp(username.trim());
  if (!escapedUsername) return false;
  const mention = new RegExp(`(^|\\s)@${escapedUsername}(?=$|\\s|[.,!?;:()\\[\\]{}])`, "i");
  const everyone = /(^|\s)@everyone(?=$|\s|[.,!?;:()[\]{}])/i;
  return mention.test(text) || everyone.test(text);
}
type Filter = {
  userIds?: string[];
  sessionHashes?: string[];
  hubId?: number;
  channelId?: number;
  voiceChannelId?: number;
  exceptConnectionId?: string;
};

// Connection rate limits are keyed by a hash of the client address; the raw
// IP is never kept in socket state.
function peerAddressForRequest(request: Request): string {
  const address = request.headers.get("CF-Connecting-IP")?.trim() ?? "";
  return address && address.length <= 64 ? tokenHash(`ws-peer|${address}`).slice(0, 24) : UNKNOWN_WS_ADDRESS;
}

function boundedClientMessageId(value: unknown): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_CLIENT_MESSAGE_ID_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(value)
    ? value
    : null;
}

/** A well-formed signature next to a session description, or null. */
function rtcDescriptionAuth(raw: unknown): { k: string; s: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const { k, s } = raw as { k?: unknown; s?: unknown };
  return typeof k === "string" &&
    /^[A-Za-z0-9_-]{22}$/.test(k) &&
    typeof s === "string" &&
    /^[A-Za-z0-9_-]{86}$/.test(s)
    ? { k, s }
    : null;
}

// Calls are relay-only: forward only TURN relay candidates (and the empty
// end-of-candidates marker) so no participant learns another's IP address,
// even from an outdated client.
function isRelayCandidatePayload(candidate: unknown): boolean {
  const line =
    typeof candidate === "string"
      ? candidate
      : candidate &&
          typeof candidate === "object" &&
          typeof (candidate as { candidate?: unknown }).candidate === "string"
        ? (candidate as { candidate: string }).candidate
        : "";
  return line.trim() === "" || /\styp relay(\s|$)/.test(line);
}

export class HubRoom extends DurableObject<Env> {
  private realtimeRate = new Map<string, Map<string, RealtimeRateBucket>>();
  private wsAdmission = new Map<string, WebSocketAdmissionWindow>();
  // Address-derived rate-limit keys live only in memory. Never serialize them
  // with a hibernatable WebSocket attachment or persist them in storage.
  private peerAddressByConnection = new Map<string, string>();
  // After a failed bot-timer run the next bot wake-up waits this long (auth deadlines don't).
  private botTimerBackoffUntil = 0;
  private sessionValidity = new SessionValidityCache(SESSION_RECHECK_MS);
  private directory = new RealtimeDirectory(DIRECTORY_TTL_MS);
  private legacyRosterPending = new Set<string>();
  private pendingPresence = new Map<string, { state: SocketState; gone: boolean; previousHubs: Set<number> }>();
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private legacyRosterTimer: ReturnType<typeof setTimeout> | null = null;
  private onlineUsersCache: { at: number; userIds: string[] } | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const state = this.state(ws);
      if (state.userId || state.authDeadlineAt <= 0) continue;
      if (state.authDeadlineAt <= now) {
        this.send(ws, { type: "AUTH_ERROR", message: "Authentication timed out. Please reconnect." });
        try {
          ws.close(4003, "Authentication timed out");
        } catch {}
        continue;
      }
    }
    // Bot timers (schedules, waits, temporary roles). A bot failure must never
    // stop the auth deadlines above from being re-armed.
    try {
      await runAllDueBotTimers(this.env, now);
    } catch (error) {
      console.error("bot timers failed", error);
      this.botTimerBackoffUntil = Date.now() + BOT_TIMER_FAILURE_BACKOFF_MS;
    }
    await this.refreshDeadlineAlarm();
  }

  private consumeRealtimeRate(
    buckets: Map<string, RealtimeRateBucket>,
    key: string,
    now: number,
    windowMs: number,
    limit: number,
  ): boolean {
    const current = buckets.get(key);
    if (!current || now - current.startedAt >= windowMs) {
      buckets.set(key, { startedAt: now, count: 1 });
      return true;
    }
    if (current.count >= limit) return false;
    current.count += 1;
    return true;
  }

  private allowRealtime(connectionId: string, type: string, includeTotal = true): boolean {
    const now = Date.now();
    let buckets = this.realtimeRate.get(connectionId);
    if (!buckets) {
      buckets = new Map();
      this.realtimeRate.set(connectionId, buckets);
    }

    if (
      includeTotal &&
      !this.consumeRealtimeRate(buckets, "__total__", now, REALTIME_TOTAL_WINDOW_MS, REALTIME_TOTAL_LIMIT)
    ) {
      return false;
    }

    let windowMs = 10_000;
    let limit = 120;
    if (type === "__frame__") limit = REALTIME_TOTAL_LIMIT;
    if (type === "IDENTIFY") {
      windowMs = IDENTIFY_WINDOW_MS;
      limit = IDENTIFY_LIMIT;
    }
    if (type === "PING") {
      windowMs = PING_WINDOW_MS;
      limit = PING_LIMIT;
    }

    if (type === "TYPING") limit = 70;
    if (type === "VOICE_SOUNDBOARD_PLAY") limit = 12;
    // Each of these fans out a full voice-state broadcast to every socket.
    if (
      type === "VOICE_MUTE" ||
      type === "VOICE_DEAFEN" ||
      type === "VOICE_SCREEN_STATE" ||
      type === "VOICE_CAMERA_STATE"
    )
      limit = 20;
    if (type === "VOICE_JOIN" || type === "VOICE_LEAVE") limit = 20;

    return this.consumeRealtimeRate(buckets, type, now, windowMs, limit);
  }

  private rejectRealtimeRate(ws: WebSocket, state: SocketState): SocketState {
    const next = { ...state, rateLimitViolations: state.rateLimitViolations + 1 };
    this.attach(ws, next);
    this.send(ws, { type: "ERROR", message: "Too many realtime requests. Slow down." });
    if (next.rateLimitViolations >= MAX_REALTIME_RATE_VIOLATIONS) {
      try {
        ws.close(4008, "Too many realtime requests");
      } catch {}
    }
    return next;
  }

  private async refreshDeadlineAlarm(): Promise<void> {
    const deadlines: number[] = [];
    for (const socket of this.ctx.getWebSockets()) {
      const state = this.state(socket);
      if (!state.userId && Number.isSafeInteger(state.authDeadlineAt) && state.authDeadlineAt > 0) {
        deadlines.push(state.authDeadlineAt);
      }
    }
    try {
      const botTimerAt = await nextBotTimerAt(this.env);
      // Never re-arm in the past: a due timer the alarm couldn't take (D1
      // down) would otherwise spin the alarm.
      if (botTimerAt !== null)
        deadlines.push(Math.max(botTimerAt, Date.now() + BOT_TIMER_MIN_DELAY_MS, this.botTimerBackoffUntil));
    } catch (error) {
      console.error("bot timer lookup failed", error);
    }
    if (deadlines.length === 0) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.min(...deadlines));
  }

  private activeWebSocketsForAddress(address: string): number {
    return this.ctx
      .getWebSockets()
      .reduce(
        (count, socket) =>
          count + (this.peerAddressByConnection.get(this.state(socket).connectionId) === address ? 1 : 0),
        0,
      );
  }

  private peerAddressForState(state: SocketState): string {
    // Peer addresses aren't persisted with hibernatable sockets. Keep restored
    // sockets in independent IDENTIFY failure buckets so one set of revived
    // unauthenticated sockets can't exhaust a shared "unknown" bucket.
    return this.peerAddressByConnection.get(state.connectionId) ?? `${UNKNOWN_WS_ADDRESS}:${state.connectionId}`;
  }

  private allowWebSocketAdmission(address: string): boolean {
    const now = Date.now();
    for (const [key, window] of this.wsAdmission) {
      if (now - window.startedAt >= WS_ADMISSION_WINDOW_MS) this.wsAdmission.delete(key);
    }

    if (this.ctx.getWebSockets().length >= WS_CONNECTION_LIMIT_GLOBAL) return false;
    if (this.activeWebSocketsForAddress(address) >= WS_CONNECTION_LIMIT_PER_ADDRESS) return false;

    let window = this.wsAdmission.get(address);
    if (!window) {
      if (this.wsAdmission.size >= WS_ADMISSION_KEY_LIMIT) return false;
      window = { startedAt: now, attempts: 0, identifyFailures: 0 };
      this.wsAdmission.set(address, window);
    }
    if (!Number.isSafeInteger(window.identifyFailures) || window.identifyFailures < 0) window.identifyFailures = 0;
    if (window.attempts >= WS_HANDSHAKE_LIMIT_PER_ADDRESS) return false;
    window.attempts += 1;
    return true;
  }

  private identifyFailuresForAddress(address: string): number {
    const window = this.wsAdmission.get(address);
    if (!window || Date.now() - window.startedAt >= WS_ADMISSION_WINDOW_MS) return 0;
    return Number.isSafeInteger(window.identifyFailures) && window.identifyFailures >= 0 ? window.identifyFailures : 0;
  }

  private recordIdentifyFailure(address: string): boolean {
    const now = Date.now();
    let window = this.wsAdmission.get(address);
    if (!window || now - window.startedAt >= WS_ADMISSION_WINDOW_MS) {
      if (window) this.wsAdmission.delete(address);
      if (this.wsAdmission.size >= WS_ADMISSION_KEY_LIMIT) return false;
      window = { startedAt: now, attempts: 0, identifyFailures: 0 };
      this.wsAdmission.set(address, window);
    }
    if (!Number.isSafeInteger(window.identifyFailures) || window.identifyFailures < 0) window.identifyFailures = 0;
    window.identifyFailures += 1;
    return window.identifyFailures <= WS_IDENTIFY_FAILURE_LIMIT_PER_ADDRESS;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/connect") {
      if ((request.headers.get("Upgrade") ?? "").toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }
      const peerAddress = peerAddressForRequest(request);
      if (!this.allowWebSocketAdmission(peerAddress)) {
        return new Response("Realtime connection temporarily limited.", {
          status: 429,
          headers: {
            "cache-control": "no-store",
            "retry-after": "60",
          },
        });
      }
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      const state: SocketState = {
        connectionId: crypto.randomUUID(),
        authDeadlineAt: Date.now() + WS_AUTH_DEADLINE_MS,
        client: "web",
        userId: null,
        sessionHash: null,
        username: null,
        serverId: 0,
        channelId: 0,
        voiceChannelId: null,
        voiceMuted: false,
        voiceDeafened: false,
        voiceServerMuted: false,
        voiceServerDeafened: false,
        screenSharing: false,
        allowStreamPreview: true,
        cameraSharing: false,
        dmCallId: null,
        dmCallPeerUserId: null,
        dmCallPeerConnectionId: null,
        dmCallIncoming: false,
        dmCallAccepted: false,
        dmCallVideo: false,
        identifiedAt: 0,
        identifyFailures: 0,
        rateLimitViolations: 0,
        lastPresenceTouchAt: 0,
        ...EMPTY_SFU_FIELDS,
      };
      this.peerAddressByConnection.set(state.connectionId, peerAddress);
      this.attach(server, state);
      this.ctx.acceptWebSocket(server);
      try {
        await this.refreshDeadlineAlarm();
      } catch {
        try {
          server.close(1013, "Realtime authentication is temporarily unavailable");
        } catch {}
        return new Response("Realtime authentication is temporarily unavailable.", { status: 503 });
      }
      server.send(JSON.stringify({ type: "AUTH_REQUIRED" }));
      return new Response(null, { status: 101, webSocket: client });
    }

    // Wakes the alarm after a bot timer is written. Like every /internal path it
    // is reachable only through the env binding (index.ts forwards just /connect).
    if (url.pathname === "/internal/bot-timers/arm" && request.method === "POST") {
      await this.refreshDeadlineAlarm();
      return Response.json({ success: true });
    }

    if (url.pathname === "/internal/broadcast" && request.method === "POST") {
      const data = await request.json<{ event: unknown; filter?: Filter }>();
      const event = data.event && typeof data.event === "object" ? (data.event as Record<string, unknown>) : null;
      // Cached presence inputs that this event may have made stale.
      if (event?.type === "PROFILE_UPDATED") {
        this.onlineUsersCache = null;
        this.directory.forgetUsers();
      }
      if (event?.type === "SERVERS_REFRESH" || event?.type === "ACCESS_REVOKED") this.directory.forgetMemberships();

      if (event?.type === "SESSION_REVOKED") {
        const filter = data.filter ?? {};
        for (const socket of this.ctx.getWebSockets()) {
          const state = this.state(socket);
          if (this.matches(state, filter)) {
            this.revokeSocket(socket, typeof event.reason === "string" ? event.reason : "session_revoked");
          }
        }
        return Response.json({ success: true });
      }

      // Membership revocation has to clear live media state before the
      // notification reaches the client. A client can have an in-flight
      // reconnect or VOICE_JOIN frame when a kick/ban commits in D1; leaving
      // the state attached to that socket would let it keep publishing until
      // another authorization check. Keep the realtime connection alive for
      // other hubs/DMs, but remove the revoked hub and voice state.
      if (event?.type === "ACCESS_REVOKED") {
        const filter = data.filter ?? {};
        const serverId = Number(event.serverId);
        const recipients = await this.liveRecipients(filter);
        for (const socket of recipients) {
          let socketState = this.state(socket);
          const voiceRoom =
            socketState.voiceChannelId === null ? null : await getRoom(this.env.DB, socketState.voiceChannelId);
          const voiceInRevokedHub = Number.isSafeInteger(serverId) && serverId > 0 && voiceRoom?.hub_id === serverId;
          if (
            Number.isSafeInteger(serverId) &&
            serverId > 0 &&
            (socketState.serverId === serverId || voiceInRevokedHub)
          ) {
            if (voiceInRevokedHub && socketState.voiceChannelId !== null) {
              await this.leaveVoice(socket, socketState, true);
              socketState = this.state(socket);
            }
            if (socketState.serverId === serverId) {
              this.attach(socket, { ...socketState, serverId: 0, channelId: 0 });
            }
          }
          this.send(socket, event);
        }
        return Response.json({ success: true });
      }

      // Username changes need to update the authenticated socket attachment as
      // well as the visible profile. Otherwise new messages from this existing
      // connection would keep using the username captured during IDENTIFY.
      if (event?.type === "PROFILE_UPDATED" && event.user && typeof event.user === "object") {
        const publicProfile = event.user as Record<string, unknown>;
        const userReference = typeof publicProfile.id === "string" ? publicProfile.id : "";
        const username = typeof publicProfile.username === "string" ? publicProfile.username : "";
        if (userReference && username) {
          const changedUser = await userByReference(this.env.DB, userReference);
          if (changedUser) {
            for (const socket of this.ctx.getWebSockets()) {
              const socketState = this.state(socket);
              if (socketState.userId !== changedUser.id) continue;
              this.attach(socket, { ...socketState, username });
            }
          }
        }
      }

      await this.broadcast(data.event, data.filter ?? {});
      return Response.json({ success: true });
    }

    if (url.pathname === "/internal/recheck-access" && request.method === "POST") {
      const body = await request.json<{ hubId?: number; message?: string }>();
      const hubId = Number(body.hubId);
      if (!Number.isSafeInteger(hubId) || hubId <= 0)
        return Response.json({ error: "hubId required" }, { status: 400 });
      this.directory.forgetMemberships();
      const changed = await this.recheckHubAccess(hubId, typeof body.message === "string" ? body.message : undefined);
      return Response.json({ success: true, changed });
    }

    if (url.pathname === "/internal/count" && request.method === "POST") {
      const body = await request.json<{ hubId?: number }>();
      const visible = await this.visibleOnlineUserIds();
      const ids = new Set(
        this.states()
          .filter((x) => body.hubId === undefined || x.serverId === body.hubId)
          .map((x) => x.userId)
          .filter((x): x is string => !!x && visible.has(x)),
      );
      return Response.json({ count: ids.size });
    }

    // Distinct users connected to each requested voice room (Discover's "in voice" signal).
    if (url.pathname === "/internal/voice-counts" && request.method === "POST") {
      const body = await request.json<{ channelIds?: unknown }>();
      const wanted = new Set(
        (Array.isArray(body.channelIds) ? body.channelIds : [])
          .map(Number)
          .filter((id) => Number.isSafeInteger(id) && id > 0)
          .slice(0, 2000),
      );
      const users = new Map<number, Set<string>>();
      for (const state of this.states()) {
        if (!state.userId || state.voiceChannelId === null || !wanted.has(state.voiceChannelId)) continue;
        const set = users.get(state.voiceChannelId) ?? new Set<string>();
        set.add(state.userId);
        users.set(state.voiceChannelId, set);
      }
      const connected = [...new Set([...users.values()].flatMap((set) => [...set]))];
      const visible = await this.visibleConnectedUserIds(connected);
      const counts: Record<string, number> = {};
      for (const [channelId, set] of users) {
        counts[String(channelId)] = [...set].filter((userId) => visible.has(userId)).length;
      }
      return Response.json({ counts });
    }

    if (url.pathname === "/internal/online-users") {
      return Response.json({ userIds: [...(await this.visibleOnlineUserIds())] });
    }

    if (url.pathname === "/internal/stats") {
      const states = this.states();
      const authenticatedStates = states.filter((state): state is SocketState & { userId: string } =>
        Boolean(state.userId),
      );
      const visible = await this.visibleConnectedUserIds([
        ...new Set(authenticatedStates.map((state) => state.userId)),
      ]);
      return Response.json({
        onlineUsers: visible.size,
        voiceUsers: new Set(
          authenticatedStates
            .filter((state) => visible.has(state.userId) && (state.voiceChannelId !== null || state.dmCallAccepted))
            .map((state) => state.userId),
        ).size,
        screenSharingUsers: new Set(
          authenticatedStates
            .filter((state) => visible.has(state.userId) && state.screenSharing)
            .map((state) => state.userId),
        ).size,
      });
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const payloadBytes = typeof raw === "string" ? new TextEncoder().encode(raw).byteLength : raw.byteLength;
    if (payloadBytes > 1024 * 1024) {
      this.send(ws, { type: "ERROR", message: "Realtime payload is too large." });
      try {
        ws.close(1009, "Payload too large");
      } catch {}
      return;
    }
    let state = this.state(ws);
    if (state.userId) {
      const active = await this.sessionIsActive(state);
      if (active === "unavailable") {
        this.revokeSocket(ws, "session_validation_unavailable");
        return;
      }
      if (!active) {
        this.revokeSocket(ws, "session_revoked");
        return;
      }
    }
    if (!this.allowRealtime(state.connectionId, "__frame__")) {
      this.rejectRealtimeRate(ws, state);
      return;
    }
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)) as Record<string, unknown>;
    } catch {
      this.send(ws, { type: "ERROR", message: "Invalid JSON payload" });
      return;
    }

    const type = typeof data.type === "string" ? data.type : "";
    const knownType = type.length <= MAX_REALTIME_TYPE_LENGTH && REALTIME_MESSAGE_TYPES.has(type);
    const rateType = knownType ? type : "__unknown__";
    if (!this.allowRealtime(state.connectionId, rateType, false)) {
      state = this.rejectRealtimeRate(ws, state);
      return;
    }
    if (state.rateLimitViolations !== 0) {
      state = { ...state, rateLimitViolations: 0 };
      this.attach(ws, state);
    }

    if (!knownType) {
      this.send(ws, { type: "ERROR", message: "Unknown realtime message type." });
      return;
    }

    if (type === "IDENTIFY") {
      const token = typeof data.token === "string" && data.token.length <= 256 ? data.token : "";
      const peerAddress = this.peerAddressForState(state);
      if (this.identifyFailuresForAddress(peerAddress) >= WS_IDENTIFY_FAILURE_LIMIT_PER_ADDRESS) {
        this.send(ws, { type: "AUTH_ERROR", message: "Too many authentication attempts. Try again later." });
        try {
          ws.close(4003, "Too many authentication attempts");
        } catch {}
        return;
      }
      let credentials: Awaited<ReturnType<typeof consumeSessionBoundWsToken>>;
      try {
        credentials = await consumeSessionBoundWsToken(this.env, token);
      } catch {
        this.send(ws, { type: "AUTH_ERROR", message: "Authentication is temporarily unavailable. Please retry." });
        return;
      }
      if (!credentials) {
        state = { ...state, identifyFailures: state.identifyFailures + 1 };
        this.attach(ws, state);
        this.send(ws, { type: "AUTH_ERROR", message: "Session expired. Please log in again." });
        if (state.identifyFailures >= MAX_IDENTIFY_FAILURES || !this.recordIdentifyFailure(peerAddress)) {
          try {
            ws.close(4003, "Too many authentication attempts");
          } catch {}
        }
        return;
      }
      const { user, sessionHash } = credentials;

      // DECAVE_PARITY_IDENTIFY_CLIENT_CLASS
      const requestedClient = data.client === "mobile" ? "mobile" : data.client === "desktop" ? "desktop" : "web";
      for (const other of this.ctx.getWebSockets()) {
        if (other === ws) continue;
        const otherState = this.state(other);
        if (otherState.userId !== user.id) continue;
        const sameClass =
          requestedClient === "mobile" ? otherState.client === "mobile" : otherState.client !== "mobile";
        if (!sameClass) continue;
        this.send(other, { type: "SESSION_REVOKED", reason: "same_client_replaced" });
        try {
          other.close(4001, "Same client replaced");
        } catch {}
      }

      const requestedHub = await getHub(this.env.DB, Number(data.serverId));
      let serverId = requestedHub && (await getRole(this.env.DB, requestedHub.id, user.id)) ? requestedHub.id : 0;

      if (!serverId) {
        const first = await this.env.DB.prepare(
          `SELECT h.id FROM decave_hubs h
             JOIN decave_hub_members hm ON hm.hub_id=h.id
             WHERE hm.user_id=? ORDER BY h.id LIMIT 1`,
        )
          .bind(user.id)
          .first<{ id: number }>();
        serverId = Number(first?.id ?? 0);
      }

      let channelId = 0;
      const requestedRoom = await getRoom(this.env.DB, Number(data.channelId));
      if (
        requestedRoom &&
        requestedRoom.hub_id === serverId &&
        (await canAccessRoom(this.env.DB, requestedRoom, user.id))
      )
        channelId = requestedRoom.id;
      if (!channelId && serverId) {
        const rooms = await this.env.DB.prepare(
          "SELECT * FROM decave_rooms WHERE hub_id=? ORDER BY CASE WHEN type='text' THEN 0 ELSE 1 END,position,id",
        )
          .bind(serverId)
          .all<RoomRow>();
        for (const candidate of rooms.results) {
          if (await canAccessRoom(this.env.DB, candidate, user.id)) {
            channelId = Number(candidate.id);
            break;
          }
        }
      }

      state = {
        ...state,
        client: requestedClient,
        userId: user.id,
        sessionHash,
        username: user.username,
        serverId,
        channelId,
        identifiedAt: Date.now(),
        identifyFailures: 0,
        authDeadlineAt: 0,
        lastPresenceTouchAt: Date.now(),
        presenceDiff: Array.isArray(data.features) && data.features.includes("presence-diff"),
      };
      this.attach(ws, state);
      this.sessionValidity.set(sessionHash, true);
      await touchRealtimePresence(this.env.DB, user.id);
      await this.refreshDeadlineAlarm();
      this.send(ws, {
        type: "IDENTIFIED",
        id: state.connectionId,
        userId: publicIdOf(user),
        username: user.username,
        serverId,
        channelId,
      });
      // Clients load their Hub list over REST (it carries per-user grants);
      // this only tells them to do so.
      this.send(ws, { type: "SERVERS_REFRESH" });
      await this.sendRoster(ws);
      await this.presenceChanged(state);
      await this.sendSocial(ws, user.id);
      await this.sendVoiceState(ws, user.id);
      return;
    }

    if (!state.userId || !state.username) {
      this.send(ws, { type: "ERROR", message: "You must authenticate first" });
      return;
    }

    if (type === "PING") {
      if (state.userId && Date.now() - Number(state.lastPresenceTouchAt || 0) >= 60_000) {
        state = { ...state, lastPresenceTouchAt: Date.now() };
        this.attach(ws, state);
        await touchRealtimePresence(this.env.DB, state.userId!);
      }
      this.send(ws, {
        type: "PONG",
        timestamp: typeof data.timestamp === "number" ? data.timestamp : Date.now(),
      });
      return;
    }

    if (type === "JOIN_SERVER") {
      const hubId = Number(data.serverId);
      if (!(await getRole(this.env.DB, hubId, state.userId))) {
        this.send(ws, { type: "ERROR", message: "You do not have access to this server" });
        return;
      }
      const rooms = await this.env.DB.prepare(
        "SELECT * FROM decave_rooms WHERE hub_id=? ORDER BY CASE WHEN type='text' THEN 0 ELSE 1 END,position,id",
      )
        .bind(hubId)
        .all<RoomRow>();
      let channelId = 0;
      for (const candidate of rooms.results) {
        if (await canAccessRoom(this.env.DB, candidate, state.userId)) {
          channelId = Number(candidate.id);
          break;
        }
      }
      const previousServerId = state.serverId;
      state = { ...state, serverId: hubId, channelId };
      this.attach(ws, state);
      this.send(ws, { type: "SERVER_JOINED", serverId: state.serverId, channelId: state.channelId });
      await this.presenceChanged(state, { previousServerId });
      return;
    }

    if (type === "JOIN_CHANNEL") {
      const room = await getRoom(this.env.DB, Number(data.channelId));
      if (!room || room.hub_id !== state.serverId || !(await canAccessRoom(this.env.DB, room, state.userId))) {
        this.send(ws, { type: "ERROR", message: "Room not found or inaccessible" });
        return;
      }
      state = { ...state, channelId: room.id };
      this.attach(ws, state);
      this.send(ws, { type: "CHANNEL_JOINED", channelId: room.id });
      // A client may be on an older bundle that does not issue the explicit
      // VOICE_STATE_REQUEST after navigation. Push the authoritative voice
      // roster whenever the active text/channel subscription changes so web
      // and desktop converge on the same live-room view.
      await this.sendVoiceState(ws, state.userId!);
      await this.presenceChanged(state);
      return;
    }

    if (type === "TYPING") {
      const roomId = Number(data.channelId);
      if (roomId !== state.channelId) return;
      const typingUser = await this.env.DB.prepare("SELECT * FROM decave_users WHERE id=?")
        .bind(state.userId)
        .first<UserRow>();
      await this.broadcast(
        {
          type: "TYPING",
          channelId: roomId,
          userId: typingUser ? publicIdOf(typingUser) : "",
          username: state.username,
          active: data.active === true,
        },
        { channelId: roomId, exceptConnectionId: state.connectionId },
      );
      return;
    }

    if (type === "CHAT_MESSAGE") {
      const roomId = Number(data.channelId);
      const room = await getRoom(this.env.DB, roomId);
      if (!room || room.hub_id !== state.serverId || !(await canAccessRoom(this.env.DB, room, state.userId))) {
        this.send(ws, { type: "ERROR", message: "Room not found or inaccessible" });
        return;
      }
      const postingDecision = await officialHubPostingDecision(this.env.DB, room.hub_id, state.userId);
      if (postingDecision === "unavailable") {
        this.send(ws, {
          type: "ERROR",
          message: "Official Hub posting policy is temporarily unavailable.",
          code: "HUB_POLICY_UNAVAILABLE",
        });
        return;
      }
      if (postingDecision === "deny") {
        this.send(ws, { type: "ERROR", message: "Only the Hub owner can post in this Hub." });
        return;
      }
      if (room.kind !== "forum" && !(await canPostInChatRoom(this.env.DB, room, state.userId!))) {
        this.send(ws, { type: "ERROR", message: `#${room.name} is read-only.`, code: "ROOM_READ_ONLY" });
        return;
      }

      // A click can race the CHANNEL_JOINED acknowledgement. Once the message
      // itself has passed the same authorization check, synchronize the socket
      // subscription before broadcasting so the sender also receives the event.
      if (state.channelId !== room.id) {
        state = { ...state, channelId: room.id };
        this.attach(ws, state);
      }
      const timeout = await this.env.DB.prepare("SELECT expires_at FROM decave_timeouts WHERE hub_id=? AND user_id=?")
        .bind(room.hub_id, state.userId)
        .first<{ expires_at: string }>();
      if (timeout && Date.parse(timeout.expires_at) > Date.now()) {
        this.send(ws, { type: "ERROR", message: "You are currently timed out in this Hub." });
        return;
      }

      const hub = await getHub(this.env.DB, room.hub_id);
      // Slow mode exempts staff (owner, admins, message moderators), as the
      // Manage Hub UI promises.
      if (
        hub?.slow_mode_seconds &&
        !(state.userId && (await hasPermission(this.env.DB, room.hub_id, state.userId, "moderateMessages")))
      ) {
        const last = await this.env.DB.prepare(
          "SELECT created_at FROM decave_messages WHERE room_id=? AND author_user_id=? ORDER BY created_at DESC LIMIT 1",
        )
          .bind(roomId, state.userId)
          .first<{ created_at: string }>();
        if (last && Date.now() - Date.parse(last.created_at) < hub.slow_mode_seconds * 1000) {
          this.send(ws, {
            type: "ERROR",
            message: `Slow mode is enabled. Wait ${hub.slow_mode_seconds} seconds between messages.`,
          });
          return;
        }
      }

      const text = typeof data.text === "string" ? data.text.trim().slice(0, 4000) : "";
      const attachment =
        data.attachment && typeof data.attachment === "object" ? (data.attachment as Record<string, unknown>) : null;
      if (!text && !attachment) return;

      let attachmentKey: string | null = null;
      if (attachment) {
        const explicitKey = typeof attachment.r2Key === "string" ? attachment.r2Key : "";
        const attachmentUrl = typeof attachment.url === "string" ? attachment.url : "";
        if (explicitKey) {
          attachmentKey = explicitKey;
        } else if (attachmentUrl.startsWith("/uploads/")) {
          try {
            attachmentKey = decodeURIComponent(attachmentUrl.slice("/uploads/".length));
          } catch {
            attachmentKey = null;
          }
        }
        const ownedAttachment = attachmentKey
          ? await this.env.DB.prepare(
              `SELECT r2_key
               FROM decave_attachment_access
               WHERE r2_key=? AND kind='channel' AND owner_user_id=? AND hub_id=? AND room_id=?
               LIMIT 1`,
            )
              .bind(attachmentKey, state.userId, room.hub_id, roomId)
              .first<{ r2_key: string }>()
          : null;
        if (!ownedAttachment) {
          this.send(ws, {
            type: "ERROR",
            message: "That attachment is not owned by you or is not available in this room.",
          });
          return;
        }
        attachmentKey = ownedAttachment.r2_key;
      }

      const id = crypto.randomUUID();
      const createdAt = nowIso();
      const replyToId = typeof data.replyToId === "string" ? data.replyToId : null;
      if (replyToId) {
        const replyTarget = await this.env.DB.prepare(
          "SELECT reply_to_id FROM decave_messages WHERE id=? AND room_id=? AND hub_id=? LIMIT 1",
        )
          .bind(replyToId, roomId, room.hub_id)
          .first<{ reply_to_id: string | null }>();
        if (!replyTarget) {
          this.send(ws, { type: "ERROR", message: "The message you are replying to was not found in this room." });
          return;
        }
        if (room.kind === "forum") {
          // Forum threads are one level deep: replies always target the post.
          const postState =
            replyTarget.reply_to_id === null
              ? await this.env.DB.prepare("SELECT locked FROM decave_forum_post_state WHERE message_id=? LIMIT 1")
                  .bind(replyToId)
                  .first<{ locked: number }>()
              : null;
          if (!postState) {
            this.send(ws, {
              type: "ERROR",
              message: "Forum replies must target a forum post.",
              code: "FORUM_REPLY_TARGET",
            });
            return;
          }
          if (text.startsWith(FORUM_POST_PREFIX)) {
            this.send(ws, { type: "ERROR", message: "Forum replies cannot be posts." });
            return;
          }
          if (postState.locked === 1 && !(await isForumStaff(this.env.DB, room.hub_id, state.userId!))) {
            this.send(ws, { type: "ERROR", message: "This post is locked.", code: "FORUM_POST_LOCKED" });
            return;
          }
        }
      }
      let lockForumPostOnCreate = false;
      if (room.kind !== "forum" && text.startsWith(FORUM_POST_PREFIX)) {
        this.send(ws, { type: "ERROR", message: "Forum posts can only be created in forum rooms." });
        return;
      }
      if (room.kind === "forum" && replyToId === null) {
        const payload = parseForumPostPayload(text);
        if (!payload || !payload.title.trim()) {
          this.send(ws, { type: "ERROR", message: "Forum top-level messages must be created as posts." });
          return;
        }
        if (payload.tags.length > FORUM_TAG_LIMITS.maxTagsPerPost) {
          this.send(ws, { type: "ERROR", message: `Posts can have at most ${FORUM_TAG_LIMITS.maxTagsPerPost} tags.` });
          return;
        }
        const roomTags = safeJsonStringArray(room.forum_tags_json);
        if (roomTags.length) {
          const allowed = new Set(roomTags.map((tag) => tag.toLowerCase()));
          if (payload.tags.some((tag) => !allowed.has(tag.trim().toLowerCase()))) {
            this.send(ws, {
              type: "ERROR",
              message: "Choose tags from this forum's tag list.",
              code: "FORUM_TAG_INVALID",
            });
            return;
          }
        }
        const extrasError = validateForumPostExtras(rawForumPostJson(text));
        if (extrasError) {
          this.send(ws, { type: "ERROR", message: extrasError, code: "FORUM_POST_INVALID" });
          return;
        }
        if (!(await canCreateForumPost(this.env.DB, room, state.userId!))) {
          this.send(ws, { type: "ERROR", message: "Your role cannot create posts in this forum." });
          return;
        }
        if (payload.repliesLocked && !(await isForumStaff(this.env.DB, room.hub_id, state.userId!))) {
          this.send(ws, {
            type: "ERROR",
            message: "Only forum moderators can create posts with replies turned off.",
            code: "FORUM_LOCK_FORBIDDEN",
          });
          return;
        }
        lockForumPostOnCreate = payload.repliesLocked === true;
      }
      const inserted = await this.env.DB.prepare(
        `INSERT INTO decave_messages
           (id,room_id,hub_id,author_user_id,text,created_at,reply_to_id,
            attachment_id,attachment_name,attachment_mime,attachment_size,attachment_key)
         SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ? IS NULL OR EXISTS(
           SELECT 1 FROM decave_attachment_access
           WHERE r2_key=? AND kind='channel' AND owner_user_id=? AND hub_id=? AND room_id=?
         )`,
      )
        .bind(
          id,
          roomId,
          room.hub_id,
          state.userId,
          text,
          createdAt,
          replyToId,
          typeof attachment?.id === "string" ? attachment.id : null,
          typeof attachment?.name === "string" ? attachment.name : null,
          typeof attachment?.mimeType === "string" ? attachment.mimeType : null,
          typeof attachment?.size === "number" ? attachment.size : null,
          attachmentKey,
          attachmentKey,
          attachmentKey,
          state.userId,
          room.hub_id,
          roomId,
        )
        .run();
      if (!inserted.meta.changes) {
        this.send(ws, { type: "ERROR", message: "That attachment isn't available." });
        return;
      }
      if (lockForumPostOnCreate) {
        // Row is created by trg_decave_forum_post_insert (migration 0057).
        await this.env.DB.prepare("UPDATE decave_forum_post_state SET locked=1 WHERE message_id=?").bind(id).run();
      }

      const message = await this.messageForClient(id);
      await this.broadcast({ type: "CHAT_MESSAGE", ...message }, { channelId: roomId });

      // Hub rooms and forums only (DMs and group chats never come through here).
      // A forum post is matched on its title and body, not its stored payload.
      const forumPost = room.kind === "forum" && replyToId === null ? parseForumPostPayload(text) : null;
      queueHubMessage(
        this.env,
        {
          hubId: room.hub_id,
          roomId,
          messageId: id,
          text: forumPost ? `${forumPost.title}\n${forumPost.body}`.trim() : text,
          actorId: state.userId!,
          actorIsBot: false,
          chainDepth: 0,
        },
        this.backgroundWork(),
      );

      // Room activity is an account-level notification event, not a
      // current-screen event. Send it to every online member of the Hub so
      // mentions still reach people while they are in DMs, Profile, another
      // Hub, or another room. De-duplicate user IDs so users with multiple
      // connected devices receive one broadcast pass.
      const onlineUserIds = [
        ...new Set(
          this.states()
            .map((other) => other.userId)
            .filter((userId): userId is string => !!userId && userId !== state.userId),
        ),
      ];

      // One batched pass: Hub members' roles and usernames load once, and the
      // recipients are validated together instead of once per online user.
      const activityLookup = new RealtimeLookup(this.env.DB);
      await activityLookup.loadHubMembers(room.hub_id);
      const activityTargets: string[] = [];
      for (const targetUserId of onlineUserIds) {
        if (await activityLookup.canAccessRoom(room, targetUserId)) activityTargets.push(targetUserId);
      }
      await activityLookup.loadUsers([...activityTargets, state.userId!]);
      const author = activityLookup.user(state.userId!);
      if (author && activityTargets.length) {
        const activity = {
          type: "ROOM_ACTIVITY",
          serverId: room.hub_id,
          channelId: roomId,
          channelName: room.name,
          userId: publicIdOf(author),
          username: state.username,
          messageId: id,
          timestamp: createdAt,
          text,
        };
        const plain = JSON.stringify({ ...activity, mentioned: false });
        const mentionedFrame = JSON.stringify({ ...activity, mentioned: true });
        for (const socket of await this.liveRecipients({ userIds: activityTargets })) {
          const target = activityLookup.user(this.state(socket).userId!);
          if (!target) continue;
          try {
            socket.send(messageMentions(text, target.username) ? mentionedFrame : plain);
          } catch {}
        }
      }

      // Phone notifications for members who are not connected:
      // - direct @username mentions (@everyone stays in-app so a Hub cannot
      //   page every phone), and
      // - every message for people who set this Hub or room to "All messages".
      // Each recipient's synced settings decide in the end (pushWithPolicy).
      {
        const online = new Set(onlineUserIds);
        const author = state.userId;
        const pushMessage = {
          sender: state.username ?? "Someone",
          where: `#${room.name}`,
          text,
          route: `/channel/${roomId}?hubId=${room.hub_id}&name=${encodeURIComponent(room.name)}`,
          threadId: `room-${roomId}`,
        };
        const background = (work: Promise<unknown>) => {
          if (typeof this.ctx.waitUntil === "function") this.ctx.waitUntil(work);
          else void work;
        };
        background(
          (async () => {
            const mentionTargets: string[] = [];
            if (text.includes("@")) {
              const members = await this.env.DB.prepare(
                `SELECT u.id, u.username FROM decave_hub_members hm JOIN decave_users u ON u.id=hm.user_id
                 WHERE hm.hub_id=? AND u.id<>? AND u.deleted_at IS NULL
                   AND NOT EXISTS (SELECT 1 FROM decave_user_mutes m WHERE m.muter_user_id=u.id AND m.muted_user_id=?)`,
              )
                .bind(room.hub_id, author, author)
                .all<{ id: string; username: string }>();
              for (const member of members.results) {
                if (online.has(member.id)) continue;
                if (!directMention(text, member.username)) continue;
                if (await canAccessRoom(this.env.DB, room, member.id)) mentionTargets.push(member.id);
              }
              await pushWithPolicy(
                this.env,
                mentionTargets,
                { kind: "mention", hubId: room.hub_id, roomId },
                pushMessage,
              );
            }
            let subscribers: { results: Array<{ user_id: string }> } = { results: [] };
            try {
              subscribers = await this.env.DB.prepare(
                `SELECT DISTINCT s.user_id FROM decave_push_subscriptions s
                 JOIN decave_hub_members hm ON hm.user_id=s.user_id AND hm.hub_id=?
                 WHERE (s.hub_id=? OR s.room_id=?) AND s.user_id<>?
                   AND NOT EXISTS (SELECT 1 FROM decave_user_mutes m WHERE m.muter_user_id=s.user_id AND m.muted_user_id=?)
                 LIMIT 500`,
              )
                .bind(room.hub_id, room.hub_id, roomId, author, author)
                .all<{ user_id: string }>();
            } catch {
              // Before migration 0062 nobody can subscribe to every message.
            }
            const mentioned = new Set(mentionTargets);
            const roomTargets: string[] = [];
            for (const row of subscribers.results) {
              if (online.has(row.user_id) || mentioned.has(row.user_id)) continue;
              if (await canAccessRoom(this.env.DB, room, row.user_id)) roomTargets.push(row.user_id);
            }
            await pushWithPolicy(this.env, roomTargets, { kind: "room", hubId: room.hub_id, roomId }, pushMessage);
          })().catch((error) =>
            console.warn("[push] room push failed", error instanceof Error ? error.name : "UnknownError"),
          ),
        );
      }
      return;
    }

    if (type === "DM_MESSAGE") {
      const targetReference = typeof data.targetUserId === "string" ? data.targetUserId : "";
      const clientMessageId = boundedClientMessageId(data.clientMessageId);
      const sendDmError = (payload: Record<string, unknown>) =>
        this.send(ws, {
          type: "DM_ERROR",
          targetUserId: targetReference,
          ...(clientMessageId ? { clientMessageId } : {}),
          ...payload,
        });
      const replyToId = typeof data.replyToId === "string" ? data.replyToId : null;
      const targetUser = targetReference ? await userByReference(this.env.DB, targetReference) : null;
      const targetId = targetUser?.id ?? "";
      if (!targetUser || !targetId || targetId === state.userId || targetUser.deleted_at) return;
      const pair = [state.userId, targetId].sort();
      const friend = await this.env.DB.prepare("SELECT 1 FROM decave_friendships WHERE user_a=? AND user_b=?")
        .bind(pair[0], pair[1])
        .first();
      if (!friend) {
        sendDmError({ message: "Private messages are available between friends." });
        return;
      }
      if (await isBlockedEitherDirection(this.env.DB, state.userId, targetId)) {
        sendDmError({
          message: "This user is blocked. Unblock them before sending private messages.",
        });
        return;
      }
      const sender = await this.env.DB.prepare("SELECT * FROM decave_users WHERE id=?")
        .bind(state.userId)
        .first<UserRow>();
      if (!sender) return;
      const outgoing = await checkOutgoingDm(this.env.DB, {
        enabled: dmE2eeEnabled(this.env),
        sender,
        target: targetUser,
        text: data.text,
        envelope: data.envelope,
        attachmentKeys: data.attachmentKeys,
      });
      if (!outgoing.ok) {
        // An empty plaintext message is dropped silently, as before.
        if (outgoing.code !== "DM_EMPTY") {
          const envelopeId = (data.envelope as { id?: unknown } | null | undefined)?.id;
          sendDmError({
            message: outgoing.error,
            code: outgoing.code,
            messageId: typeof envelopeId === "string" ? envelopeId : null,
          });
        }
        return;
      }
      if (replyToId) {
        const replyTarget = await this.env.DB.prepare(
          `SELECT 1
             FROM decave_direct_messages
             WHERE id=? AND ((from_user_id=? AND to_user_id=?) OR (from_user_id=? AND to_user_id=?))
             LIMIT 1`,
        )
          .bind(replyToId, state.userId, targetId, targetId, state.userId)
          .first();
        if (!replyTarget) {
          sendDmError({ message: "The message you are replying to was not found." });
          return;
        }
      }
      const messageId = outgoing.id ?? crypto.randomUUID();
      const inserted = await insertDirectMessageWithAttachmentGuard(this.env.DB, {
        id: messageId,
        fromUserId: state.userId,
        toUserId: targetId,
        text: outgoing.text,
        envelope: outgoing.envelope,
        createdAt: nowIso(),
        replyToId,
        attachmentRefs: outgoing.attachmentRefs || null,
      });
      if (!inserted.meta.changes) {
        const duplicate = await this.env.DB.prepare("SELECT 1 FROM decave_direct_messages WHERE id=? LIMIT 1")
          .bind(messageId)
          .first();
        sendDmError(
          duplicate
            ? { message: "That message was already sent.", code: "DM_DUPLICATE" }
            : { message: "That attachment isn't available.", code: "DM_E2EE_INVALID" },
        );
        return;
      }
      const message = await dmMessageForClient(this.env, messageId);
      if (!message) return;
      await this.broadcastWithClientMessageId(
        {
          type: "DM_MESSAGE",
          message,
          sender: { id: publicIdOf(sender), username: state.username },
        },
        { userIds: [state.userId, targetId] },
        state.userId,
        clientMessageId,
      );
      const targetOnline = this.states().some((other) => other.userId === targetId);
      if (!targetOnline) {
        const senderId = state.userId;
        const pushBody = dmPushText(outgoing);
        this.ctx.waitUntil(
          (async () => {
            const muted = await this.env.DB.prepare(
              "SELECT 1 FROM decave_user_mutes WHERE muter_user_id=? AND muted_user_id=?",
            )
              .bind(targetId, senderId)
              .first();
            if (muted) return;
            await pushWithPolicy(
              this.env,
              [targetId],
              { kind: "dm" },
              {
                sender: state.username ?? "New message",
                where: null,
                text: pushBody,
                route: `/dm/${encodeURIComponent(message.fromUserId)}`,
                threadId: `dm-${message.fromUserId}`,
              },
            );
          })().catch((error) =>
            console.warn("[push] DM push failed", error instanceof Error ? error.name : "UnknownError"),
          ),
        );
      }
      return;
    }

    if (type === "GROUP_MESSAGE") {
      const groupId = typeof data.groupId === "string" ? data.groupId.trim() : "";
      const clientMessageId = boundedClientMessageId(data.clientMessageId);
      const sendGroupError = (payload: Record<string, unknown>) =>
        this.send(ws, {
          type: "GROUP_ERROR",
          groupId,
          ...(clientMessageId ? { clientMessageId } : {}),
          ...payload,
        });
      const replyToId = typeof data.replyToId === "string" ? data.replyToId : null;
      const hasEnvelope = data.envelope !== undefined && data.envelope !== null;
      if (!groupId || (!hasEnvelope && !(typeof data.text === "string" && data.text.trim()))) return;
      await ensureGroupChatSchema(this.env.DB);
      if (!(await isGroupChatMember(this.env.DB, groupId, state.userId))) {
        sendGroupError({ message: "You are not a member of this group chat." });
        return;
      }

      const [sender, group, memberIds] = await Promise.all([
        this.env.DB.prepare("SELECT * FROM decave_users WHERE id=?").bind(state.userId).first<UserRow>(),
        this.env.DB.prepare("SELECT * FROM decave_group_chats WHERE id=?").bind(groupId).first<GroupChatRow>(),
        groupChatMemberIds(this.env.DB, groupId),
      ]);
      if (!sender || !group) return;
      const members = memberIds.length
        ? (
            await this.env.DB.prepare(`SELECT * FROM decave_users WHERE id IN (${memberIds.map(() => "?").join(",")})`)
              .bind(...memberIds)
              .all<UserRow>()
          ).results
        : [];
      const outgoing = await checkOutgoingGroupMessage(this.env.DB, {
        enabled: dmE2eeEnabled(this.env),
        sender,
        groupId,
        members,
        encryptedSince: group.e2ee_since ?? null,
        text: data.text,
        envelope: data.envelope,
      });
      if (!outgoing.ok) {
        const envelopeId = (data.envelope as { id?: unknown } | null | undefined)?.id;
        sendGroupError({
          message: outgoing.error,
          code: outgoing.code,
          messageId: typeof envelopeId === "string" ? envelopeId : null,
        });
        return;
      }

      if (replyToId) {
        const replyTarget = await this.env.DB.prepare(
          "SELECT 1 FROM decave_group_chat_messages WHERE id=? AND group_id=? LIMIT 1",
        )
          .bind(replyToId, groupId)
          .first();
        if (!replyTarget) {
          sendGroupError({ message: "The message you are replying to was not found." });
          return;
        }
      }

      const id = outgoing.id ?? crypto.randomUUID();
      const timestamp = nowIso();
      const statements = [
        this.env.DB.prepare(
          `INSERT INTO decave_group_chat_messages(id,group_id,from_user_id,text,created_at,reply_to_id,envelope)
             VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
        ).bind(id, groupId, state.userId, outgoing.text, timestamp, replyToId, outgoing.envelope),
        this.env.DB.prepare("UPDATE decave_group_chats SET updated_at=? WHERE id=?").bind(timestamp, groupId),
      ];
      // The first encrypted message makes the group encrypted for good.
      if (outgoing.encrypted && !group.e2ee_since) {
        statements.push(
          this.env.DB.prepare("UPDATE decave_group_chats SET e2ee_since=? WHERE id=? AND e2ee_since IS NULL").bind(
            timestamp,
            groupId,
          ),
        );
      }
      const [inserted] = await this.env.DB.batch(statements);
      if (!inserted.meta.changes) {
        sendGroupError({
          message: "That message was already sent.",
          code: "DM_DUPLICATE",
        });
        return;
      }

      const message = {
        id,
        groupId,
        fromUserId: publicIdOf(sender),
        username: sender.username,
        avatarUrl: publicUser(sender).avatarUrl,
        text: outgoing.text,
        envelope: outgoing.envelope ? parseDmEnvelope(outgoing.envelope, DM_GROUP_MAX_WRAPS) : null,
        timestamp,
        replyToId,
      };
      await this.broadcastWithClientMessageId(
        { type: "GROUP_MESSAGE", groupId, message },
        { userIds: memberIds },
        state.userId,
        clientMessageId,
      );
      return;
    }

    if (type === "DM_CALL_START") {
      const targetReference = typeof data.targetUserId === "string" ? data.targetUserId.trim() : "";
      const targetUserRecord = targetReference ? await userByReference(this.env.DB, targetReference) : null;
      if (!targetUserRecord || targetUserRecord.id === state.userId) return;
      const targetUserId = targetUserRecord.id;
      if (await isBlockedEitherDirection(this.env.DB, state.userId, targetUserId)) {
        this.send(ws, {
          type: "DM_CALL_ERROR",
          message: "This user is blocked. Unblock them before starting a direct call.",
        });
        return;
      }
      const video = data.video === true;
      if (state.voiceChannelId !== null || state.dmCallId) {
        this.send(ws, {
          type: "DM_CALL_ERROR",
          message: "Leave your current voice session before starting a direct call.",
        });
        return;
      }
      const pair = [state.userId, targetUserId].sort();
      const friend = await this.env.DB.prepare("SELECT 1 FROM decave_friendships WHERE user_a=? AND user_b=?")
        .bind(pair[0], pair[1])
        .first();
      if (!friend) {
        this.send(ws, { type: "DM_CALL_ERROR", message: "Direct calls are available between friends." });
        return;
      }
      // Ring every idle device the friend is signed in on; the first to accept takes the call.
      const targets = [];
      for (const candidate of await this.directCallSockets(targetUserId)) {
        if (await this.socketIsLive(candidate)) targets.push(candidate);
      }
      if (!targets.length) {
        this.send(ws, {
          type: "DM_CALL_ERROR",
          message: (await this.userIsInCall(targetUserId))
            ? "This friend is already in another call."
            : "This friend is offline.",
          peer: { userId: publicIdOf(targetUserRecord), username: targetUserRecord.username },
        });
        return;
      }
      const targetUser = await this.env.DB.prepare("SELECT * FROM decave_users WHERE id=?")
        .bind(targetUserId)
        .first<UserRow>();
      if (!targetUser || targetUser.status === "invisible") {
        this.send(ws, { type: "DM_CALL_ERROR", message: "This friend is offline." });
        return;
      }
      const callId = crypto.randomUUID();
      // The caller binds to one of the friend's devices only once it accepts.
      const callerNext = {
        ...state,
        dmCallId: callId,
        dmCallPeerUserId: targetUserId,
        dmCallPeerConnectionId: null,
        dmCallIncoming: false,
        dmCallAccepted: false,
        dmCallVideo: video,
      };
      this.attach(ws, callerNext);
      const caller = await this.callParticipant(callerNext);
      let peer = null;
      for (const target of targets) {
        const targetNext = {
          ...this.state(target),
          dmCallId: callId,
          dmCallPeerUserId: state.userId,
          dmCallPeerConnectionId: state.connectionId,
          dmCallIncoming: true,
          dmCallAccepted: false,
          dmCallVideo: video,
        };
        this.attach(target, targetNext);
        peer ??= await this.callParticipant(targetNext);
      }
      this.send(ws, { type: "DM_CALL_RINGING", callId, video, peer });
      for (const target of targets) await this.sendToLive(target, { type: "DM_CALL_INCOMING", callId, video, caller });
      return;
    }

    if (type === "DM_CALL_ACCEPT") {
      if (!state.dmCallId || !state.dmCallPeerUserId) return;
      if (!state.dmCallIncoming) {
        this.send(ws, { type: "DM_CALL_ERROR", message: "Only the recipient can accept this call." });
        return;
      }
      const peerSocket = state.dmCallPeerConnectionId
        ? this.socketByConnectionId(state.dmCallPeerConnectionId)
        : await this.socketByUserId(state.dmCallPeerUserId);
      if (!peerSocket) {
        await this.endDirectCall(ws, state, "peer-offline");
        return;
      }
      if (!(await this.socketIsLive(peerSocket))) {
        await this.endDirectCall(ws, state, "peer-offline");
        return;
      }
      const peerState = this.state(peerSocket);
      if (peerState.dmCallId !== state.dmCallId || peerState.dmCallPeerUserId !== state.userId) return;
      if (peerState.dmCallAccepted) return; // Another of this user's devices already answered.
      const selfNext = { ...state, dmCallIncoming: false, dmCallAccepted: true };
      const peerNext = {
        ...peerState,
        dmCallPeerConnectionId: state.connectionId,
        dmCallIncoming: false,
        dmCallAccepted: true,
      };
      this.attach(ws, selfNext);
      this.attach(peerSocket, peerNext);
      // Stop the call ringing on this user's other devices.
      for (const other of this.ctx.getWebSockets()) {
        if (other === ws) continue;
        const otherState = this.state(other);
        if (otherState.userId !== state.userId || otherState.dmCallId !== state.dmCallId) continue;
        this.attach(other, this.withoutDirectCall(otherState));
        await this.sendToLive(other, { type: "DM_CALL_ENDED", callId: state.dmCallId, reason: "answered-elsewhere" });
      }
      this.send(ws, {
        type: "DM_CALL_ACCEPTED",
        callId: state.dmCallId,
        video: state.dmCallVideo,
        peer: await this.callParticipant(peerNext),
      });
      await this.sendToLive(peerSocket, {
        type: "DM_CALL_ACCEPTED",
        callId: state.dmCallId,
        video: state.dmCallVideo,
        peer: await this.callParticipant(selfNext),
      });
      return;
    }

    if (type === "DM_CALL_UPGRADE_VIDEO") {
      if (!state.dmCallId || !state.dmCallAccepted || !state.dmCallPeerUserId) return;
      const peerSocket = state.dmCallPeerConnectionId ? this.socketByConnectionId(state.dmCallPeerConnectionId) : null;
      if (!peerSocket) return;
      if (!(await this.socketIsLive(peerSocket))) return;
      const peerState = this.state(peerSocket);
      if (
        !peerState.dmCallAccepted ||
        peerState.dmCallId !== state.dmCallId ||
        peerState.dmCallPeerConnectionId !== state.connectionId
      )
        return;
      const selfNext = { ...state, dmCallVideo: true };
      const peerNext = { ...peerState, dmCallVideo: true };
      this.attach(ws, selfNext);
      this.attach(peerSocket, peerNext);
      const event = {
        type: "DM_CALL_VIDEO_UPGRADED",
        callId: state.dmCallId,
        requestedByConnectionId: state.connectionId,
      };
      this.send(ws, event);
      await this.sendToLive(peerSocket, event);
      return;
    }

    if (type === "DM_CALL_DECLINE") {
      if (state.dmCallId) await this.endDirectCall(ws, state, "declined");
      return;
    }

    if (type === "DM_CALL_END") {
      if (state.dmCallId) await this.endDirectCall(ws, state, "ended");
      return;
    }

    if (type === "VOICE_JOIN") {
      const room = await getRoom(this.env.DB, Number(data.channelId));
      if (!room || room.type !== "voice" || !(await canAccessRoom(this.env.DB, room, state.userId))) {
        this.send(ws, { type: "VOICE_ERROR", message: "Voice room not found" });
        return;
      }
      if (await isTimedOut(this.env.DB, room.hub_id, state.userId)) {
        this.send(ws, { type: "VOICE_ERROR", message: "You are currently timed out in this Hub.", code: "TIMED_OUT" });
        return;
      }
      const configuredCap = Number((room as { user_limit?: number }).user_limit ?? 0);
      const cap = configuredCap > 0 ? configuredCap : DEFAULT_VOICE_ROOM_LIMIT;
      const inside = new Set(
        this.states()
          .filter((other) => other.voiceChannelId === room.id && other.userId && other.userId !== state.userId)
          .map((other) => other.userId),
      );
      if (inside.size >= cap) {
        const role = await getRole(this.env.DB, room.hub_id, state.userId!);
        if (role !== "owner" && role !== "admin") {
          this.send(ws, { type: "VOICE_ERROR", message: `This room is full (${cap}/${cap}).`, code: "ROOM_FULL" });
          return;
        }
      }
      const voiceBefore = voiceRoomsOf(this.states(), state.userId!);
      const previousVoiceHub = state.voiceChannelId === null ? null : await this.hubOfRoom(state.voiceChannelId);
      // DECAVE_PARITY_VOICE_HANDOFF: the newest client wins if this account joins the same voice room elsewhere.
      for (const other of this.ctx.getWebSockets()) {
        if (other === ws) continue;
        const otherState = this.state(other);
        if (otherState.userId === state.userId && otherState.voiceChannelId === room.id)
          await this.leaveVoice(other, otherState, true, false);
      }
      if (state.voiceChannelId !== null) {
        await this.broadcast(
          { type: "VOICE_PEER_LEFT", connectionId: state.connectionId },
          { voiceChannelId: state.voiceChannelId, exceptConnectionId: state.connectionId },
        );
      }
      state = {
        ...this.releaseScreenSfu(state),
        serverId: room.hub_id,
        voiceChannelId: room.id,
        voiceMuted: false,
        voiceDeafened: false,
        voiceServerMuted: false,
        voiceServerDeafened: false,
        screenSharing: false,
        allowStreamPreview: true,
        cameraSharing: false,
      };
      this.attach(ws, state);
      const participant = await this.participant(state);
      if (participant?.userId) {
        state = { ...this.state(ws), publicUserId: participant.userId };
        this.attach(ws, state);
      }
      const peers = [];
      for (const peerState of this.states()) {
        if (peerState.connectionId !== state.connectionId && peerState.voiceChannelId === room.id) {
          peers.push(await this.participant(peerState));
        }
      }
      // screenSfu: whether this call offers SFU screen share (kill switch); absent/false = mesh only.
      this.send(ws, {
        type: "VOICE_JOINED",
        channelId: room.id,
        participant,
        peers,
        screenSfu: screenSfuEnabled(this.env),
      });
      await this.broadcast(
        { type: "VOICE_PEER_JOINED", participant },
        { voiceChannelId: room.id, exceptConnectionId: state.connectionId },
      );
      await this.broadcastVoiceState(room.hub_id);
      if (previousVoiceHub && previousVoiceHub !== room.hub_id) await this.broadcastVoiceState(previousVoiceHub);
      this.voiceBotEvents(state.userId!, voiceBefore);
      return;
    }

    if (type === "VOICE_STATE_REQUEST") {
      await this.sendVoiceState(ws, state.userId);
      return;
    }

    if (type === "VOICE_LEAVE") {
      await this.leaveVoice(ws, state, true);
      return;
    }

    if (type === "VOICE_MUTE") {
      if (state.voiceMuted === (data.muted === true)) return;
      state = { ...state, voiceMuted: data.muted === true };
      this.attach(ws, state);
      await this.broadcastVoiceState(await this.hubOfRoom(state.voiceChannelId));
      return;
    }

    if (type === "VOICE_DEAFEN") {
      if (state.voiceDeafened === (data.deafened === true)) return;
      state = { ...state, voiceDeafened: data.deafened === true };
      this.attach(ws, state);
      await this.broadcastVoiceState(await this.hubOfRoom(state.voiceChannelId));
      return;
    }

    if (type === "VOICE_SCREEN_STATE") {
      if (data.screenSharing === true && !(await this.voiceMediaAllowed(ws, state))) return;
      const sharing = data.screenSharing === true;
      // The display stream id lets viewers tell screen audio from voice; a
      // message without one (e.g. a preview toggle) keeps the current id.
      const advertised =
        typeof data.screenStreamId === "string" && data.screenStreamId.length > 0 && data.screenStreamId.length <= 128
          ? data.screenStreamId
          : null;
      const screenStreamId = sharing ? (advertised ?? state.screenStreamId ?? null) : null;
      if (
        state.screenSharing === sharing &&
        state.allowStreamPreview === (data.allowStreamPreview !== false) &&
        (state.screenStreamId ?? null) === screenStreamId
      )
        return;
      state = {
        // Sharing ended: drop the SFU publish too, in case its RTC_SFU_STOP was lost.
        ...(!sharing && state.screenSfu ? this.releaseScreenSfu(state, true) : state),
        screenSharing: sharing,
        screenStreamId,
        allowStreamPreview: data.allowStreamPreview !== false,
      };
      this.attach(ws, state);
      await this.broadcastVoiceState(await this.hubOfRoom(state.voiceChannelId));
      return;
    }

    if (type === "VOICE_SOUNDBOARD_PLAY") {
      if (state.voiceChannelId === null) return;
      const voiceRoom = await getRoom(this.env.DB, state.voiceChannelId);
      if (!voiceRoom) return;
      if (!(await this.voiceMediaAllowed(ws, state))) return;
      const soundId = typeof data.soundId === "string" ? data.soundId.trim() : "";
      if (!soundId || soundId.length > 80) return;
      try {
        await this.env.DB.prepare(
          `CREATE TABLE IF NOT EXISTS decave_soundboard_sounds (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            hub_id INTEGER,
            name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            r2_key TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE,
            FOREIGN KEY(hub_id) REFERENCES decave_hubs(id) ON DELETE CASCADE
          )`,
        ).run();
        const sound = await this.env.DB.prepare(
          "SELECT id,name FROM decave_soundboard_sounds WHERE id=? AND hub_id=? LIMIT 1",
        )
          .bind(soundId, voiceRoom.hub_id)
          .first<{ id: string; name: string }>();
        if (!sound) {
          this.send(ws, { type: "VOICE_ERROR", message: "That soundboard sound is unavailable." });
          return;
        }
        await this.broadcast(
          {
            type: "VOICE_SOUNDBOARD_PLAY",
            soundId: sound.id,
            name: sound.name,
            username: state.username,
            connectionId: state.connectionId,
            url: `/api/soundboard/${encodeURIComponent(sound.id)}/media`,
          },
          { voiceChannelId: state.voiceChannelId },
        );
      } catch {
        this.send(ws, { type: "VOICE_ERROR", message: "Soundboard is unavailable right now." });
      }
      return;
    }

    if (type === "VOICE_CAMERA_STATE") {
      if (data.cameraSharing === true && !(await this.voiceMediaAllowed(ws, state))) return;
      if (state.cameraSharing === (data.cameraSharing === true)) return;
      state = { ...state, cameraSharing: data.cameraSharing === true };
      this.attach(ws, state);
      await this.broadcastVoiceState(await this.hubOfRoom(state.voiceChannelId));
      return;
    }

    if (type.startsWith("RTC_SFU_")) {
      await this.handleScreenSfu(ws, state, type, data);
      return;
    }

    if (type === "VOICE_SFU_CAPABLE") {
      // Kill switch off: nobody is SFU-capable, so sharers keep sending mesh to everyone.
      const capable = data.capable === true && screenSfuEnabled(this.env);
      if (state.voiceChannelId === null || state.sfuScreenCapable === capable) return;
      state = { ...state, sfuScreenCapable: capable };
      this.attach(ws, state);
      await this.broadcastVoiceState(await this.hubOfRoom(state.voiceChannelId));
      return;
    }

    // Sealed stream keys and key / mesh-fallback requests: same voice room only.
    if (type === "RTC_SCREEN_KEY" || type === "RTC_SCREEN_KEY_REQUEST" || type === "RTC_SCREEN_MESH_REQUEST") {
      const targetConnectionId = typeof data.targetConnectionId === "string" ? data.targetConnectionId : "";
      const target = this.socketByConnectionId(targetConnectionId);
      if (!target) return;
      if (!(await this.socketIsLive(target))) return;
      const targetState = this.state(target);
      if (state.voiceChannelId === null || targetState.voiceChannelId !== state.voiceChannelId) return;
      const key = type === "RTC_SCREEN_KEY" ? keyRelayPayload(data) : null;
      if (type === "RTC_SCREEN_KEY" && !key) return;
      let fromUserId = state.publicUserId ?? "";
      if (!fromUserId) {
        const sender = await this.env.DB.prepare("SELECT * FROM decave_users WHERE id=?")
          .bind(state.userId)
          .first<UserRow>();
        if (!sender) return;
        fromUserId = publicIdOf(sender);
      }
      await this.sendToLive(target, {
        type,
        fromConnectionId: state.connectionId,
        fromUserId,
        ...(key ?? {}),
      });
      return;
    }

    // A viewer tells a sharer whether it is watching their screen, so the
    // sharer sends full quality only to viewers who are actually watching.
    if (type === "RTC_SCREEN_WATCH") {
      const targetConnectionId = typeof data.targetConnectionId === "string" ? data.targetConnectionId : "";
      const target = this.socketByConnectionId(targetConnectionId);
      if (!target) return;
      if (!(await this.socketIsLive(target))) return;
      const targetState = this.state(target);
      if (state.voiceChannelId === null || targetState.voiceChannelId !== state.voiceChannelId) return;
      await this.sendToLive(target, {
        type,
        fromConnectionId: state.connectionId,
        watching: data.watching === true,
      });
      return;
    }

    if (type === "RTC_DESCRIPTION" || type === "RTC_ICE_CANDIDATE") {
      const targetConnectionId = typeof data.targetConnectionId === "string" ? data.targetConnectionId : "";
      const target = this.socketByConnectionId(targetConnectionId);
      if (!target) return;
      if (!(await this.socketIsLive(target))) return;
      const targetState = this.state(target);
      const sameVoiceRoom = state.voiceChannelId !== null && targetState.voiceChannelId === state.voiceChannelId;
      const sameDirectCall = Boolean(
        state.dmCallId &&
        state.dmCallAccepted &&
        targetState.dmCallAccepted &&
        targetState.dmCallId === state.dmCallId &&
        state.dmCallPeerUserId === targetState.userId &&
        targetState.dmCallPeerUserId === state.userId &&
        state.dmCallPeerConnectionId === targetState.connectionId &&
        targetState.dmCallPeerConnectionId === state.connectionId, // DECAVE_PARITY_RTC_PEER_BINDING
      );
      if (!sameVoiceRoom && !sameDirectCall) return;
      if (type === "RTC_ICE_CANDIDATE" && !isRelayCandidatePayload(data.candidate)) return;
      const from = sameVoiceRoom ? await this.participant(state) : await this.callParticipant(state);
      if (!from) return;
      // `auth` is the sender's account-key signature over the description's DTLS
      // fingerprints (shared/dm-e2ee.ts); the receiver checks it, the server only passes it on.
      const auth = type === "RTC_DESCRIPTION" ? rtcDescriptionAuth(data.auth) : null;
      await this.sendToLive(target, {
        type,
        from,
        ...(type === "RTC_DESCRIPTION"
          ? { description: data.description, ...(auth ? { auth } : {}) }
          : { candidate: data.candidate }),
      });
      return;
    }

    if (type === "VOICE_MODERATE") {
      const targetConnectionId = typeof data.targetConnectionId === "string" ? data.targetConnectionId : "";
      const action = typeof data.action === "string" ? data.action : "";
      const target = this.socketByConnectionId(targetConnectionId);
      if (!target) return;
      if (!(await this.socketIsLive(target))) return;
      const targetState = this.state(target);
      if (state.voiceChannelId === null || targetState.voiceChannelId !== state.voiceChannelId) return;
      const room = await getRoom(this.env.DB, state.voiceChannelId);
      if (!room) return;
      const actorRole = await getRole(this.env.DB, room.hub_id, state.userId);
      const targetRole = targetState.userId ? await getRole(this.env.DB, room.hub_id, targetState.userId) : null;
      const custom = await hasPermission(this.env.DB, room.hub_id, state.userId, "voiceModerate");
      const allowed =
        actorRole === "owner"
          ? targetRole === "admin" || targetRole === "member"
          : actorRole === "admin"
            ? targetRole === "member"
            : custom && targetRole === "member";
      if (!allowed) return;

      if (action === "kick") {
        await this.leaveVoice(target, targetState, true);
        return;
      }
      const next = { ...targetState };
      if (action === "mute") next.voiceServerMuted = true;
      if (action === "unmute") next.voiceServerMuted = false;
      if (action === "deafen") next.voiceServerDeafened = true;
      if (action === "undeafen") next.voiceServerDeafened = false;
      this.attach(target, next);
      await this.sendToLive(target, {
        type: "VOICE_MODERATION_STATE",
        serverMuted: next.voiceServerMuted,
        serverDeafened: next.voiceServerDeafened,
      });
      await this.broadcastVoiceState(await this.hubOfRoom(next.voiceChannelId));
      return;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const state = this.state(ws);
    this.realtimeRate.delete(state.connectionId);
    this.peerAddressByConnection.delete(state.connectionId);
    if (state.userId) await touchRealtimePresence(this.env.DB, state.userId);
    if (state.voiceChannelId !== null) {
      const voiceBefore = state.userId ? voiceRoomsOf(this.states(), state.userId) : null;
      // Clear the voice binding before rebroadcasting: the closing socket can
      // still be returned by getWebSockets() during this handler, which used to
      // leave a ghost participant in VOICE_STATE.
      try {
        this.attach(ws, {
          ...this.releaseScreenSfu(state),
          voiceChannelId: null,
          screenSharing: false,
          screenStreamId: null,
          cameraSharing: false,
        });
      } catch {}
      if (voiceBefore && state.userId) this.voiceBotEvents(state.userId, voiceBefore);
      await this.broadcast(
        { type: "VOICE_PEER_LEFT", connectionId: state.connectionId },
        { voiceChannelId: state.voiceChannelId, exceptConnectionId: state.connectionId },
      );
    } else this.releaseScreenSfu(state);
    if (state.dmCallId) {
      await this.endDirectCall(ws, { ...state, voiceChannelId: null }, "peer-offline");
    }
    await this.presenceChanged(state, { gone: true });
    if (state.voiceChannelId !== null) await this.broadcastVoiceState(await this.hubOfRoom(state.voiceChannelId));
    await this.refreshDeadlineAlarm();
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  /**
   * Connected accounts that are not invisible. Member lists, profile broadcasts
   * and Hub online counts all ask this; one answer per ONLINE_USERS_CACHE_MS
   * instead of re-reading every connected account each time.
   */
  private async visibleOnlineUserIds(): Promise<Set<string>> {
    if (!this.onlineUsersCache || Date.now() - this.onlineUsersCache.at > ONLINE_USERS_CACHE_MS) {
      const connected = new Set(
        this.states()
          .map((x) => x.userId)
          .filter((x): x is string => !!x),
      );
      this.onlineUsersCache = { at: Date.now(), userIds: [...(await this.visibleConnectedUserIds([...connected]))] };
    }
    return new Set(this.onlineUsersCache.userIds);
  }

  private async visibleConnectedUserIds(userIds: string[]): Promise<Set<string>> {
    const visible = new Set<string>();
    for (let offset = 0; offset < userIds.length; offset += 90) {
      const chunk = userIds.slice(offset, offset + 90);
      const users = await this.env.DB.prepare(
        `SELECT id,status FROM decave_users WHERE id IN (${chunk.map(() => "?").join(",")})`,
      )
        .bind(...chunk)
        .all<{ id: string; status: UserRow["status"] }>();
      for (const user of users.results) if (presenceOnline(user, true)) visible.add(user.id);
    }
    return visible;
  }

  // Parsed attachments, so fan-out over every socket doesn't structured-clone
  // each attachment again. Every write goes through attach(); after
  // hibernation the map starts empty and refills on first read.
  private stateCache = new WeakMap<WebSocket, SocketState>();

  private attach(ws: WebSocket, value: SocketState): void {
    ws.serializeAttachment(value);
    this.stateCache.set(ws, value);
  }

  private state(ws: WebSocket): SocketState {
    const cached = this.stateCache.get(ws);
    if (cached) return cached;
    const state = this.readState(ws);
    this.stateCache.set(ws, state);
    return state;
  }

  private readState(ws: WebSocket): SocketState {
    const attached = ws.deserializeAttachment() as (Partial<SocketState> & { peerAddress?: unknown }) | null;
    if (attached) {
      // Remove address pseudonyms from attachments written by older versions.
      const { peerAddress: legacyPeerAddress, ...withoutPeerAddress } = attached;
      const authenticated = typeof attached.userId === "string" && attached.userId.length > 0;
      const authDeadlineAt = authenticated
        ? 0
        : typeof attached.authDeadlineAt === "number" &&
            Number.isSafeInteger(attached.authDeadlineAt) &&
            attached.authDeadlineAt > 0
          ? attached.authDeadlineAt
          : Date.now() + WS_AUTH_DEADLINE_MS;
      const normalized = {
        ...EMPTY_SFU_FIELDS,
        ...withoutPeerAddress,
        sessionHash: typeof attached.sessionHash === "string" ? attached.sessionHash : null,
        authDeadlineAt,
        identifyFailures:
          typeof attached.identifyFailures === "number" &&
          Number.isSafeInteger(attached.identifyFailures) &&
          attached.identifyFailures >= 0
            ? attached.identifyFailures
            : 0,
        rateLimitViolations:
          typeof attached.rateLimitViolations === "number" &&
          Number.isSafeInteger(attached.rateLimitViolations) &&
          attached.rateLimitViolations >= 0
            ? attached.rateLimitViolations
            : 0,
      } as SocketState;
      if (attached.authDeadlineAt !== authDeadlineAt || legacyPeerAddress !== undefined) {
        try {
          this.attach(ws, normalized);
        } catch {}
      }
      return normalized;
    }
    return {
      connectionId: crypto.randomUUID(),
      client: "web",
      userId: null,
      sessionHash: null,
      username: null,
      serverId: 0,
      channelId: 0,
      authDeadlineAt: 0,
      voiceChannelId: null,
      voiceMuted: false,
      voiceDeafened: false,
      voiceServerMuted: false,
      voiceServerDeafened: false,
      screenSharing: false,
      screenStreamId: null,
      allowStreamPreview: true,
      cameraSharing: false,
      dmCallId: null,
      dmCallPeerUserId: null,
      dmCallPeerConnectionId: null,
      dmCallIncoming: false,
      dmCallAccepted: false,
      dmCallVideo: false,
      identifiedAt: 0,
      identifyFailures: 0,
      rateLimitViolations: 0,
      lastPresenceTouchAt: 0,
      ...EMPTY_SFU_FIELDS,
    };
  }

  private states(): SocketState[] {
    return this.ctx.getWebSockets().map((ws) => this.state(ws));
  }

  private send(ws: WebSocket, payload: unknown): void {
    try {
      ws.send(JSON.stringify(payload));
    } catch {}
  }

  /** Last-mile check for one authenticated recipient used by private side channels. */
  private async socketIsLive(ws: WebSocket): Promise<boolean> {
    const state = this.state(ws);
    if (!state.userId || !state.sessionHash) {
      this.revokeSocket(ws, "session_revoked");
      return false;
    }
    const active = await this.sessionIsActive(state);
    if (active === true) return true;
    this.revokeSocket(ws, active === "unavailable" ? "session_validation_unavailable" : "session_revoked");
    return false;
  }

  /** Cached isActiveSession (see SESSION_RECHECK_MS). */
  private async sessionIsActive(state: SocketState): Promise<boolean | "unavailable"> {
    if (!state.userId || !state.sessionHash) return false;
    const cached = this.sessionValidity.fresh(state.sessionHash);
    if (cached !== undefined) return cached;
    try {
      const live = await isActiveSession(this.env, state.userId, state.sessionHash);
      this.sessionValidity.set(state.sessionHash, live);
      return live;
    } catch {
      return "unavailable";
    }
  }

  private async sendToLive(ws: WebSocket, payload: unknown): Promise<boolean> {
    if (!(await this.socketIsLive(ws))) return false;
    this.send(ws, payload);
    return true;
  }

  private matches(state: SocketState, filter: Filter): boolean {
    if (filter.exceptConnectionId && state.connectionId === filter.exceptConnectionId) return false;
    if (filter.userIds && (!state.userId || !this.idSet(filter.userIds).has(state.userId))) return false;
    if (filter.sessionHashes && (!state.sessionHash || !filter.sessionHashes.includes(state.sessionHash))) return false;
    if (filter.hubId !== undefined && state.serverId !== filter.hubId) return false;
    if (filter.channelId !== undefined && state.channelId !== filter.channelId) return false;
    if (filter.voiceChannelId !== undefined && state.voiceChannelId !== filter.voiceChannelId) return false;
    return true;
  }

  // Broadcast filters can list thousands of ids; match against a Set built once per filter.
  private idSets = new WeakMap<string[], Set<string>>();
  private idSet(ids: string[]): Set<string> {
    let set = this.idSets.get(ids);
    if (!set) this.idSets.set(ids, (set = new Set(ids)));
    return set;
  }

  private revokeSocket(ws: WebSocket, reason: string): void {
    this.sessionValidity.forget(this.state(ws).sessionHash);
    this.send(ws, { type: "SESSION_REVOKED", reason });
    // Closing invokes webSocketClose, which clears voice/call state and
    // rebroadcasts presence for hibernated as well as in-memory sockets.
    try {
      ws.close(4001, "Session revoked");
    } catch {}
  }

  /**
   * Validate recipients before any server event delivery. Sessions are
   * re-checked against D1 in bounded batches at most every SESSION_RECHECK_MS;
   * explicit revocations close sockets directly. If D1 is unavailable, sockets
   * whose session was last known live keep receiving events and nobody is
   * disconnected for an outage.
   */
  private async liveRecipients(filter: Filter): Promise<WebSocket[]> {
    const keyed: { ws: WebSocket; state: SocketState }[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const state = this.state(ws);
      if (state.userId && this.matches(state, filter)) keyed.push({ ws, state });
    }
    const now = Date.now();
    const stale = [
      ...new Set(
        keyed
          .map(({ state }) => state.sessionHash)
          .filter((value): value is string => !!value && this.sessionValidity.fresh(value, now) === undefined),
      ),
    ];
    let unavailable = false;
    try {
      for (let offset = 0; offset < stale.length; offset += 90) {
        const chunk = stale.slice(offset, offset + 90);
        const rows = await this.env.DB.prepare(
          `SELECT s.token_hash FROM decave_sessions s
           JOIN decave_users u ON u.id=s.user_id
           WHERE s.token_hash IN (${chunk.map(() => "?").join(",")}) AND s.expires_at>?
             AND u.erased_at IS NULL AND u.deleted_at IS NULL AND u.must_reset_password=0
             AND u.erasure_started_at IS NULL
             AND (u.suspended_at IS NULL OR (u.suspended_until IS NOT NULL AND u.suspended_until<=?))`,
        )
          .bind(...chunk, nowIso(), nowIso())
          .all<{ token_hash: string }>();
        const live = new Set(rows.results.map((row) => row.token_hash));
        for (const hash of chunk) this.sessionValidity.set(hash, live.has(hash), now);
      }
    } catch {
      unavailable = true;
    }
    const result: WebSocket[] = [];
    for (const { ws, state } of keyed) {
      const hash = state.sessionHash;
      const live = hash
        ? unavailable
          ? this.sessionValidity.lastKnown(hash)
          : this.sessionValidity.fresh(hash, now)
        : false;
      if (live) result.push(ws);
      else if (!unavailable || live === false) this.revokeSocket(ws, "session_revoked");
    }
    return result;
  }

  private async broadcast(payload: unknown, filter: Filter = {}): Promise<void> {
    const encoded = JSON.stringify(payload);
    for (const ws of await this.liveRecipients(filter)) {
      try {
        ws.send(encoded);
      } catch {}
    }
  }

  private async broadcastWithClientMessageId(
    payload: Record<string, unknown>,
    filter: Filter,
    senderUserId: string,
    clientMessageId: string | null,
  ): Promise<void> {
    const recipients = await this.liveRecipients(filter);
    for (const ws of recipients) {
      const socketState = this.state(ws);
      const recipientPayload =
        clientMessageId && socketState.userId === senderUserId ? { ...payload, clientMessageId } : payload;
      try {
        ws.send(JSON.stringify(recipientPayload));
      } catch {}
    }
  }

  private socketByConnectionId(id: string): WebSocket | null {
    return this.ctx.getWebSockets().find((ws) => this.state(ws).connectionId === id) ?? null;
  }

  private async socketByUserId(userId: string): Promise<WebSocket | null> {
    return (await this.liveRecipients({ userIds: [userId] }))[0] ?? null;
  }

  /** Every idle device a user is signed in on, newest first. */
  private async directCallSockets(userId: string): Promise<WebSocket[]> {
    const candidates = (await this.liveRecipients({ userIds: [userId] })).filter((candidate) => {
      const s = this.state(candidate);
      return s.userId === userId && s.voiceChannelId === null && !s.dmCallId;
    });
    candidates.sort((a, b) => Number(this.state(b).identifiedAt || 0) - Number(this.state(a).identifiedAt || 0));
    return candidates;
  } // DECAVE_PARITY_CALL_ROUTE

  private async userIsInCall(userId: string): Promise<boolean> {
    return (await this.liveRecipients({ userIds: [userId] })).some((candidate) => {
      const s = this.state(candidate);
      return s.userId === userId && (s.voiceChannelId !== null || !!s.dmCallId);
    });
  }

  private withoutDirectCall(state: SocketState): SocketState {
    return {
      ...state,
      dmCallId: null,
      dmCallPeerUserId: null,
      dmCallPeerConnectionId: null,
      dmCallIncoming: false,
      dmCallAccepted: false,
      dmCallVideo: false,
      cameraSharing: false,
    };
  }

  /** Full online roster for one socket (sent once after IDENTIFY). */
  private async sendRoster(ws: WebSocket): Promise<void> {
    const viewer = this.state(ws);
    if (!viewer.userId) return;
    const lookup = new RealtimeLookup(this.env.DB, this.directory);
    const states = (await this.liveRecipients({})).map((socket) => this.state(socket));
    await this.sendToLive(ws, { type: "USERS_UPDATE", users: await this.rosterFor(viewer, states, lookup) });
  }

  private async rosterFor(viewer: SocketState, states: SocketState[], lookup: RealtimeLookup) {
    if (!viewer.userId) return [];
    await lookup.loadFriends([viewer.userId]);
    const friends = lookup.friends(viewer.userId);
    const candidates = states.filter(
      (st) =>
        st.userId &&
        (st.userId === viewer.userId ||
          friends.has(st.userId) ||
          Boolean(viewer.serverId && st.serverId === viewer.serverId)),
    );
    await lookup.loadUsers(candidates.map((st) => st.userId!));
    // Roles of everyone listed (and the viewer's own) in one batched pass.
    await lookup.loadMembershipsOf([viewer.userId, ...candidates.map((st) => st.userId!)]);
    await lookup.loadRooms(candidates.map((st) => st.channelId));
    const users = [];
    for (const st of candidates) {
      const entry = await lookup.rosterEntry({ userId: viewer.userId, serverId: viewer.serverId }, st as RosterSocket);
      if (entry) users.push(entry);
    }
    return users;
  }

  /**
   * One connection appeared, moved Hub/room, or closed. Changes are queued and
   * applied together every PRESENCE_FLUSH_MS, so a burst of N connects costs
   * one batched pass and one frame per viewer instead of N of each.
   */
  private async presenceChanged(
    changed: SocketState,
    options: { previousServerId?: number; gone?: boolean } = {},
  ): Promise<void> {
    if (!changed.userId) return;
    const pending = this.pendingPresence.get(changed.connectionId);
    const previousHubs = pending?.previousHubs ?? new Set<number>();
    if (options.previousServerId) previousHubs.add(options.previousServerId);
    this.pendingPresence.set(changed.connectionId, { state: changed, gone: options.gone === true, previousHubs });
    if (this.presenceTimer) return;
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      this.inBackground(
        this.flushPresence().catch((error) =>
          console.error("Presence flush failed", error instanceof Error ? error.name : "UnknownError"),
        ),
      );
    }, PRESENCE_FLUSH_MS);
  }

  /**
   * Tell only viewers who can be affected: the account's own devices, its
   * friends, and sockets viewing a Hub the account is (or just was) in.
   * Clients that announced "presence-diff" get one USERS_DIFF with every
   * changed connection plus the accounts' presence for member/friend lists;
   * older clients get a coalesced full USERS_UPDATE.
   */
  private async flushPresence(): Promise<void> {
    if (this.presenceTimer) {
      clearTimeout(this.presenceTimer);
      this.presenceTimer = null;
    }
    const changes = [...this.pendingPresence.values()];
    this.pendingPresence = new Map();
    if (!changes.length) return;
    const goneIds = new Set(changes.filter((c) => c.gone).map((c) => c.state.connectionId));
    const live = (await this.liveRecipients({}))
      .map((socket) => ({ socket, st: this.state(socket) }))
      .filter(({ st }) => !goneIds.has(st.connectionId));
    const lookup = new RealtimeLookup(this.env.DB, this.directory);
    const changedUsers = [...new Set(changes.map((c) => c.state.userId!))];
    await lookup.loadUsers(changedUsers);
    await lookup.loadFriends(changedUsers);
    await lookup.loadMembershipsOf(changedUsers);
    const connected = new Set(live.map(({ st }) => st.userId));
    const audiences = changes.map((change) => {
      const userId = change.state.userId!;
      const hubs = new Set([...lookup.hubs(userId), ...change.previousHubs]);
      if (change.state.serverId) hubs.add(change.state.serverId);
      return { change, userId, hubs, friends: lookup.friends(userId) };
    });
    const viewers = live.filter(({ st }) =>
      audiences.some(
        (a) => st.userId && (st.userId === a.userId || a.friends.has(st.userId) || a.hubs.has(st.serverId)),
      ),
    );
    if (!viewers.length) return;
    await lookup.loadFriends(viewers.map(({ st }) => st.userId!));
    for (const hubId of new Set(changes.map((c) => c.state.serverId))) await lookup.loadHubMembers(hubId);
    await lookup.loadRooms(changes.map((c) => c.state.channelId));
    const legacy: string[] = [];
    for (const { socket, st } of viewers) {
      if (!st.presenceDiff) {
        legacy.push(st.connectionId);
        continue;
      }
      const upsert: RosterEntry[] = [];
      const remove: string[] = [];
      const presence: PresenceHint[] = [];
      for (const { change, userId, hubs, friends } of audiences) {
        if (st.userId !== userId && !friends.has(st.userId!) && !hubs.has(st.serverId)) continue;
        const entry = change.gone
          ? null
          : await lookup.rosterEntry({ userId: st.userId!, serverId: st.serverId }, change.state as RosterSocket);
        if (entry) upsert.push(entry);
        else remove.push(change.state.connectionId);
        const hint = lookup.presenceHint(st.userId!, userId, connected.has(userId));
        if (hint && !presence.some((p) => p.userId === hint.userId)) presence.push(hint);
      }
      this.send(socket, { type: "USERS_DIFF", upsert, remove, presence });
    }
    if (legacy.length) this.queueLegacyRoster(legacy);
  }

  private inBackground(work: Promise<unknown>): void {
    if (typeof this.ctx.waitUntil === "function") this.ctx.waitUntil(work);
    else void work;
  }

  private queueLegacyRoster(connectionIds: string[]): void {
    for (const id of connectionIds) this.legacyRosterPending.add(id);
    if (this.legacyRosterTimer) return;
    this.legacyRosterTimer = setTimeout(() => {
      this.legacyRosterTimer = null;
      const pending = this.legacyRosterPending;
      this.legacyRosterPending = new Set();
      this.inBackground(
        this.flushLegacyRoster(pending).catch((error) =>
          console.error("Legacy roster flush failed", error instanceof Error ? error.name : "UnknownError"),
        ),
      );
    }, LEGACY_ROSTER_FLUSH_MS);
  }

  private async flushLegacyRoster(connectionIds: Set<string>): Promise<void> {
    const live = await this.liveRecipients({});
    const states = live.map((socket) => this.state(socket));
    const lookup = new RealtimeLookup(this.env.DB, this.directory);
    const viewerIds = states
      .filter((st) => connectionIds.has(st.connectionId))
      .map((st) => st.userId)
      .filter((id): id is string => !!id);
    await lookup.loadUsers(states.map((st) => st.userId).filter((id): id is string => !!id));
    await lookup.loadFriends(viewerIds);
    await lookup.loadMembershipsOf(viewerIds);
    await lookup.loadRooms(states.map((st) => st.channelId));
    for (const socket of live) {
      const viewer = this.state(socket);
      if (!connectionIds.has(viewer.connectionId)) continue;
      this.send(socket, { type: "USERS_UPDATE", users: await this.rosterFor(viewer, states, lookup) });
    }
  }

  private async sendSocial(ws: WebSocket, userId: string): Promise<void> {
    const friends = await this.env.DB.prepare(
      `SELECT u.* FROM decave_friendships f JOIN decave_users u ON u.id=CASE WHEN f.user_a=? THEN f.user_b ELSE f.user_a END WHERE f.user_a=? OR f.user_b=? ORDER BY u.username`,
    )
      .bind(userId, userId, userId)
      .all<UserRow>();
    const incoming = await this.env.DB.prepare(
      `SELECT u.* FROM decave_friend_requests r JOIN decave_users u ON u.id=r.sender_id WHERE r.recipient_id=?`,
    )
      .bind(userId)
      .all<UserRow>();
    const outgoing = await this.env.DB.prepare(
      `SELECT u.* FROM decave_friend_requests r JOIN decave_users u ON u.id=r.recipient_id WHERE r.sender_id=?`,
    )
      .bind(userId)
      .all<UserRow>();
    const online = new Set(
      this.states()
        .map((x) => x.userId)
        .filter(Boolean),
    );
    const map = (u: UserRow, relation: "friend" | "other") => {
      const isOnline = presenceOnline(u, online.has(u.id));
      return { ...publicUserWithPresence(u, isOnline, relation), online: isOnline };
    };
    this.send(ws, {
      type: "SOCIAL_STATE",
      friends: friends.results.map((u) => map(u, "friend")),
      incoming: incoming.results.map((u) => map(u, "other")),
      outgoing: outgoing.results.map((u) => map(u, "other")),
    });
  }

  private async callParticipant(s: SocketState) {
    if (!s.userId || !s.username) return null;
    const user = await this.env.DB.prepare("SELECT * FROM decave_users WHERE id=?").bind(s.userId).first<UserRow>();
    return {
      connectionId: s.connectionId,
      userId: user ? publicIdOf(user) : "",
      username: s.username,
      avatarUrl: user ? publicUser(user).avatarUrl : null,
      channelId: 0,
      role: null,
      muted: s.voiceMuted || s.voiceDeafened || s.voiceServerMuted || s.voiceServerDeafened,
      selfMuted: s.voiceMuted,
      deafened: s.voiceDeafened || s.voiceServerDeafened,
      selfDeafened: s.voiceDeafened,
      serverMuted: s.voiceServerMuted,
      serverDeafened: s.voiceServerDeafened,
      screenSharing: false,
      screenStreamId: null,
      allowStreamPreview: false,
      cameraSharing: s.dmCallVideo || s.cameraSharing,
    };
  }

  private async endDirectCall(ws: WebSocket, state: SocketState, reason: string): Promise<void> {
    const callId = state.dmCallId;
    // One ringing device dropping offline leaves the call ringing on the others.
    const ringingElsewhere =
      reason === "peer-offline" &&
      state.dmCallIncoming &&
      !state.dmCallAccepted &&
      this.states().some(
        (other) =>
          other.connectionId !== state.connectionId && other.userId === state.userId && other.dmCallId === callId,
      );
    this.attach(ws, this.withoutDirectCall(state));
    await this.sendToLive(ws, { type: "DM_CALL_ENDED", callId, reason });
    if (!callId || ringingElsewhere) return;
    // Call ids are unique, so this reaches the peer and any device still ringing.
    for (const other of this.ctx.getWebSockets()) {
      if (other === ws) continue;
      const otherState = this.state(other);
      if (otherState.dmCallId !== callId) continue;
      this.attach(other, this.withoutDirectCall(otherState));
      await this.sendToLive(other, { type: "DM_CALL_ENDED", callId, reason });
    }
  } // DECAVE_PARITY_END_DIRECT_CALL

  private async participant(
    s: SocketState,
    lookup = new RealtimeLookup(this.env.DB),
  ): Promise<VoiceParticipant | null> {
    if (!s.userId || !s.username || s.voiceChannelId === null) return null;
    await lookup.loadUsers([s.userId]);
    const user = lookup.user(s.userId);
    const room = await lookup.room(s.voiceChannelId);
    return {
      connectionId: s.connectionId,
      userId: user ? publicIdOf(user) : "",
      username: s.username,
      avatarUrl: user ? publicUser(user).avatarUrl : null,
      channelId: s.voiceChannelId,
      role: room ? await lookup.role(room.hub_id, s.userId) : null,
      muted: s.voiceMuted || s.voiceDeafened || s.voiceServerMuted || s.voiceServerDeafened,
      selfMuted: s.voiceMuted,
      deafened: s.voiceDeafened || s.voiceServerDeafened,
      selfDeafened: s.voiceDeafened,
      serverMuted: s.voiceServerMuted,
      serverDeafened: s.voiceServerDeafened,
      screenSharing: s.screenSharing,
      screenStreamId: s.screenSharing ? (s.screenStreamId ?? null) : null,
      allowStreamPreview: s.allowStreamPreview,
      cameraSharing: s.cameraSharing,
      screenSfu: s.screenSfu ? { sessionId: s.screenSfu.sessionId, trackName: s.screenSfu.trackName } : null,
      sfuScreenCapable: s.sfuScreenCapable === true,
    };
  }

  private async liveStates(): Promise<SocketState[]> {
    return (await this.liveRecipients({})).map((socket) => this.state(socket));
  }

  private async hubOfRoom(roomId: number | null): Promise<number | null> {
    if (roomId === null) return null;
    return (await getRoom(this.env.DB, roomId))?.hub_id ?? null;
  }

  private async voiceParticipantsSnapshot(
    states: SocketState[] = this.states(),
    lookup = new RealtimeLookup(this.env.DB),
  ) {
    // Users, rooms and roles load in batches shared by every viewer.
    const voice = states.filter((s) => s.voiceChannelId !== null && s.userId);
    await lookup.loadUsers(voice.map((s) => s.userId!));
    await lookup.loadRooms(voice.map((s) => s.voiceChannelId!));
    await lookup.loadMembershipsOf(voice.map((s) => s.userId!));
    const entries: { room: RoomRow; participant: VoiceParticipant }[] = [];
    for (const s of voice) {
      const room = await lookup.room(s.voiceChannelId!);
      if (!room) continue;
      const p = await this.participant(s, lookup);
      if (p) entries.push({ room, participant: p });
    }
    return entries;
  }

  private async sendVoiceState(
    ws: WebSocket,
    userId: string,
    snapshot?: { room: RoomRow; participant: VoiceParticipant }[],
    lookup = new RealtimeLookup(this.env.DB),
    recipientIsLive = false,
  ): Promise<void> {
    const entries = snapshot ?? (await this.voiceParticipantsSnapshot(await this.liveStates(), lookup));
    const participants = [];
    for (const { room, participant } of entries) {
      if (await lookup.canAccessRoom(room, userId)) participants.push(participant);
    }
    const event = { type: "VOICE_STATE", participants };
    if (recipientIsLive) this.send(ws, event);
    else await this.sendToLive(ws, event);
  }

  /**
   * Push the voice roster after a change. With `hubId`, only members of that
   * Hub are sent a new snapshot: nobody else can see its rooms, so their view
   * did not change. Without it (unknown scope) every live socket is updated.
   */
  private async broadcastVoiceState(hubId?: number | null): Promise<void> {
    // Snapshot and recipients come from the same validated socket set; this
    // prevents expired or revoked hibernating attachments leaking into voice
    // state after an internal revocation notification failed.
    const live = await this.liveRecipients({});
    const states = live.map((socket) => this.state(socket));
    const lookup = new RealtimeLookup(this.env.DB);
    const snapshot = await this.voiceParticipantsSnapshot(states, lookup);
    let recipients = live;
    if (hubId) {
      await lookup.loadHubMembers(hubId);
      const members = new Set<string>();
      for (const st of states) if (st.userId && (await lookup.role(hubId, st.userId))) members.add(st.userId);
      recipients = live.filter((ws) => {
        const st = this.state(ws);
        return st.userId && members.has(st.userId);
      });
    }
    await lookup.loadMembershipsOf(recipients.map((ws) => this.state(ws).userId).filter((id): id is string => !!id));
    for (const ws of recipients) {
      const s = this.state(ws);
      if (s.userId) await this.sendVoiceState(ws, s.userId, snapshot, lookup, true);
    }
  }

  /** Timed-out members cannot publish media/soundboard; they are removed from voice. */
  private async voiceMediaAllowed(ws: WebSocket, state: SocketState): Promise<boolean> {
    if (state.voiceChannelId === null || !state.userId) return false;
    const room = await getRoom(this.env.DB, state.voiceChannelId);
    if (!room) return false;
    if (!(await isTimedOut(this.env.DB, room.hub_id, state.userId))) return true;
    this.send(ws, { type: "VOICE_ERROR", message: "You are currently timed out in this Hub.", code: "TIMED_OUT" });
    await this.leaveVoice(ws, state, true);
    return false;
  }

  /**
   * Re-run room authorization for every live socket bound to `hubId` after a
   * permission-relevant change (room privacy/members, role changes, custom
   * role edits, room deletion, timeouts). Text subscriptions that lost access
   * move to the first accessible room; voice sessions that lost access (or
   * whose user is timed out, or whose room was deleted) are ended server-side.
   */
  private async recheckHubAccess(hubId: number, message?: string): Promise<number> {
    let changed = 0;
    let voiceChanged = false;
    const accessCache = new Map<string, boolean>();
    const roomCache = new Map<number, RoomRow | null>();
    const roomFor = async (id: number) => {
      if (!roomCache.has(id)) roomCache.set(id, await getRoom(this.env.DB, id));
      return roomCache.get(id) ?? null;
    };
    const allowed = async (room: RoomRow, userId: string) => {
      const key = `${room.id}:${userId}`;
      let v = accessCache.get(key);
      if (v === undefined) {
        v = await canAccessRoom(this.env.DB, room, userId);
        accessCache.set(key, v);
      }
      return v;
    };
    // Internal permission updates are unsolicited; process only recipients
    // whose persisted session is still valid.
    for (const socket of await this.liveRecipients({})) {
      let s = this.state(socket);
      if (!s.userId) continue;
      if (s.voiceChannelId !== null) {
        const voiceRoom = await roomFor(s.voiceChannelId);
        const inHub = voiceRoom ? voiceRoom.hub_id === hubId : s.serverId === hubId;
        if (inHub) {
          const timedOut = voiceRoom ? await isTimedOut(this.env.DB, hubId, s.userId) : false;
          const lost = !voiceRoom || timedOut || !(await allowed(voiceRoom, s.userId));
          if (lost) {
            this.send(socket, {
              type: "VOICE_ERROR",
              message: !voiceRoom
                ? "This voice room was deleted."
                : timedOut
                  ? "You are currently timed out in this Hub."
                  : "You no longer have access to this voice room.",
              code: !voiceRoom ? "ROOM_DELETED" : timedOut ? "TIMED_OUT" : "ACCESS_REVOKED",
            });
            const voiceBefore = voiceRoomsOf(this.states(), s.userId);
            await this.leaveVoiceQuiet(socket, s);
            this.voiceBotEvents(s.userId, voiceBefore, hubId);
            s = this.state(socket);
            voiceChanged = true;
            changed++;
          }
        }
      }
      if (s.serverId === hubId && s.channelId) {
        const room = await roomFor(s.channelId);
        if (!room || room.hub_id !== hubId || !(await allowed(room, s.userId!))) {
          const rows = await this.env.DB.prepare(
            "SELECT * FROM decave_rooms WHERE hub_id=? ORDER BY CASE WHEN type='text' THEN 0 ELSE 1 END,position,id",
          )
            .bind(hubId)
            .all<RoomRow>();
          let fallback = 0;
          for (const candidate of rows.results) {
            if (await allowed(candidate, s.userId!)) {
              fallback = Number(candidate.id);
              break;
            }
          }
          const lostChannelId = s.channelId;
          this.attach(socket, { ...s, channelId: fallback });
          this.send(socket, {
            type: "ROOM_ACCESS_REVOKED",
            serverId: hubId,
            channelId: lostChannelId,
            fallbackChannelId: fallback,
            message: message ?? (room ? "You no longer have access to this room." : "This room was deleted."),
          });
          changed++;
        }
      }
    }
    if (voiceChanged) await this.broadcastVoiceState(hubId);
    return changed;
  }

  /** Best-effort background close of Realtime tracks; logs only the error code. */
  private closeSfuTracks(sessionId: string, mids: string[]): void {
    if (mids.length === 0 || !screenSfuEnabled(this.env)) return;
    const client = createRealtimeClient(this.env);
    inBackground(async () => {
      try {
        await client.closeTracks(sessionId, mids);
      } catch (error) {
        console.warn("[screen-sfu] close failed", error instanceof RealtimeSfuError ? error.code : "unknown");
      }
    }, this.backgroundWork());
  }

  /**
   * Clears this connection's SFU state and closes its Realtime sessions in the
   * background (best effort). Returns the cleared state; the caller persists it.
   * `publishOnly` keeps the viewer's pull session and capability (RTC_SFU_STOP).
   * When a publish ends, every viewer's pull of it is dropped and closed too.
   */
  private releaseScreenSfu(state: SocketState, publishOnly = false): SocketState {
    for (const { sessionId, mids } of sfuCloses(
      publishOnly ? { ...state, sfuPullSessionId: null, sfuPulls: {} } : state,
    ))
      this.closeSfuTracks(sessionId, mids);
    if (state.screenSfu) {
      for (const socket of this.ctx.getWebSockets()) {
        const viewerState = this.state(socket);
        if (viewerState.connectionId === state.connectionId) continue;
        const pruned = pruneViewerPull(viewerState, state.connectionId);
        if (!pruned.close) continue;
        try {
          this.attach(socket, pruned.viewer);
        } catch {}
        this.closeSfuTracks(pruned.close.sessionId, pruned.close.mids);
      }
    }
    if (publishOnly) return { ...state, screenSfu: null };
    return { ...state, screenSfu: null, sfuScreenCapable: false, sfuPullSessionId: null, sfuPulls: {} };
  }

  /** RTC_SFU_* requests drive Cloudflare Realtime for this connection. Each replies RTC_SFU_RESULT. */
  private async handleScreenSfu(
    ws: WebSocket,
    state: SocketState,
    type: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const requestId = parseRequestId(data.requestId);
    if (!requestId) return;
    if (!screenSfuEnabled(this.env)) {
      this.send(ws, sfuDisabledResult(requestId));
      return;
    }
    const fail = (error: string) => this.send(ws, sfuErrorResult(requestId, error));
    const client = createRealtimeClient(this.env);
    // The pulled track always comes from the sharer's stored state, never from client input.
    const sharerFor = async () => {
      const sharerConnectionId = typeof data.sharerConnectionId === "string" ? data.sharerConnectionId : "";
      const socket = this.socketByConnectionId(sharerConnectionId);
      if (!socket || !(await this.socketIsLive(socket))) return null;
      const sharer = this.state(socket);
      if (!canPull(state, sharer) || !sharer.screenSfu) return null;
      return {
        connectionId: sharer.connectionId,
        sessionId: sharer.screenSfu.sessionId,
        trackName: sharer.screenSfu.trackName,
      };
    };
    try {
      if (type === "RTC_SFU_PUBLISH") {
        const offer = parseSdp(data.offer, "offer");
        const mid = parseMid(data.mid);
        if (!offer || !mid) return fail("bad-request");
        if (!(await this.voiceMediaAllowed(ws, state))) return fail("not-in-voice");
        if (state.screenSfu) {
          state = this.releaseScreenSfu(state, true);
          this.attach(ws, state);
        }
        const trackName = trackNameFor(state.connectionId);
        const { sessionId } = await client.newSession();
        const { answer } = await client.pushTrack(sessionId, offer, mid, trackName);
        const published = { sessionId, trackName, mid };
        // Re-read after the awaits: the socket may have left voice or published concurrently.
        let current = this.state(ws);
        if (current.voiceChannelId === null || current.voiceChannelId !== state.voiceChannelId) {
          this.closeSfuTracks(sessionId, [mid]);
          return fail("not-in-voice");
        }
        // A concurrent publish landed first: close it, the newest publish wins.
        if (current.screenSfu) current = this.releaseScreenSfu(current, true);
        this.attach(ws, { ...current, screenSfu: published });
        this.send(ws, sfuResult(requestId, { sessionId, answer, trackName }));
        await this.broadcastVoiceState(await this.hubOfRoom(state.voiceChannelId));
        return;
      }
      if (type === "RTC_SFU_PULL") {
        const rid = parseRid(data.rid);
        if (!rid) return fail("bad-request");
        const sharer = await sharerFor();
        if (!sharer) return fail("forbidden");
        if (!state.sfuPulls[sharer.connectionId] && Object.keys(state.sfuPulls).length >= MAX_SFU_PULLS)
          return fail("too-many-pulls");
        let pullSessionId = state.sfuPullSessionId;
        if (!pullSessionId) {
          const created = (await client.newSession()).sessionId;
          // A concurrent pull may have created the session meanwhile; reuse it (the
          // unused new session has no tracks and expires on its own).
          const latest = this.state(ws);
          if (latest.voiceChannelId !== state.voiceChannelId) return fail("not-in-voice");
          pullSessionId = latest.sfuPullSessionId ?? created;
          if (!latest.sfuPullSessionId) this.attach(ws, { ...latest, sfuPullSessionId: pullSessionId });
        }
        const pulled = await client.pullTrack(
          pullSessionId,
          { sessionId: sharer.sessionId, trackName: sharer.trackName },
          rid,
        );
        const current = this.state(ws);
        if (current.voiceChannelId !== state.voiceChannelId || current.sfuPullSessionId !== pullSessionId) {
          this.closeSfuTracks(pullSessionId, [pulled.mid]);
          return fail("not-in-voice");
        }
        const stillSharing = await sharerFor();
        if (!stillSharing || stillSharing.sessionId !== sharer.sessionId) {
          this.closeSfuTracks(pullSessionId, [pulled.mid]);
          return fail("forbidden");
        }
        // A repeat (or concurrent) pull of this sharer replaces the old track: close it.
        const previousMid = current.sfuPulls[sharer.connectionId];
        if (previousMid && previousMid !== pulled.mid) this.closeSfuTracks(pullSessionId, [previousMid]);
        this.attach(ws, {
          ...current,
          sfuPulls: { ...current.sfuPulls, [sharer.connectionId]: pulled.mid },
        });
        this.send(
          ws,
          sfuResult(requestId, {
            offer: pulled.offer,
            mid: pulled.mid,
            requiresImmediateRenegotiation: pulled.requiresImmediateRenegotiation,
          }),
        );
        return;
      }
      if (type === "RTC_SFU_LAYER") {
        const rid = parseRid(data.rid);
        const mid = parseMid(data.mid);
        if (!rid || !mid) return fail("bad-request");
        const sharer = await sharerFor();
        if (!sharer || !state.sfuPullSessionId || state.sfuPulls[sharer.connectionId] !== mid) return fail("forbidden");
        await client.setLayer(
          state.sfuPullSessionId,
          mid,
          { sessionId: sharer.sessionId, trackName: sharer.trackName },
          rid,
        );
        this.send(ws, sfuResult(requestId));
        return;
      }
      if (type === "RTC_SFU_RENEGOTIATE") {
        const answer = parseSdp(data.answer, "answer");
        if (!answer) return fail("bad-request");
        if (!state.sfuPullSessionId) return fail("no-session");
        await client.renegotiate(state.sfuPullSessionId, answer);
        this.send(ws, sfuResult(requestId));
        return;
      }
      if (type === "RTC_SFU_STOP") {
        // Scoped by sessionId when given: a stale stop must not end a newer publish.
        if (state.screenSfu && !stopReleasesPublish(state.screenSfu, data.sessionId)) {
          this.send(ws, sfuResult(requestId));
          return;
        }
        const hadPublish = state.screenSfu !== null;
        this.attach(ws, this.releaseScreenSfu(state, true));
        this.send(ws, sfuResult(requestId));
        if (hadPublish) await this.broadcastVoiceState(await this.hubOfRoom(state.voiceChannelId));
        return;
      }
      fail("unknown-request");
    } catch (error) {
      const code = error instanceof RealtimeSfuError ? error.code : "sfu-error";
      console.warn("[screen-sfu] request failed", type, code);
      fail(code);
    }
  }

  /** leaveVoice without the per-socket voice-state rebroadcast (caller batches it). */
  private async leaveVoiceQuiet(ws: WebSocket, state: SocketState): Promise<void> {
    const previous = state.voiceChannelId;
    if (previous === null) return;
    this.attach(ws, {
      ...this.releaseScreenSfu(state),
      voiceChannelId: null,
      voiceServerMuted: false,
      voiceServerDeafened: false,
      screenSharing: false,
      screenStreamId: null,
      allowStreamPreview: true,
      cameraSharing: false,
    });
    await this.broadcast(
      { type: "VOICE_PEER_LEFT", connectionId: state.connectionId },
      { voiceChannelId: previous, exceptConnectionId: state.connectionId },
    );
    this.send(ws, { type: "VOICE_LEFT" });
  }

  private async leaveVoice(ws: WebSocket, state: SocketState, notifySelf: boolean, botEvents = true): Promise<void> {
    const previous = state.voiceChannelId;
    if (previous === null) {
      if (notifySelf) this.send(ws, { type: "VOICE_LEFT" });
      return;
    }
    const voiceBefore = state.userId ? voiceRoomsOf(this.states(), state.userId) : null;
    const next = {
      ...this.releaseScreenSfu(state),
      voiceChannelId: null,
      voiceServerMuted: false,
      voiceServerDeafened: false,
      screenSharing: false,
      screenStreamId: null,
      allowStreamPreview: true,
      cameraSharing: false,
    };
    this.attach(ws, next);
    await this.broadcast(
      { type: "VOICE_PEER_LEFT", connectionId: state.connectionId },
      { voiceChannelId: previous, exceptConnectionId: state.connectionId },
    );
    if (notifySelf) this.send(ws, { type: "VOICE_LEFT" });

    await this.broadcastVoiceState(await this.hubOfRoom(previous));
    if (botEvents && voiceBefore && state.userId) this.voiceBotEvents(state.userId, voiceBefore);
  }

  /** waitUntil for background work, when this runtime has one. */
  private backgroundWork(): ((work: Promise<unknown>) => void) | undefined {
    return typeof this.ctx.waitUntil === "function" ? (work) => this.ctx.waitUntil(work) : undefined;
  }

  /**
   * Bot voiceJoin/voiceLeave for a user's actual change of voice rooms (all
   * their sockets together), so a device handoff or second device is silent.
   */
  private voiceBotEvents(userId: string, before: Set<number>, hubIdHint?: number): void {
    const after = voiceRoomsOf(this.states(), userId);
    const changes: [number, "voiceJoin" | "voiceLeave"][] = [
      ...[...after].filter((id) => !before.has(id)).map((id): [number, "voiceJoin"] => [id, "voiceJoin"]),
      ...[...before].filter((id) => !after.has(id)).map((id): [number, "voiceLeave"] => [id, "voiceLeave"]),
    ];
    for (const [roomId, kind] of changes) {
      inBackground(async () => {
        // A deleted room has no row left; the caller then names its hub.
        const room = await getRoom(this.env.DB, roomId);
        const hubId = room?.hub_id ?? hubIdHint;
        if (!hubId) return;
        queueBotEvent(
          this.env,
          {
            hubId,
            roomId,
            kind,
            actorId: userId,
            actorIsBot: false,
            chainDepth: 0,
            data: { roomId: String(roomId) },
          },
          this.backgroundWork(),
        );
      }, this.backgroundWork());
    }
  }

  private async messageForClient(id: string) {
    const row = await this.env.DB.prepare(
      `SELECT m.*,u.public_id,u.username,u.avatar_key,u.avatar_updated_at,hm.role FROM decave_messages m JOIN decave_users u ON u.id=m.author_user_id LEFT JOIN decave_hub_members hm ON hm.hub_id=m.hub_id AND hm.user_id=m.author_user_id WHERE m.id=?`,
    )
      .bind(id)
      .first<ChannelMessageRow>();
    if (!row) return null;
    const rr = await this.env.DB.prepare(
      `SELECT r.emoji,u.public_id FROM decave_message_reactions r JOIN decave_users u ON u.id=r.user_id WHERE r.message_id=?`,
    )
      .bind(id)
      .all<{ emoji: string; public_id: string | null }>();
    const reactions: Record<string, string[]> = {};
    for (const r of rr.results) {
      if (r.public_id) (reactions[r.emoji] ??= []).push(r.public_id);
    }
    return {
      id: row.id,
      userId: row.public_id ?? "",
      username: row.username,
      avatarUrl: row.avatar_key
        ? `/api/users/${encodeURIComponent(row.public_id ?? row.username)}/avatar?v=${encodeURIComponent(row.avatar_updated_at ?? "")}`
        : null,
      text: row.text,
      timestamp: row.created_at,
      channelId: row.room_id,
      role: row.role,
      editedAt: row.edited_at,
      replyToId: row.reply_to_id,
      reactions,
      pinned: row.pinned === 1,
      attachment:
        row.attachment_id && row.attachment_key
          ? {
              id: row.attachment_id,
              name: row.attachment_name ?? "attachment",
              mimeType: row.attachment_mime ?? "application/octet-stream",
              size: Number(row.attachment_size ?? 0),
              url: `/uploads/${row.attachment_key}`,
            }
          : null,
    };
  }
}
