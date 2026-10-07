// Keys for end-to-end encrypted DMs: an account's public key and its rotations,
// its recovery-code backup and history setting, other accounts' keys, and
// linking a new device to the account key.
// The server only relays public keys and ciphertext (docs/security/DM-E2EE.md).

import { requireUser, securityEvent, describeSessionDevice, normalizeSessionClient } from "../lib/sessions";
import { json, idFromPath, boundedBodyJson } from "../lib/http";
import { realtimeBroadcast } from "../lib/realtime";
import { nowIso, publicIdOf, rawSessionTokenFromRequest, tokenHash, userByReference, verifyPassword } from "../db";
import { currentDmKey, dmE2eeEnabled, dmKeyForClient, verifyDmSuccession, type DmKeyRow } from "../lib/dm-e2ee";
import {
  isDmSignature,
  parseDmKeyBackup,
  parseDmLinkSealed,
  parseDmPublicKey,
  parseDmSealedSuccessor,
  type DmKeyBackup,
} from "../../shared/dm-e2ee-format";
import type { ApiContext } from "./context";

const noStore = { "cache-control": "no-store" };
const LINK_REQUEST_TTL_MS = 10 * 60_000;
const MAX_PENDING_LINK_REQUESTS = 3;
const BODY_LIMIT = 24 * 1024;
/** Enough for ten years of monthly rotations plus resets. */
const MAX_LISTED_KEYS = 250;
const HISTORY_CHOICES = new Set([365, 90, 30]);

type LinkRequestRow = {
  id: string;
  user_id: string;
  requester_session_hash: string;
  link_public: string;
  device_label: string;
  created_at: string;
  expires_at: string;
  sealed: string | null;
  resolved_at: string | null;
};

function linkStatus(row: LinkRequestRow, now: string): "pending" | "approved" | "denied" | "expired" {
  if (row.resolved_at) return row.sealed ? "approved" : "denied";
  return row.expires_at <= now ? "expired" : "pending";
}

