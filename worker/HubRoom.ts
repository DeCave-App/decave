import type { ChannelMessageRow } from "./lib/messages";
import { DurableObject } from "cloudflare:workers";
import { createHash, createHmac } from "node:crypto";
import {
  canAccessRoom as dbCanAccessRoom,
  canCreateForumPost,
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
  type RoomRow,
  type ServerRole,
  type UserRow,
  activityTextFor,
} from "./db";
import type { Env } from "./index";
import { consumeSessionBoundWsToken, isActiveSession } from "./lib/sessions";
import { streamerHubIdsForUser, streamerMigrationExists } from "./streamer/index.ts";
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
const WS_CONNECTION_LIMIT_GLOBAL = 2_048;
const WS_ADMISSION_KEY_LIMIT = 4_096;
const WS_AUTH_DEADLINE_MS = 30_000;
const UNKNOWN_WS_ADDRESS = "unknown";

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
};

type RealtimeRateBucket = { startedAt: number; count: number };
type WebSocketAdmissionWindow = { startedAt: number; attempts: number; identifyFailures: number };

type SocketState = {
  connectionId: string;
  peerAddress: string;
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
};

async function touchRealtimePresence(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS decave_presence_activity (
        user_id TEXT PRIMARY KEY,
        last_seen_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
      )`,
    )
    .run();
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

/**
 * Per-IP admission key for WebSocket limits. The raw address is never kept in
 * socket state or attachments: it is reduced to a keyed (SECURITY_IP_HASH_KEY)
 * or domain-separated hash, which is all equality-based limiting needs.
 */
function peerAddressTag(address: string, ipHashKey: string | undefined): string {
  const input = `decave-ws-peer-v1:${address}`;
  const key = ipHashKey?.trim() ?? "";
  const digest = key
    ? createHmac("sha256", key).update(input).digest("hex")
    : createHash("sha256").update(input).digest("hex");
  return `ip:${digest.slice(0, 32)}`;
}

function peerAddressForRequest(request: Request, ipHashKey: string | undefined): string {
  const address = request.headers.get("CF-Connecting-IP")?.trim() ?? "";
  return address && address.length <= 64 ? peerAddressTag(address, ipHashKey) : UNKNOWN_WS_ADDRESS;
}

/** Older hibernated sockets may carry a raw address; re-tag it on restore. */
function normalizedPeerAddress(value: unknown, ipHashKey: string | undefined): string {
  if (typeof value !== "string" || !value || value === UNKNOWN_WS_ADDRESS) return UNKNOWN_WS_ADDRESS;
  if (/^ip:[0-9a-f]{32}$/.test(value)) return value;
  return value.length <= 64 ? peerAddressTag(value, ipHashKey) : UNKNOWN_WS_ADDRESS;
}

export class HubRoom extends DurableObject<Env> {
  private realtimeRate = new Map<string, Map<string, RealtimeRateBucket>>();
  private wsAdmission = new Map<string, WebSocketAdmissionWindow>();

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
    ws.serializeAttachment(next);
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
    if (deadlines.length === 0) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.min(...deadlines));
  }

  private activeWebSocketsForAddress(address: string): number {
    return this.ctx
      .getWebSockets()
      .reduce((count, socket) => count + (this.state(socket).peerAddress === address ? 1 : 0), 0);
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
      const peerAddress = peerAddressForRequest(request, this.env.SECURITY_IP_HASH_KEY);
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
        peerAddress,
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
      };
      server.serializeAttachment(state);
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

    if (url.pathname === "/internal/broadcast" && request.method === "POST") {
      const data = await request.json<{ event: unknown; filter?: Filter }>();
      const event = data.event && typeof data.event === "object" ? (data.event as Record<string, unknown>) : null;

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
              socket.serializeAttachment({ ...socketState, serverId: 0, channelId: 0 });
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
              socket.serializeAttachment({ ...socketState, username });
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
      const changed = await this.recheckHubAccess(hubId, typeof body.message === "string" ? body.message : undefined);
      return Response.json({ success: true, changed });
    }

    if (url.pathname === "/internal/count" && request.method === "POST") {
      const body = await request.json<{ hubId?: number }>();
      const visibleStates = await this.visiblePresenceStates(this.states());
      const ids = new Set(
        visibleStates
          .filter((x) => body.hubId === undefined || x.serverId === body.hubId)
          .map((x) => x.userId)
          .filter((x): x is string => !!x),
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
      const visibleStates = await this.visiblePresenceStates(this.states());
      for (const state of visibleStates) {
        if (!state.userId || state.voiceChannelId === null || !wanted.has(state.voiceChannelId)) continue;
        const set = users.get(state.voiceChannelId) ?? new Set<string>();
        set.add(state.userId);
        users.set(state.voiceChannelId, set);
      }
      const counts: Record<string, number> = {};
      for (const [channelId, set] of users) counts[String(channelId)] = set.size;
      return Response.json({ counts });
    }

    if (url.pathname === "/internal/online-users") {
      const visibleStates = await this.visiblePresenceStates(this.states());
      return Response.json({
        userIds: [...new Set(visibleStates.map((x) => x.userId).filter((x): x is string => !!x))],
      });
    }

    if (url.pathname === "/internal/stats") {
      const states = await this.visiblePresenceStates(this.states());
      const authenticatedStates = states.filter((state): state is SocketState & { userId: string } =>
        Boolean(state.userId),
      );
      return Response.json({
        onlineUsers: new Set(authenticatedStates.map((state) => state.userId)).size,
        voiceUsers: new Set(
          authenticatedStates
            .filter((state) => state.voiceChannelId !== null || state.dmCallAccepted)
            .map((state) => state.userId),
        ).size,
        screenSharingUsers: new Set(
          authenticatedStates.filter((state) => state.screenSharing).map((state) => state.userId),
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
      let active = false;
      try {
        active = await isActiveSession(this.env, state.userId, state.sessionHash ?? "");
      } catch {
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
      ws.serializeAttachment(state);
    }

    if (!knownType) {
      this.send(ws, { type: "ERROR", message: "Unknown realtime message type." });
      return;
    }

    if (type === "IDENTIFY") {
      const token = typeof data.token === "string" && data.token.length <= 256 ? data.token : "";
      if (this.identifyFailuresForAddress(state.peerAddress) >= WS_IDENTIFY_FAILURE_LIMIT_PER_ADDRESS) {
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
        ws.serializeAttachment(state);
        this.send(ws, { type: "AUTH_ERROR", message: "Session expired. Please log in again." });
        if (state.identifyFailures >= MAX_IDENTIFY_FAILURES || !this.recordIdentifyFailure(state.peerAddress)) {
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
      };
      ws.serializeAttachment(state);
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
      await this.sendServers(ws, user.id);
      await this.broadcastUsers();
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
        ws.serializeAttachment(state);
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
      state = { ...state, serverId: hubId, channelId };
      ws.serializeAttachment(state);
      this.send(ws, { type: "SERVER_JOINED", serverId: state.serverId, channelId: state.channelId });
      await this.broadcastUsers();
      return;
    }

    if (type === "JOIN_CHANNEL") {
      const room = await getRoom(this.env.DB, Number(data.channelId));
      if (!room || room.hub_id !== state.serverId || !(await canAccessRoom(this.env.DB, room, state.userId))) {
        this.send(ws, { type: "ERROR", message: "Room not found or inaccessible" });
        return;
      }
      state = { ...state, channelId: room.id };
      ws.serializeAttachment(state);
      this.send(ws, { type: "CHANNEL_JOINED", channelId: room.id });
      // A client may be on an older bundle that does not issue the explicit
      // VOICE_STATE_REQUEST after navigation. Push the authoritative voice
      // roster whenever the active text/channel subscription changes so web
      // and desktop converge on the same live-room view.
      await this.sendVoiceState(ws, state.userId!);
      await this.broadcastUsers();
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

      // A click can race the CHANNEL_JOINED acknowledgement. Once the message
      // itself has passed the same authorization check, synchronize the socket
      // subscription before broadcasting so the sender also receives the event.
      if (state.channelId !== room.id) {
        state = { ...state, channelId: room.id };
        ws.serializeAttachment(state);
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
      await this.env.DB.prepare(
        `INSERT INTO decave_messages
           (id,room_id,hub_id,author_user_id,text,created_at,reply_to_id,
            attachment_id,attachment_name,attachment_mime,attachment_size,attachment_key)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
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
        )
        .run();
      if (lockForumPostOnCreate) {
        // Row is created by trg_decave_forum_post_insert (migration 0057).
        await this.env.DB.prepare("UPDATE decave_forum_post_state SET locked=1 WHERE message_id=?").bind(id).run();
      }

      const message = await this.messageForClient(id);
      await this.broadcast({ type: "CHAT_MESSAGE", ...message }, { channelId: roomId });

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

      for (const targetUserId of onlineUserIds) {
        if (!(await canAccessRoom(this.env.DB, room, targetUserId))) continue;

        const target = await this.env.DB.prepare("SELECT username FROM decave_users WHERE id=?")
          .bind(targetUserId)
          .first<{ username: string }>();
        if (!target) continue;

        const mentioned = messageMentions(text, target.username);
        await this.broadcast(
          {
            type: "ROOM_ACTIVITY",
            serverId: room.hub_id,
            channelId: roomId,
            channelName: room.name,
            userId: publicIdOf(
              (await this.env.DB.prepare("SELECT * FROM decave_users WHERE id=?").bind(state.userId).first<UserRow>())!,
            ),
            username: state.username,
            messageId: id,
            timestamp: createdAt,
            text,
            mentioned,
          },
          { userIds: [targetUserId] },
        );
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
          })().catch((error) => console.warn("[push] room push failed", error)),
        );
      }
      return;
    }

    if (type === "DM_MESSAGE") {
      const targetReference = typeof data.targetUserId === "string" ? data.targetUserId : "";
      const text = typeof data.text === "string" ? data.text.trim().slice(0, 4000) : "";
      const replyToId = typeof data.replyToId === "string" ? data.replyToId : null;
      const targetUser = targetReference ? await userByReference(this.env.DB, targetReference) : null;
      const targetId = targetUser?.id ?? "";
      if (!targetId || !text) return;
      const pair = [state.userId, targetId].sort();
      const friend = await this.env.DB.prepare("SELECT 1 FROM decave_friendships WHERE user_a=? AND user_b=?")
        .bind(pair[0], pair[1])
        .first();
      if (!friend) {
        this.send(ws, { type: "DM_ERROR", message: "Private messages are available between friends." });
        return;
      }
      if (await isBlockedEitherDirection(this.env.DB, state.userId, targetId)) {
        this.send(ws, {
          type: "DM_ERROR",
          message: "This user is blocked. Unblock them before sending private messages.",
        });
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
          this.send(ws, { type: "DM_ERROR", message: "The message you are replying to was not found." });
          return;
        }
      }
      const message = {
        id: crypto.randomUUID(),
        fromUserId: publicIdOf(
          (await this.env.DB.prepare("SELECT * FROM decave_users WHERE id=?").bind(state.userId).first<UserRow>())!,
        ),
        toUserId: targetUser ? publicIdOf(targetUser) : "",
        text,
        timestamp: nowIso(),
        replyToId,
      };
      await this.env.DB.prepare(
        "INSERT INTO decave_direct_messages(id,from_user_id,to_user_id,text,created_at,reply_to_id) VALUES(?,?,?,?,?,?)",
      )
        .bind(message.id, state.userId, targetId, message.text, message.timestamp, message.replyToId)
        .run();
      await this.broadcast(
        {
          type: "DM_MESSAGE",
          message,
          sender: {
            id: publicIdOf(
              (await this.env.DB.prepare("SELECT * FROM decave_users WHERE id=?").bind(state.userId).first<UserRow>())!,
            ),
            username: state.username,
          },
        },
        { userIds: [state.userId, targetId] },
      );
      const targetOnline = this.states().some((other) => other.userId === targetId);
      if (!targetOnline) {
        const senderId = state.userId;
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
                text,
                route: `/dm/${encodeURIComponent(message.fromUserId)}?username=${encodeURIComponent(state.username ?? "")}`,
                threadId: `dm-${message.fromUserId}`,
              },
            );
          })().catch((error) => console.warn("[push] DM push failed", error)),
        );
      }
      return;
    }

    if (type === "GROUP_MESSAGE") {
      const groupId = typeof data.groupId === "string" ? data.groupId.trim() : "";
      const text = typeof data.text === "string" ? data.text.trim().slice(0, 4000) : "";
      const replyToId = typeof data.replyToId === "string" ? data.replyToId : null;
      if (!groupId || !text) return;
      await ensureGroupChatSchema(this.env.DB);
      if (!(await isGroupChatMember(this.env.DB, groupId, state.userId))) {
        this.send(ws, { type: "GROUP_ERROR", groupId, message: "You are not a member of this group chat." });
        return;
      }

      const sender = await this.env.DB.prepare("SELECT * FROM decave_users WHERE id=?")
        .bind(state.userId)
        .first<UserRow>();
      if (!sender) return;

      if (replyToId) {
        const replyTarget = await this.env.DB.prepare(
          "SELECT 1 FROM decave_group_chat_messages WHERE id=? AND group_id=? LIMIT 1",
        )
          .bind(replyToId, groupId)
          .first();
        if (!replyTarget) {
          this.send(ws, { type: "GROUP_ERROR", groupId, message: "The message you are replying to was not found." });
          return;
        }
      }

      const id = crypto.randomUUID();
      const timestamp = nowIso();
      await this.env.DB.batch([
        this.env.DB.prepare(
          `INSERT INTO decave_group_chat_messages(id,group_id,from_user_id,text,created_at,reply_to_id)
             VALUES(?,?,?,?,?,?)`,
        ).bind(id, groupId, state.userId, text, timestamp, replyToId),
        this.env.DB.prepare("UPDATE decave_group_chats SET updated_at=? WHERE id=?").bind(timestamp, groupId),
      ]);

      const message = {
        id,
        groupId,
        fromUserId: publicIdOf(sender),
        username: sender.username,
        avatarUrl: publicUser(sender).avatarUrl,
        text,
        timestamp,
        replyToId,
      };
      const memberIds = await groupChatMemberIds(this.env.DB, groupId);
      await this.broadcast({ type: "GROUP_MESSAGE", groupId, message }, { userIds: memberIds });
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
      const target = await this.preferredDirectCallSocket(targetUserId);
      if (!target) {
        this.send(ws, {
          type: "DM_CALL_ERROR",
          message: "This friend is offline.",
          peer: { userId: publicIdOf(targetUserRecord), username: targetUserRecord.username },
        });
        return;
      }
      if (!(await this.socketIsLive(target))) {
        this.send(ws, { type: "DM_CALL_ERROR", message: "This friend is offline." });
        return;
      }
      const targetState = this.state(target);
      const targetUser = await this.env.DB.prepare("SELECT * FROM decave_users WHERE id=?")
        .bind(targetUserId)
        .first<UserRow>();
      if (!targetUser || targetUser.status === "invisible") {
        this.send(ws, { type: "DM_CALL_ERROR", message: "This friend is offline." });
        return;
      }
      if (targetState.voiceChannelId !== null || targetState.dmCallId) {
        this.send(ws, { type: "DM_CALL_ERROR", message: "This friend is already in another call." });
        return;
      }
      const callId = crypto.randomUUID();
      const callerNext = {
        ...state,
        dmCallId: callId,
        dmCallPeerUserId: targetUserId,
        dmCallPeerConnectionId: targetState.connectionId,
        dmCallIncoming: false,
        dmCallAccepted: false,
        dmCallVideo: video,
      };
      const targetNext = {
        ...targetState,
        dmCallId: callId,
        dmCallPeerUserId: state.userId,
        dmCallPeerConnectionId: state.connectionId,
        dmCallIncoming: true,
        dmCallAccepted: false,
        dmCallVideo: video,
      };
      ws.serializeAttachment(callerNext);
      target.serializeAttachment(targetNext);
      const caller = await this.callParticipant(callerNext);
      const peer = await this.callParticipant(targetNext);
      this.send(ws, { type: "DM_CALL_RINGING", callId, video, peer });
      await this.sendToLive(target, { type: "DM_CALL_INCOMING", callId, video, caller });
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
      const selfNext = { ...state, dmCallIncoming: false, dmCallAccepted: true };
      const peerNext = { ...peerState, dmCallIncoming: false, dmCallAccepted: true };
      ws.serializeAttachment(selfNext);
      peerSocket.serializeAttachment(peerNext);
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
      ws.serializeAttachment(selfNext);
      peerSocket.serializeAttachment(peerNext);
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
      // DECAVE_PARITY_VOICE_HANDOFF: the newest client wins if this account joins the same voice room elsewhere.
      for (const other of this.ctx.getWebSockets()) {
        if (other === ws) continue;
        const otherState = this.state(other);
        if (otherState.userId === state.userId && otherState.voiceChannelId === room.id)
          await this.leaveVoice(other, otherState, true);
      }
      if (state.voiceChannelId !== null) {
        await this.broadcast(
          { type: "VOICE_PEER_LEFT", connectionId: state.connectionId },
          { voiceChannelId: state.voiceChannelId, exceptConnectionId: state.connectionId },
        );
      }
      state = {
        ...state,
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
      ws.serializeAttachment(state);
      const participant = await this.participant(state);
      const peers = [];
      for (const peerState of this.states()) {
        if (peerState.connectionId !== state.connectionId && peerState.voiceChannelId === room.id) {
          peers.push(await this.participant(peerState));
        }
      }
      this.send(ws, { type: "VOICE_JOINED", channelId: room.id, participant, peers });
      await this.broadcast(
        { type: "VOICE_PEER_JOINED", participant },
        { voiceChannelId: room.id, exceptConnectionId: state.connectionId },
      );
      await this.broadcastVoiceState();
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
      ws.serializeAttachment(state);
      await this.broadcastVoiceState();
      return;
    }

    if (type === "VOICE_DEAFEN") {
      if (state.voiceDeafened === (data.deafened === true)) return;
      state = { ...state, voiceDeafened: data.deafened === true };
      ws.serializeAttachment(state);
      await this.broadcastVoiceState();
      return;
    }

    if (type === "VOICE_SCREEN_STATE") {
      if (data.screenSharing === true && !(await this.voiceMediaAllowed(ws, state))) return;
      if (
        state.screenSharing === (data.screenSharing === true) &&
        state.allowStreamPreview === (data.allowStreamPreview !== false)
      )
        return;
      state = {
        ...state,
        screenSharing: data.screenSharing === true,
        allowStreamPreview: data.allowStreamPreview !== false,
      };
      ws.serializeAttachment(state);
      await this.broadcastVoiceState();
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
      ws.serializeAttachment(state);
      await this.broadcastVoiceState();
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
      const from = sameVoiceRoom ? await this.participant(state) : await this.callParticipant(state);
      if (!from) return;
      await this.sendToLive(target, {
        type,
        from,
        ...(type === "RTC_DESCRIPTION" ? { description: data.description } : { candidate: data.candidate }),
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
      target.serializeAttachment(next);
      await this.sendToLive(target, {
        type: "VOICE_MODERATION_STATE",
        serverMuted: next.voiceServerMuted,
        serverDeafened: next.voiceServerDeafened,
      });
      await this.broadcastVoiceState();
      return;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const state = this.state(ws);
    this.realtimeRate.delete(state.connectionId);
    if (state.userId) await touchRealtimePresence(this.env.DB, state.userId);
    if (state.voiceChannelId !== null) {
      // Clear the voice binding before rebroadcasting: the closing socket can
      // still be returned by getWebSockets() during this handler, which used to
      // leave a ghost participant in VOICE_STATE.
      try {
        ws.serializeAttachment({ ...state, voiceChannelId: null, screenSharing: false, cameraSharing: false });
      } catch {}
      await this.broadcast(
        { type: "VOICE_PEER_LEFT", connectionId: state.connectionId },
        { voiceChannelId: state.voiceChannelId, exceptConnectionId: state.connectionId },
      );
    }
    if (state.dmCallId) {
      await this.endDirectCall(ws, { ...state, voiceChannelId: null }, "peer-offline");
    }
    await this.broadcastUsers();
    await this.broadcastVoiceState();
    await this.refreshDeadlineAlarm();
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  private state(ws: WebSocket): SocketState {
    const attached = ws.deserializeAttachment() as Partial<SocketState> | null;
    if (attached) {
      const authenticated = typeof attached.userId === "string" && attached.userId.length > 0;
      const authDeadlineAt = authenticated
        ? 0
        : typeof attached.authDeadlineAt === "number" &&
            Number.isSafeInteger(attached.authDeadlineAt) &&
            attached.authDeadlineAt > 0
          ? attached.authDeadlineAt
          : Date.now() + WS_AUTH_DEADLINE_MS;
      const normalized = {
        ...attached,
        peerAddress: normalizedPeerAddress(attached.peerAddress, this.env.SECURITY_IP_HASH_KEY),
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
      if (attached.authDeadlineAt !== authDeadlineAt || attached.peerAddress !== normalized.peerAddress) {
        try {
          ws.serializeAttachment(normalized);
        } catch {}
      }
      return normalized;
    }
    return {
      connectionId: crypto.randomUUID(),
      peerAddress: UNKNOWN_WS_ADDRESS,
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
    };
  }

  private states(): SocketState[] {
    return this.ctx.getWebSockets().map((ws) => this.state(ws));
  }

  /** Hide invisible accounts from every aggregate/public presence snapshot. */
  private async visiblePresenceStates(states: SocketState[]): Promise<SocketState[]> {
    const ids = [...new Set(states.map((state) => state.userId).filter((id): id is string => !!id))];
    if (!ids.length) return states.filter((state) => !state.userId);
    const visibleIds = new Set<string>();
    for (let offset = 0; offset < ids.length; offset += 90) {
      const batch = ids.slice(offset, offset + 90);
      const placeholders = batch.map(() => "?").join(",");
      const rows = await this.env.DB.prepare(
        `SELECT id FROM decave_users WHERE id IN (${placeholders}) AND status!='invisible' AND deleted_at IS NULL`,
      )
        .bind(...batch)
        .all<{ id: string }>();
      for (const row of rows.results) visibleIds.add(row.id);
    }
    return states.filter((state) => !state.userId || visibleIds.has(state.userId));
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
    try {
      if (await isActiveSession(this.env, state.userId, state.sessionHash)) return true;
    } catch {
      this.revokeSocket(ws, "session_validation_unavailable");
      return false;
    }
    this.revokeSocket(ws, "session_revoked");
    return false;
  }

  private async sendToLive(ws: WebSocket, payload: unknown): Promise<boolean> {
    if (!(await this.socketIsLive(ws))) return false;
    this.send(ws, payload);
    return true;
  }

  private matches(state: SocketState, filter: Filter): boolean {
    if (filter.exceptConnectionId && state.connectionId === filter.exceptConnectionId) return false;
    if (filter.userIds && (!state.userId || !filter.userIds.includes(state.userId))) return false;
    if (filter.sessionHashes && (!state.sessionHash || !filter.sessionHashes.includes(state.sessionHash))) return false;
    if (filter.hubId !== undefined && state.serverId !== filter.hubId) return false;
    if (filter.channelId !== undefined && state.channelId !== filter.channelId) return false;
    if (filter.voiceChannelId !== undefined && state.voiceChannelId !== filter.voiceChannelId) return false;
    return true;
  }

  private revokeSocket(ws: WebSocket, reason: string): void {
    this.send(ws, { type: "SESSION_REVOKED", reason });
    // Closing invokes webSocketClose, which clears voice/call state and
    // rebroadcasts presence for hibernated as well as in-memory sockets.
    try {
      ws.close(4001, "Session revoked");
    } catch {}
  }

  /** Validate recipients in bounded D1 batches before any server event delivery. */
  private async liveRecipients(filter: Filter): Promise<WebSocket[]> {
    const candidates = this.ctx.getWebSockets().filter((ws) => this.matches(this.state(ws), filter));
    const authenticated = candidates.filter((ws) => Boolean(this.state(ws).userId));
    const keyed = authenticated.map((ws) => ({ ws, state: this.state(ws) }));
    const sessionHashes = [
      ...new Set(keyed.map(({ state }) => state.sessionHash).filter((value): value is string => !!value)),
    ];
    const live = new Set<string>();
    try {
      for (let offset = 0; offset < sessionHashes.length; offset += 90) {
        const chunk = sessionHashes.slice(offset, offset + 90);
        if (!chunk.length) continue;
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
        for (const row of rows.results) live.add(row.token_hash);
      }
    } catch {
      for (const { ws } of keyed) this.revokeSocket(ws, "session_validation_unavailable");
      return [];
    }
    const result: WebSocket[] = [];
    for (const { ws, state } of keyed) {
      if (state.sessionHash && live.has(state.sessionHash)) result.push(ws);
      else this.revokeSocket(ws, "session_revoked");
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

  private socketByConnectionId(id: string): WebSocket | null {
    return this.ctx.getWebSockets().find((ws) => this.state(ws).connectionId === id) ?? null;
  }

  private async socketByUserId(userId: string): Promise<WebSocket | null> {
    return (await this.liveRecipients({ userIds: [userId] }))[0] ?? null;
  }

  private async preferredDirectCallSocket(userId: string): Promise<WebSocket | null> {
    const candidates = (await this.liveRecipients({ userIds: [userId] })).filter((candidate) => {
      const s = this.state(candidate);
      return s.userId === userId && s.voiceChannelId === null && !s.dmCallId;
    });
    candidates.sort((a, b) => Number(this.state(b).identifiedAt || 0) - Number(this.state(a).identifiedAt || 0));
    return candidates[0] ?? null;
  } // DECAVE_PARITY_CALL_ROUTE

  private async sendServers(ws: WebSocket, userId: string): Promise<void> {
    const rows = await this.env.DB.prepare(
      `SELECT h.*, hm.role my_role FROM decave_hubs h JOIN decave_hub_members hm ON hm.hub_id=h.id WHERE hm.user_id=? ORDER BY h.id`,
    )
      .bind(userId)
      .all<{
        id: number;
        name: string;
        icon: string;
        owner_id: string;
        visibility: "private" | "public";
        description: string;
        accent: string;
        category: string;
        slow_mode_seconds: number;
        icon_key: string | null;
        banner_key: string | null;
        my_role: ServerRole;
      }>();
    let streamerHubIds = new Set<number>();
    try {
      if (
        (await streamerMigrationExists(this.env.DB)) &&
        this.env.STREAMER_HUBS_ENABLED?.trim().toLowerCase() === "true"
      ) {
        streamerHubIds = await streamerHubIdsForUser(this.env.DB, userId);
      }
    } catch (error) {
      // A missing/partially-applied migration must serialize the safe standard
      // layout and never turn websocket server updates into a hard failure.
      console.error(
        "Could not serialize Streamer Hub layouts for realtime server updates",
        error instanceof Error ? error.name : "UnknownError",
      );
      streamerHubIds = new Set<number>();
    }
    const servers = [];
    for (const h of rows.results) {
      const channelRows = await this.env.DB.prepare("SELECT * FROM decave_rooms WHERE hub_id=? ORDER BY position,id")
        .bind(h.id)
        .all<RoomRow>();
      const channels = [];
      for (const room of channelRows.results) {
        if (await canAccessRoom(this.env.DB, room, userId)) channels.push({ ...room, private: room.private === 1 });
      }
      const count = await this.env.DB.prepare("SELECT COUNT(*) count FROM decave_hub_members WHERE hub_id=?")
        .bind(h.id)
        .first<{ count: number }>();
      const tags = await this.env.DB.prepare("SELECT tag FROM decave_hub_tags WHERE hub_id=?")
        .bind(h.id)
        .all<{ tag: string }>();
      servers.push({
        id: h.id,
        name: h.name,
        icon: h.icon,
        channels,
        ownerId:
          (
            await this.env.DB.prepare("SELECT public_id FROM decave_users WHERE id=?")
              .bind(h.owner_id)
              .first<{ public_id: string | null }>()
          )?.public_id ?? "",
        myRole: h.my_role,
        visibility: h.visibility,
        memberCount: Number(count?.count ?? 0),
        onlineCount: new Set(
          (await this.visiblePresenceStates(this.states()))
            .filter((s) => s.serverId === h.id)
            .map((s) => s.userId)
            .filter(Boolean),
        ).size,
        description: h.description,
        accent: h.accent,
        category: h.category,
        tags: tags.results.map((x) => x.tag),
        slowModeSeconds: h.slow_mode_seconds,
        iconUrl: h.icon_key ? `/uploads/${h.icon_key}` : null,
        bannerUrl: h.banner_key ? `/uploads/${h.banner_key}` : null,
        layout: streamerHubIds.has(h.id) ? "streamer" : "standard",
      });
    }
    this.send(ws, { type: "SERVERS_UPDATE", servers });
  }

  private async broadcastUsers(): Promise<void> {
    // This is an unsolicited account-wide event. Validate every recipient in
    // one bounded D1 pass so a failed revocation RPC cannot leave a stale
    // attachment eligible to receive a social graph update.
    const recipients = await this.liveRecipients({});
    const states = recipients.map((socket) => this.state(socket));
    for (const targetWs of recipients) {
      const viewer = this.state(targetWs);
      if (!viewer.userId) continue;
      const friendRows = await this.env.DB.prepare(
        `SELECT CASE WHEN user_a=? THEN user_b ELSE user_a END friend_id FROM decave_friendships WHERE user_a=? OR user_b=?`,
      )
        .bind(viewer.userId, viewer.userId, viewer.userId)
        .all<{ friend_id: string }>();
      const friendIds = new Set(friendRows.results.map((r) => r.friend_id));
      const users = [];
      for (const st of states) {
        if (!st.userId || !st.username) continue;
        const sameHub = Boolean(viewer.serverId && st.serverId === viewer.serverId);
        if (st.userId !== viewer.userId && !friendIds.has(st.userId) && !sameHub) continue;
        const u = await this.env.DB.prepare("SELECT * FROM decave_users WHERE id=?").bind(st.userId).first<UserRow>();
        if (!u) continue;
        if (u.status === "invisible" && st.userId !== viewer.userId) continue;
        const visibleStatus = u.status;
        users.push({
          id: st.connectionId,
          userId: publicIdOf(u),
          username: st.username,
          avatarUrl: publicUser(u).avatarUrl,
          serverId: st.serverId,
          channelId: st.channelId,
          role: st.serverId ? await getRole(this.env.DB, st.serverId, st.userId) : null,
          status: visibleStatus,
          statusText: visibleStatus === "invisible" ? "" : u.status_text,
          activityText:
            visibleStatus === "invisible"
              ? ""
              : activityTextFor(
                  u,
                  st.userId === viewer.userId ? "self" : friendIds.has(st.userId) ? "friend" : "other",
                ),
          bio: u.bio,
          accent: u.accent,
        });
      }
      this.send(targetWs, { type: "USERS_UPDATE", users });
      await this.sendServers(targetWs, viewer.userId);
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
      const isOnline = online.has(u.id) && u.status !== "invisible";
      const pub = publicUser(u);
      return {
        ...pub,
        status: isOnline ? u.status : "invisible",
        statusText: isOnline ? u.status_text : "",
        activityText: isOnline ? activityTextFor(u, relation) : "",
        online: isOnline,
      };
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
      allowStreamPreview: false,
      cameraSharing: s.dmCallVideo || s.cameraSharing,
    };
  }

  private async endDirectCall(ws: WebSocket, state: SocketState, reason: string): Promise<void> {
    const callId = state.dmCallId;
    const peerUserId = state.dmCallPeerUserId;
    const peerConnectionId = state.dmCallPeerConnectionId;
    ws.serializeAttachment({
      ...state,
      dmCallId: null,
      dmCallPeerUserId: null,
      dmCallPeerConnectionId: null,
      dmCallIncoming: false,
      dmCallAccepted: false,
      dmCallVideo: false,
      cameraSharing: false,
    });
    await this.sendToLive(ws, { type: "DM_CALL_ENDED", callId, reason });
    if (!callId || !peerUserId) return;
    const peerSocket = peerConnectionId
      ? this.socketByConnectionId(peerConnectionId)
      : await this.socketByUserId(peerUserId);
    if (!peerSocket) return;
    const peerState = this.state(peerSocket);
    if (peerState.dmCallId !== callId) return;
    peerSocket.serializeAttachment({
      ...peerState,
      dmCallId: null,
      dmCallPeerUserId: null,
      dmCallPeerConnectionId: null,
      dmCallIncoming: false,
      dmCallAccepted: false,
      dmCallVideo: false,
      cameraSharing: false,
    });
    await this.sendToLive(peerSocket, { type: "DM_CALL_ENDED", callId, reason });
  } // DECAVE_PARITY_END_DIRECT_CALL

  private async participant(s: SocketState): Promise<VoiceParticipant | null> {
    if (!s.userId || !s.username || s.voiceChannelId === null) return null;
    const user = await this.env.DB.prepare("SELECT * FROM decave_users WHERE id=?").bind(s.userId).first<UserRow>();
    const room = await getRoom(this.env.DB, s.voiceChannelId);
    return {
      connectionId: s.connectionId,
      userId: user ? publicIdOf(user) : "",
      username: s.username,
      avatarUrl: user ? publicUser(user).avatarUrl : null,
      channelId: s.voiceChannelId,
      role: room ? await getRole(this.env.DB, room.hub_id, s.userId) : null,
      muted: s.voiceMuted || s.voiceDeafened || s.voiceServerMuted || s.voiceServerDeafened,
      selfMuted: s.voiceMuted,
      deafened: s.voiceDeafened || s.voiceServerDeafened,
      selfDeafened: s.voiceDeafened,
      serverMuted: s.voiceServerMuted,
      serverDeafened: s.voiceServerDeafened,
      screenSharing: s.screenSharing,
      allowStreamPreview: s.allowStreamPreview,
      cameraSharing: s.cameraSharing,
    };
  }

  private async liveStates(): Promise<SocketState[]> {
    return (await this.liveRecipients({})).map((socket) => this.state(socket));
  }

  private async voiceParticipantsSnapshot(states: SocketState[] = this.states()) {
    // One room + participant lookup per voice socket, shared by every viewer
    // (previously N viewers x M participants D1 queries per broadcast).
    const rooms = new Map<number, RoomRow | null>();
    const entries: { room: RoomRow; participant: VoiceParticipant }[] = [];
    for (const s of states) {
      if (s.voiceChannelId === null) continue;
      if (!rooms.has(s.voiceChannelId)) rooms.set(s.voiceChannelId, await getRoom(this.env.DB, s.voiceChannelId));
      const room = rooms.get(s.voiceChannelId);
      if (!room) continue;
      const p = await this.participant(s);
      if (p) entries.push({ room, participant: p });
    }
    return entries;
  }

  private async sendVoiceState(
    ws: WebSocket,
    userId: string,
    snapshot?: { room: RoomRow; participant: VoiceParticipant }[],
    accessCache?: Map<string, boolean>,
    recipientIsLive = false,
  ): Promise<void> {
    const entries = snapshot ?? (await this.voiceParticipantsSnapshot(await this.liveStates()));
    const cache = accessCache ?? new Map<string, boolean>();
    const participants = [];
    for (const { room, participant } of entries) {
      const key = `${room.id}:${userId}`;
      let allowed = cache.get(key);
      if (allowed === undefined) {
        allowed = await canAccessRoom(this.env.DB, room, userId);
        cache.set(key, allowed);
      }
      if (allowed) participants.push(participant);
    }
    const event = { type: "VOICE_STATE", participants };
    if (recipientIsLive) this.send(ws, event);
    else await this.sendToLive(ws, event);
  }

  private async broadcastVoiceState(): Promise<void> {
    // Snapshot and recipients come from the same validated socket set; this
    // prevents expired or revoked hibernating attachments leaking into voice
    // state after an internal revocation notification failed.
    const live = await this.liveRecipients({});
    const states = live.map((socket) => this.state(socket));
    const snapshot = await this.voiceParticipantsSnapshot(states);
    const accessCache = new Map<string, boolean>();
    for (const ws of live) {
      const s = this.state(ws);
      if (s.userId) await this.sendVoiceState(ws, s.userId, snapshot, accessCache, true);
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
            await this.leaveVoiceQuiet(socket, s);
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
          socket.serializeAttachment({ ...s, channelId: fallback });
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
    if (voiceChanged) await this.broadcastVoiceState();
    return changed;
  }

  /** leaveVoice without the per-socket voice-state rebroadcast (caller batches it). */
  private async leaveVoiceQuiet(ws: WebSocket, state: SocketState): Promise<void> {
    const previous = state.voiceChannelId;
    if (previous === null) return;
    ws.serializeAttachment({
      ...state,
      voiceChannelId: null,
      voiceServerMuted: false,
      voiceServerDeafened: false,
      screenSharing: false,
      allowStreamPreview: true,
      cameraSharing: false,
    });
    await this.broadcast(
      { type: "VOICE_PEER_LEFT", connectionId: state.connectionId },
      { voiceChannelId: previous, exceptConnectionId: state.connectionId },
    );
    this.send(ws, { type: "VOICE_LEFT" });
  }

  private async leaveVoice(ws: WebSocket, state: SocketState, notifySelf: boolean): Promise<void> {
    const previous = state.voiceChannelId;
    if (previous === null) {
      if (notifySelf) this.send(ws, { type: "VOICE_LEFT" });
      return;
    }
    const next = {
      ...state,
      voiceChannelId: null,
      voiceServerMuted: false,
      voiceServerDeafened: false,
      screenSharing: false,
      allowStreamPreview: true,
      cameraSharing: false,
    };
    ws.serializeAttachment(next);
    await this.broadcast(
      { type: "VOICE_PEER_LEFT", connectionId: state.connectionId },
      { voiceChannelId: previous, exceptConnectionId: state.connectionId },
    );
    if (notifySelf) this.send(ws, { type: "VOICE_LEFT" });

    await this.broadcastVoiceState();
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