async function friendIds(db: D1Database, userId: string): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT CASE WHEN user_a=? THEN user_b ELSE user_a END AS friend_id
         FROM decave_friendships WHERE user_a=? OR user_b=?`,
    )
    .bind(userId, userId, userId)
    .all<{ friend_id: string }>();
  return rows.results.map((row) => row.friend_id);
}

export async function handleDmKeyRoutes({ request, env, p, method }: ApiContext): Promise<Response | null> {
  if (!p.startsWith("/api/dm-keys")) return null;
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;
  const sessionHash = tokenHash(rawSessionTokenFromRequest(request));

  // Switched off: nobody has a key, so the apps keep DMs plaintext and show nothing.
  if (!dmE2eeEnabled(env)) {
    if (p === "/api/dm-keys/me" && method === "GET")
      return json({ enabled: false, key: null, backup: null, keys: [], historyDays: null }, 200, noStore);
    if (/^\/api\/dm-keys\/users\/[^/]+$/.test(p) && method === "GET") return json({ current: null, keys: [] });
    return json({ error: "Encrypted messages aren't available yet.", code: "DM_E2EE_DISABLED" }, 403);
  }

  if (method !== "GET") {
    const limited = await env.AUTH_RATE_LIMITER.limit({ key: `dm-keys:${user.id}` });
    if (!limited.success) return json({ error: "Too many attempts. Try again shortly." }, 429);
  }

  // This account's key, all its keys (with the sealed seeds that let this account's
  // other devices follow a rotation), the recovery backup and the history setting.
  if (p === "/api/dm-keys/me" && method === "GET") {
    const [rows, backupRow, settings] = await Promise.all([
      env.DB.prepare(`SELECT * FROM decave_dm_keys WHERE user_id=? ORDER BY created_at DESC LIMIT ${MAX_LISTED_KEYS}`)
        .bind(user.id)
        .all<DmKeyRow>(),
      env.DB.prepare("SELECT key_id, backup FROM decave_dm_key_backups WHERE user_id=?")
        .bind(user.id)
        .first<{ key_id: string; backup: string }>(),
      env.DB.prepare("SELECT history_days FROM decave_dm_key_settings WHERE user_id=?")
        .bind(user.id)
        .first<{ history_days: number | null }>(),
    ]);
    const key = rows.results.find((row) => !row.retired_at) ?? null;
    return json(
      {
        enabled: true,
        key: key ? dmKeyForClient(key) : null,
        backup: key && backupRow?.key_id === key.key_id ? parseDmKeyBackup(backupRow.backup) : null,
        keys: rows.results.map((row) => ({
          ...dmKeyForClient(row),
          sealedForPrevious: row.sealed_for_previous ? parseDmSealedSuccessor(row.sealed_for_previous) : null,
        })),
        historyDays: settings?.history_days ?? null,
      },
      200,
      noStore,
    );
  }

  // Rotate: the current key signs its replacement and seals it for this account's other devices.
  if (p === "/api/dm-keys/me/rotate" && method === "POST") {
    const body = await boundedBodyJson(request, BODY_LIMIT);
    if (!body) return json({ error: "Request too large." }, 413);
    const key = parseDmPublicKey(body.key);
    const sealed = parseDmSealedSuccessor(body.sealedForPrevious);
    const certificate = isDmSignature(body.certificate) ? body.certificate : null;
    const backup = body.backup === null || body.backup === undefined ? null : parseDmKeyBackup(body.backup);
    if (!key || !sealed || !certificate || (body.backup && (!backup || backup.keyId !== key.keyId))) {
      return json({ error: "Invalid encryption key." }, 400);
    }
    const current = await currentDmKey(env.DB, user.id);
    if (!current || current.key_id !== body.previousKeyId) {
      return json({ error: "Your key already changed on another device.", code: "DM_KEY_STALE" }, 409);
    }
    if (!(await verifyDmSuccession(publicIdOf(user), current, key, certificate))) {
      return json({ error: "The new key isn't signed by your current key." }, 400);
    }
    const taken = await env.DB.prepare("SELECT 1 FROM decave_dm_keys WHERE key_id=?").bind(key.keyId).first();
    if (taken) return json({ error: "Invalid encryption key." }, 400);
    const now = nowIso();
    const statements = [
      env.DB.prepare("UPDATE decave_dm_keys SET retired_at=? WHERE key_id=? AND retired_at IS NULL").bind(
        now,
        current.key_id,
      ),
      env.DB.prepare(
        `INSERT INTO decave_dm_keys(key_id,user_id,x25519_public,ed25519_public,created_at,previous_key_id,certificate,sealed_for_previous)
         VALUES(?,?,?,?,?,?,?,?)`,
      ).bind(key.keyId, user.id, key.x25519, key.ed25519, now, current.key_id, certificate, JSON.stringify(sealed)),
    ];
    if (backup) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO decave_dm_key_backups(user_id,key_id,backup,updated_at) VALUES(?,?,?,?)
           ON CONFLICT(user_id) DO UPDATE SET key_id=excluded.key_id, backup=excluded.backup, updated_at=excluded.updated_at`,
        ).bind(user.id, key.keyId, JSON.stringify(backup), now),
      );
    }
    try {
      // Two devices rotating at once: the unique index on current keys lets only one win.
      await env.DB.batch(statements);
    } catch {
      return json({ error: "Your key already changed on another device.", code: "DM_KEY_STALE" }, 409);
    }
    await securityEvent(env, user.id, "dm_e2ee.key_rotated", request, key.keyId);
    await realtimeBroadcast(
      env,
      { type: "DM_KEYS_CHANGED", userId: publicIdOf(user), keyId: key.keyId, rotated: true },
      { userIds: [user.id, ...(await friendIds(env.DB, user.id))] },
    );
    const row = (await currentDmKey(env.DB, user.id))!;
    return json({ key: dmKeyForClient(row) }, 201);
  }

  // How long this account's devices keep replaced keys.
  if (p === "/api/dm-keys/me/settings" && method === "PUT") {
    const body = await boundedBodyJson(request, BODY_LIMIT);
    if (!body) return json({ error: "Request too large." }, 413);
    const days = body.historyDays;
    if (days !== null && !(typeof days === "number" && HISTORY_CHOICES.has(days))) {
      return json({ error: "Choose one of the offered options." }, 400);
    }
    await env.DB.prepare(
      `INSERT INTO decave_dm_key_settings(user_id,history_days,updated_at) VALUES(?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET history_days=excluded.history_days, updated_at=excluded.updated_at`,
    )
      .bind(user.id, days, nowIso())
      .run();
    await securityEvent(
      env,
      user.id,
      "dm_e2ee.history_setting_changed",
      request,
      days === null ? "always" : `${days}d`,
    );
    await realtimeBroadcast(env, { type: "DM_KEYS_CHANGED", userId: publicIdOf(user) }, { userIds: [user.id] });
    return json({ historyDays: days });
  }

  // Publish this account's key, or replace it (reset) after confirming the password.
  if (p === "/api/dm-keys/me" && method === "POST") {
    const body = await boundedBodyJson(request, BODY_LIMIT);
    if (!body) return json({ error: "Request too large." }, 413);
    const key = parseDmPublicKey(body.key);
    const backup = parseDmKeyBackup(body.backup);
    if (!key || !backup || backup.keyId !== key.keyId) return json({ error: "Invalid encryption key." }, 400);
    const existing = await currentDmKey(env.DB, user.id);
    if (existing?.key_id === key.keyId) return json({ key: dmKeyForClient(existing) });
    if (existing) {
      if (body.reset !== true) {
        return json({ error: "This account already has an encryption key.", code: "DM_KEY_EXISTS" }, 409);
      }
      const password = typeof body.currentPassword === "string" ? body.currentPassword : "";
      if (!(await verifyPassword(password, user.password_salt, user.password_hash))) {
        await securityEvent(env, user.id, "dm_e2ee.reset_reauth_failed", request);
        return json({ error: "Current password is incorrect." }, 403);
      }
    }
    const taken = await env.DB.prepare("SELECT 1 FROM decave_dm_keys WHERE key_id=?").bind(key.keyId).first();
    if (taken) return json({ error: "Invalid encryption key." }, 400);
    const now = nowIso();
    await env.DB.batch([
      env.DB.prepare("UPDATE decave_dm_keys SET retired_at=? WHERE user_id=? AND retired_at IS NULL").bind(
        now,
        user.id,
      ),
      env.DB.prepare(
        "INSERT INTO decave_dm_keys(key_id,user_id,x25519_public,ed25519_public,created_at) VALUES(?,?,?,?,?)",
      ).bind(key.keyId, user.id, key.x25519, key.ed25519, now),
      env.DB.prepare(
        `INSERT INTO decave_dm_key_backups(user_id,key_id,backup,updated_at) VALUES(?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET key_id=excluded.key_id, backup=excluded.backup, updated_at=excluded.updated_at`,
      ).bind(user.id, key.keyId, JSON.stringify(backup), now),
      // Pending link requests were for the old key.
      env.DB.prepare("DELETE FROM decave_dm_link_requests WHERE user_id=?").bind(user.id),
    ]);
    await securityEvent(env, user.id, existing ? "dm_e2ee.key_reset" : "dm_e2ee.key_created", request, key.keyId);
    const row = (await currentDmKey(env.DB, user.id))!;
    await realtimeBroadcast(
      env,
      { type: "DM_KEYS_CHANGED", userId: publicIdOf(user), keyId: key.keyId },
      { userIds: [user.id, ...(await friendIds(env.DB, user.id))] },
    );
    return json({ key: dmKeyForClient(row) }, 201);
  }

  // A new recovery code: same key, new backup.
  if (p === "/api/dm-keys/me/backup" && method === "PUT") {
    const body = await boundedBodyJson(request, BODY_LIMIT);
    if (!body) return json({ error: "Request too large." }, 413);
    const backup = parseDmKeyBackup(body.backup);
    const current = await currentDmKey(env.DB, user.id);
    if (!backup || !current || backup.keyId !== current.key_id) {
      return json({ error: "That backup is not for your current key." }, 400);
    }
    await env.DB.prepare(
      `INSERT INTO decave_dm_key_backups(user_id,key_id,backup,updated_at) VALUES(?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET key_id=excluded.key_id, backup=excluded.backup, updated_at=excluded.updated_at`,
    )
      .bind(user.id, current.key_id, JSON.stringify(backup satisfies DmKeyBackup), nowIso())
      .run();
    await securityEvent(env, user.id, "dm_e2ee.recovery_code_replaced", request);
    return json({ success: true });
  }

  // Another account's keys: the current one to encrypt to, old ones to verify old
  // messages, and the signatures linking each rotated key to the one before.
  const userKeys = idFromPath(p, /^\/api\/dm-keys\/users\/([^/]+)$/);
  if (userKeys && method === "GET") {
    const target = await userByReference(env.DB, decodeURIComponent(userKeys[1]));
    if (!target || target.deleted_at) return json({ error: "User not found" }, 404);
    const rows = await env.DB.prepare(
      `SELECT * FROM decave_dm_keys WHERE user_id=? ORDER BY created_at DESC LIMIT ${MAX_LISTED_KEYS}`,
    )
      .bind(target.id)
      .all<DmKeyRow>();
    const current = rows.results.find((row) => !row.retired_at) ?? null;
    return json({
      userId: publicIdOf(target),
      current: current ? dmKeyForClient(current) : null,
      keys: rows.results.map(dmKeyForClient),
    });
  }

  if (p === "/api/dm-keys/link-requests" && method === "POST") {
    const body = await boundedBodyJson(request, BODY_LIMIT);
    if (!body) return json({ error: "Request too large." }, 413);
    const linkPublic = typeof body.linkPublicKey === "string" ? body.linkPublicKey : "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(linkPublic)) return json({ error: "Invalid device key." }, 400);
    if (!(await currentDmKey(env.DB, user.id))) {
      return json({ error: "This account has no encryption key yet.", code: "DM_KEY_MISSING" }, 409);
    }
    const now = nowIso();
    await env.DB.prepare("DELETE FROM decave_dm_link_requests WHERE user_id=? AND expires_at<=?")
      .bind(user.id, now)
      .run();
    const pending = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM decave_dm_link_requests WHERE user_id=? AND resolved_at IS NULL",
    )
      .bind(user.id)
      .first<{ count: number }>();
    if (Number(pending?.count ?? 0) >= MAX_PENDING_LINK_REQUESTS) {
      return json({ error: "Too many devices are waiting for approval. Try again in a few minutes." }, 429);
    }
    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + LINK_REQUEST_TTL_MS).toISOString();
    const deviceLabel = describeSessionDevice(
      request.headers.get("user-agent") ?? "",
      normalizeSessionClient(body.client),
      request.headers.get("CF-IPCountry") ?? "",
    ).slice(0, 120);
    await env.DB.prepare(
      `INSERT INTO decave_dm_link_requests(id,user_id,requester_session_hash,link_public,device_label,created_at,expires_at)
       VALUES(?,?,?,?,?,?,?)`,
    )
      .bind(id, user.id, sessionHash, linkPublic, deviceLabel, now, expiresAt)
      .run();
    await securityEvent(env, user.id, "dm_e2ee.link_requested", request, deviceLabel);
    await realtimeBroadcast(env, { type: "DM_LINK_REQUEST", requestId: id }, { userIds: [user.id] });
    return json({ request: { id, expiresAt, deviceLabel } }, 201);
  }

  if (p === "/api/dm-keys/link-requests" && method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT * FROM decave_dm_link_requests
         WHERE user_id=? AND resolved_at IS NULL AND expires_at>? ORDER BY created_at DESC`,
    )
      .bind(user.id, nowIso())
      .all<LinkRequestRow>();
    return json(
      {
        requests: rows.results.map((row) => ({
          id: row.id,
          linkPublicKey: row.link_public,
          deviceLabel: row.device_label,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
          fromThisDevice: row.requester_session_hash === sessionHash,
        })),
      },
      200,
      noStore,
    );
  }

  const linkRoute = idFromPath(p, /^\/api\/dm-keys\/link-requests\/([0-9a-f-]{36})(?:\/(approve|deny))?$/);
  if (linkRoute) {
    const row = await env.DB.prepare("SELECT * FROM decave_dm_link_requests WHERE id=? AND user_id=?")
      .bind(linkRoute[1], user.id)
      .first<LinkRequestRow>();
    if (!row) return json({ error: "That request has expired." }, 404);
    const now = nowIso();
    const status = linkStatus(row, now);

    // The requesting device collects the sealed key once.
    if (!linkRoute[2] && method === "GET") {
      if (row.requester_session_hash !== sessionHash) return json({ error: "That request has expired." }, 404);
      if (status !== "pending") {
        await env.DB.prepare("DELETE FROM decave_dm_link_requests WHERE id=?").bind(row.id).run();
      }
      return json({ status, sealed: status === "approved" ? parseDmLinkSealed(row.sealed) : null }, 200, noStore);
    }

    if (method !== "POST" || !linkRoute[2]) return json({ error: "Not found" }, 404);
    if (status !== "pending") return json({ error: "That request has already been answered or expired." }, 409);

    if (linkRoute[2] === "deny") {
      await env.DB.prepare("UPDATE decave_dm_link_requests SET resolved_at=?, sealed=NULL WHERE id=?")
        .bind(now, row.id)
        .run();
      await securityEvent(env, user.id, "dm_e2ee.link_denied", request, row.device_label);
      await realtimeBroadcast(env, { type: "DM_LINK_RESOLVED", requestId: row.id }, { userIds: [user.id] });
      return json({ success: true });
    }

    if (row.requester_session_hash === sessionHash) {
      return json({ error: "Approve this from a device that can already read your messages." }, 403);
    }
    const body = await boundedBodyJson(request, BODY_LIMIT);
    if (!body) return json({ error: "Request too large." }, 413);
    const sealed = parseDmLinkSealed(body.sealed);
    const current = await currentDmKey(env.DB, user.id);
    if (!sealed || !current || sealed.keyId !== current.key_id) {
      return json({ error: "That key is not your current encryption key." }, 400);
    }
    const updated = await env.DB.prepare(
      "UPDATE decave_dm_link_requests SET resolved_at=?, sealed=? WHERE id=? AND resolved_at IS NULL",
    )
      .bind(now, JSON.stringify(sealed), row.id)
      .run();
    if (!updated.meta.changes) return json({ error: "That request has already been answered." }, 409);
    await securityEvent(env, user.id, "dm_e2ee.link_approved", request, row.device_label);
    await realtimeBroadcast(env, { type: "DM_LINK_RESOLVED", requestId: row.id }, { userIds: [user.id] });
    return json({ success: true });
  }

  return json({ error: "Not found" }, 404);
}
