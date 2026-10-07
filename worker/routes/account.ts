// Account settings: two-factor setup, data export, preferences, username,
// phone number, and disabling or deleting the account.

import { requireUser, securityEvent, revokeAccountSessions, clearSessionCookie } from "../lib/sessions";
import { json, bodyJson } from "../lib/http";
import {
  userRecoveryCodesRemaining,
  userMfaEnabled,
  ownerRandomMfaSecret,
  ownerEncryptMfa,
  ownerMatchingTotpStep,
  ownerDecryptMfa,
  ownerRecoveryCode,
  userRecoveryCodeStatements,
  userVerifyMfaOrRecovery,
} from "../lib/mfa";
import { verifyPassword, nowIso, privateUser, activityVisibilityOf, ensureGroupChatSchema, type UserRow } from "../db";
import {
  accountPreferencesRow,
  accountPreferencesForClient,
  parseClientSettings,
  CLIENT_SETTINGS_MAX_BYTES,
} from "../lib/account-preferences";
import { safetyProfileForClient, getSafetyProfile } from "../trust-safety";
import { allMessageSubscriptions, pushSettingsFromJson } from "../push-policy";
import { broadcastProfileUpdate, realtimeBroadcast } from "../lib/realtime";
import { validateUsername } from "../lib/validation";
import { ownedHubCount } from "../lib/hubs";
import { ensureActivitySchema } from "../lib/activity";
import { serveR2 } from "../lib/media";
import { ensurePushSchema } from "../push";
import { maskPushToken } from "../../shared/account-export";
import type { ApiContext } from "./context";

export async function handleAccountSecurityRoutes({ request, env, p, method }: ApiContext): Promise<Response | null> {
  if (p === "/api/account/mfa" || p.startsWith("/api/account/mfa/")) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const noStore = { "Cache-Control": "no-store, private" };

    if (method === "GET" && p === "/api/account/mfa") {
      const row = await env.DB.prepare("SELECT enabled_at FROM decave_user_mfa WHERE user_id=? LIMIT 1")
        .bind(user.id)
        .first<{ enabled_at: string | null }>();
      return json(
        {
          enabled: Boolean(row?.enabled_at),
          enabledAt: row?.enabled_at ?? null,
          recoveryCodesRemaining: row?.enabled_at ? await userRecoveryCodesRemaining(env.DB, user.id) : 0,
        },
        200,
        noStore,
      );
    }

    if (method !== "POST") return json({ error: "Not found" }, 404);
    const limited = await env.AUTH_RATE_LIMITER.limit({ key: `account-mfa:${user.id}` });
    if (!limited.success) return json({ error: "Too many attempts. Try again shortly." }, 429);
    const body = await bodyJson(request);
    const password = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const enabled = await userMfaEnabled(env.DB, user.id);

    if (p === "/api/account/mfa/setup") {
      if (enabled) return json({ error: "Two-factor sign-in is already on." }, 409);
      if (!(await verifyPassword(password, user.password_salt, user.password_hash))) {
        await securityEvent(env, user.id, "account.mfa_setup_reauth_failed", request);
        return json({ error: "Current password is incorrect." }, 403);
      }
      const secret = ownerRandomMfaSecret();
      const now = nowIso();
      await env.DB.prepare(
        `INSERT INTO decave_user_mfa(user_id,secret_ciphertext,enabled_at,created_at,updated_at)
         VALUES(?,?,NULL,?,?)
         ON CONFLICT(user_id) DO UPDATE SET secret_ciphertext=excluded.secret_ciphertext, enabled_at=NULL, last_totp_step=NULL, updated_at=excluded.updated_at`,
      )
        .bind(user.id, await ownerEncryptMfa(env, secret), now, now)
        .run();
      const label = user.email || user.username;
      const otpauth = `otpauth://totp/DeCave:${encodeURIComponent(label)}?secret=${encodeURIComponent(secret)}&issuer=DeCave&algorithm=SHA1&digits=6&period=30`;
      return json({ secret, otpauth }, 200, noStore);
    }

    if (p === "/api/account/mfa/enable") {
      if (enabled) return json({ error: "Two-factor sign-in is already on." }, 409);
      const code = typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";
      const row = await env.DB.prepare(
        "SELECT secret_ciphertext FROM decave_user_mfa WHERE user_id=? AND enabled_at IS NULL LIMIT 1",
      )
        .bind(user.id)
        .first<{ secret_ciphertext: string }>();
      if (!row) return json({ error: "Start setup first." }, 409);
      const matchedStep = await ownerMatchingTotpStep(await ownerDecryptMfa(env, row.secret_ciphertext), code);
      if (matchedStep === null) {
        return json({ error: "That code is not valid. Check the time on your phone and try again." }, 403);
      }
      const codes = Array.from({ length: 10 }, () => ownerRecoveryCode());
      const now = nowIso();
      const results = await env.DB.batch([
        env.DB.prepare(
          "UPDATE decave_user_mfa SET enabled_at=?,last_totp_step=?,updated_at=? WHERE user_id=? AND secret_ciphertext=? AND enabled_at IS NULL",
        ).bind(now, matchedStep, now, user.id, row.secret_ciphertext),
        ...userRecoveryCodeStatements(env, user.id, codes, now),
      ]);
      if (Number(results[0]?.meta.changes) !== 1)
        return json({ error: "Setup changed in another window. Start again." }, 409);
      await securityEvent(env, user.id, "account.mfa_enabled", request);
      return json({ enabled: true, recoveryCodes: codes }, 200, noStore);
    }

    // Turning 2FA off or replacing recovery codes needs the password and a
    // current code, so a stolen session alone cannot weaken the account.
    if (p === "/api/account/mfa/disable" || p === "/api/account/mfa/recovery-codes") {
      if (!enabled) return json({ error: "Two-factor sign-in is off." }, 409);
      if (!(await verifyPassword(password, user.password_salt, user.password_hash))) {
        await securityEvent(env, user.id, "account.mfa_reauth_failed", request);
        return json({ error: "Current password is incorrect." }, 403);
      }
      if (!(await userVerifyMfaOrRecovery(env, user.id, body.code))) {
        return json({ error: "That code is not valid." }, 403);
      }
      if (p === "/api/account/mfa/disable") {
        await env.DB.batch([
          env.DB.prepare("DELETE FROM decave_user_mfa WHERE user_id=?").bind(user.id),
          env.DB.prepare("DELETE FROM decave_user_recovery_codes WHERE user_id=?").bind(user.id),
          env.DB.prepare("DELETE FROM decave_user_login_challenges WHERE user_id=?").bind(user.id),
        ]);
        await securityEvent(env, user.id, "account.mfa_disabled", request);
        return json({ enabled: false }, 200, noStore);
      }
      const codes = Array.from({ length: 10 }, () => ownerRecoveryCode());
      await env.DB.batch(userRecoveryCodeStatements(env, user.id, codes, nowIso()));
      await securityEvent(env, user.id, "account.mfa_recovery_codes_regenerated", request);
      return json({ enabled: true, recoveryCodes: codes }, 200, noStore);
    }
    return json({ error: "Not found" }, 404);
  }

  // Exported attachment downloads require the same signed-in account and a
  // current row linking the object's key to content the account holder wrote.
  if (method === "GET" && p === "/api/account/export/attachment") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const key = new URL(request.url).searchParams.get("key") ?? "";
    if (!key || key.length > 1024 || key.includes("..") || key.includes("\\") || key.startsWith("/")) {
      return json({ error: "Attachment not found." }, 404);
    }
    const ownedReference = await env.DB.prepare(
      `SELECT 1 AS present FROM decave_attachment_access a
       WHERE a.r2_key=? AND a.owner_user_id=? AND (
         (a.kind='channel' AND EXISTS(
           SELECT 1 FROM decave_messages m WHERE m.attachment_key=a.r2_key AND m.author_user_id=?
         )) OR
         (a.kind='dm' AND EXISTS(
           SELECT 1 FROM decave_direct_messages d WHERE d.from_user_id=?
             AND (instr(d.text,a.r2_key)>0 OR instr(COALESCE(d.attachment_refs,''),a.r2_key)>0)
         ))
       )
       UNION ALL
       SELECT 1 AS present FROM decave_messages m
       WHERE m.attachment_key=? AND m.author_user_id=?
         AND NOT EXISTS(SELECT 1 FROM decave_attachment_access a WHERE a.r2_key=m.attachment_key)
       LIMIT 1`,
    )
      .bind(key, user.id, user.id, user.id, key, user.id)
      .first<{ present: number }>();
    if (!ownedReference) return json({ error: "Attachment not found." }, 404);
    const mediaRequestUrl = new URL(request.url);
    mediaRequestUrl.pathname = `/uploads/${key}`;
    return serveR2(new Request(mediaRequestUrl, request), env, user.id);
  }

  // "Download my data": stream every account-owned record in bounded pages.
  // Direct messages received by the account are included; other people's
  // channel and group messages, and files they uploaded, are excluded.
  if (method === "GET" && p === "/api/account/export") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const limited = await env.AUTH_RATE_LIMITER.limit({ key: `account-export:${user.id}` });
    if (!limited.success) return json({ error: "You just exported your data. Try again in a minute." }, 429);
    await ensureGroupChatSchema(env.DB);
    await ensureActivitySchema(env);
    await ensurePushSchema(env.DB);
    const preferences = await accountPreferencesRow(env, user.id);
    const consent = await env.DB.prepare(
      "SELECT terms_accepted_at,terms_version,privacy_version FROM decave_users WHERE id=? LIMIT 1",
    )
      .bind(user.id)
      .first<{ terms_accepted_at: string | null; terms_version: string | null; privacy_version: string | null }>();
    const [safety, activity, steam] = await Promise.all([
      getSafetyProfile(env.DB, user.id),
      env.DB.prepare(
        "SELECT manual_text,automatic_text,source,source_app_id,started_at,updated_at FROM decave_activity_state WHERE user_id=? LIMIT 1",
      )
        .bind(user.id)
        .first(),
      env.DB.prepare(
        "SELECT steam_id,persona_name,profile_url,linked_at,updated_at FROM decave_steam_links WHERE user_id=? LIMIT 1",
      )
        .bind(user.id)
        .first(),
    ]);
    await securityEvent(env, user.id, "account.data_exported", request);
    const payload = {
      exportedAt: nowIso(),
      format: "decave-account-export-v2",
      account: {
        ...privateUser(user),
        ...accountPreferencesForClient(preferences),
        twoFactorEnabled: await userMfaEnabled(env.DB, user.id),
        consent: consent ?? { terms_accepted_at: null, terms_version: null, privacy_version: null },
        safety,
        activity,
        steam,
      },
    };
    const sections = [
      {
        name: "friends",
        alias: "f",
        sql: `SELECT u.username,f.created_at AS since,f.rowid AS __export_rowid
          FROM decave_friendships f JOIN decave_users u ON u.id=CASE WHEN f.user_a=? THEN f.user_b ELSE f.user_a END
          WHERE (f.user_a=? OR f.user_b=?)`,
        binds: [user.id, user.id, user.id],
      },
      {
        name: "friendRequests",
        alias: "r",
        sql: `SELECT CASE WHEN r.sender_id=? THEN 'sent' ELSE 'received' END AS direction,u.username,r.created_at,
            r.rowid AS __export_rowid
          FROM decave_friend_requests r JOIN decave_users u ON u.id=CASE WHEN r.sender_id=? THEN r.recipient_id ELSE r.sender_id END
          WHERE (r.sender_id=? OR r.recipient_id=?)`,
        binds: [user.id, user.id, user.id, user.id],
      },
      {
        name: "blocked",
        alias: "b",
        sql: `SELECT u.username,b.created_at,b.rowid AS __export_rowid
          FROM decave_user_blocks b JOIN decave_users u ON u.id=b.blocked_user_id WHERE b.blocker_user_id=?`,
        binds: [user.id],
      },
      {
        name: "muted",
        alias: "m",
        sql: `SELECT u.username,m.created_at,m.rowid AS __export_rowid
          FROM decave_user_mutes m JOIN decave_users u ON u.id=m.muted_user_id WHERE m.muter_user_id=?`,
        binds: [user.id],
      },
      {
        name: "hubMemberships",
        alias: "m",
        sql: `SELECT h.name AS hub,m.role,m.joined_at,m.rowid AS __export_rowid
          FROM decave_hub_members m JOIN decave_hubs h ON h.id=m.hub_id WHERE m.user_id=?`,
        binds: [user.id],
      },
      {
        name: "groupChats",
        alias: "gm",
        sql: `SELECT g.name,CASE WHEN g.owner_user_id=? THEN 'owner' ELSE 'member' END AS role,gm.added_at,
            gm.rowid AS __export_rowid
          FROM decave_group_chat_members gm JOIN decave_group_chats g ON g.id=gm.group_id WHERE gm.user_id=?`,
        binds: [user.id, user.id],
      },
      {
        name: "hubRoomMessages",
        alias: "m",
        sql: `SELECT h.name AS hub,r.name AS room,m.text,m.attachment_name AS attachment,m.attachment_mime AS attachmentMime,
            m.attachment_size AS attachmentSize,m.created_at,m.edited_at,m.rowid AS __export_rowid
          FROM decave_messages m LEFT JOIN decave_rooms r ON r.id=m.room_id LEFT JOIN decave_hubs h ON h.id=m.hub_id
          WHERE m.author_user_id=?`,
        binds: [user.id],
      },
      {
        name: "directMessagesSent",
        alias: "d",
        sql: `SELECT u.username AS recipient,d.text,d.envelope,d.attachment_refs,d.created_at,d.rowid AS __export_rowid
          FROM decave_direct_messages d LEFT JOIN decave_users u ON u.id=d.to_user_id WHERE d.from_user_id=?`,
        binds: [user.id],
        transform: (row: Record<string, unknown>) => (row.envelope ? { ...row, text: "[end-to-end encrypted]" } : row),
      },
      {
        // Messages other people sent to this account are part of the account
        // holder's own conversations and are included for access/portability.
        name: "directMessagesReceived",
        alias: "d",
        sql: `SELECT u.username AS sender,d.text,d.envelope,d.attachment_refs,d.created_at,d.rowid AS __export_rowid
          FROM decave_direct_messages d LEFT JOIN decave_users u ON u.id=d.from_user_id WHERE d.to_user_id=?`,
        binds: [user.id],
        transform: (row: Record<string, unknown>) => (row.envelope ? { ...row, text: "[end-to-end encrypted]" } : row),
      },
      {
        name: "hubMessageReactions",
        alias: "mr",
        sql: `SELECT h.name AS hub,r.name AS room,mr.message_id,mr.emoji,mr.created_at,mr.rowid AS __export_rowid
          FROM decave_message_reactions mr LEFT JOIN decave_messages m ON m.id=mr.message_id
          LEFT JOIN decave_rooms r ON r.id=m.room_id LEFT JOIN decave_hubs h ON h.id=m.hub_id
          WHERE mr.user_id=?`,
        binds: [user.id],
      },
      {
        name: "directMessageReactions",
        alias: "dr",
        sql: `SELECT dr.message_id,dr.emoji,dr.created_at,dr.rowid AS __export_rowid
          FROM decave_dm_reactions dr WHERE dr.user_id=?`,
        binds: [user.id],
      },
      {
        name: "directMessageReactionEnvelopes",
        alias: "re",
        sql: `SELECT re.message_id,re.envelope,re.updated_at,re.rowid AS __export_rowid
          FROM decave_dm_reaction_envelopes re WHERE re.user_id=?`,
        binds: [user.id],
      },
      {
        name: "dmPublicKeys",
        alias: "k",
        sql: `SELECT k.key_id,k.x25519_public,k.ed25519_public,k.created_at,k.retired_at,k.previous_key_id,
            k.certificate,k.sealed_for_previous,k.rowid AS __export_rowid
          FROM decave_dm_keys k WHERE k.user_id=?`,
        binds: [user.id],
      },
      {
        name: "dmEncryptedKeyBackup",
        alias: "b",
        sql: `SELECT b.key_id,b.backup AS encryptedBackup,b.updated_at,b.rowid AS __export_rowid
          FROM decave_dm_key_backups b WHERE b.user_id=?`,
        binds: [user.id],
      },
      {
        name: "dmKeySettings",
        alias: "ks",
        sql: `SELECT ks.history_days,ks.updated_at,ks.rowid AS __export_rowid
          FROM decave_dm_key_settings ks WHERE ks.user_id=?`,
        binds: [user.id],
      },
      {
        name: "groupChatMessages",
        alias: "m",
        sql: `SELECT g.name AS groupName,m.text,m.created_at,m.rowid AS __export_rowid
          FROM decave_group_chat_messages m LEFT JOIN decave_group_chats g ON g.id=m.group_id WHERE m.from_user_id=?`,
        binds: [user.id],
      },
      {
        name: "hubEventsCreated",
        alias: "e",
        sql: `SELECT h.name AS hub,e.title,e.description,e.starts_at,e.ends_at,e.timezone,e.recurrence,e.audience,
            e.reminder_minutes,e.capacity,e.game_tag,e.created_at,e.updated_at,e.cancelled_at,e.rowid AS __export_rowid
          FROM decave_hub_events e JOIN decave_hubs h ON h.id=e.hub_id WHERE e.created_by=?`,
        binds: [user.id],
      },
      {
        name: "eventRsvps",
        alias: "r",
        sql: `SELECT h.name AS hub,e.title,e.starts_at,r.status,r.updated_at,r.rowid AS __export_rowid
          FROM decave_hub_event_rsvps r JOIN decave_hub_events e ON e.id=r.event_id
          JOIN decave_hubs h ON h.id=e.hub_id WHERE r.user_id=?`,
        binds: [user.id],
      },
      {
        name: "hubImports",
        alias: "i",
        sql: `SELECT i.hub_id,i.created_at,i.rolled_back_at,i.rowid AS __export_rowid
          FROM decave_hub_imports i WHERE i.created_by=?`,
        binds: [user.id],
      },
      {
        name: "feedback",
        alias: "f",
        sql: `SELECT f.type,f.message,f.contact_email,f.status,f.created_at,f.rowid AS __export_rowid
          FROM decave_feedback f WHERE f.user_id=?`,
        binds: [user.id],
      },
      {
        name: "signIns",
        alias: "s",
        sql: `SELECT s.client,s.device_label,s.created_at,s.last_seen_at,s.rowid AS __export_rowid
          FROM decave_session_clients s WHERE s.user_id=?`,
        binds: [user.id],
      },
      {
        name: "knownDevices",
        alias: "d",
        sql: `SELECT d.label,d.first_seen_at,d.last_seen_at,d.rowid AS __export_rowid
          FROM decave_known_devices d WHERE d.user_id=?`,
        binds: [user.id],
      },
      {
        name: "dmConversationClears",
        alias: "c",
        sql: `SELECT u.username AS partner,c.cleared_at,c.rowid AS __export_rowid
          FROM decave_dm_conversation_clears c JOIN decave_users u ON u.id=c.partner_id WHERE c.user_id=?`,
        binds: [user.id],
      },
      {
        name: "reportsFiled",
        alias: "r",
        sql: `SELECT r.id,r.target_type,r.target_public_id_snapshot AS reportedPublicId,
            r.target_username_snapshot AS reportedUsername,r.context_type,r.context_label,r.category,r.description,
            r.status,r.submitted_at,r.updated_at,r.closed_at,r.rowid AS __export_rowid
          FROM decave_reports r WHERE r.reporter_user_id=?`,
        binds: [user.id],
      },
      {
        name: "pushTokens",
        alias: "t",
        sql: `SELECT t.token AS __push_token,t.platform,t.created_at,t.rowid AS __export_rowid
          FROM decave_push_tokens t WHERE t.user_id=?`,
        binds: [user.id],
        transform: (row: Record<string, unknown>) => {
          const { __push_token: token, ...rest } = row;
          return { token: maskPushToken(token), ...rest };
        },
      },
      {
        name: "pushSubscriptions",
        alias: "p",
        sql: `SELECT h.name AS hub,r.name AS room,p.created_at,p.rowid AS __export_rowid
          FROM decave_push_subscriptions p LEFT JOIN decave_hubs h ON h.id=p.hub_id
          LEFT JOIN decave_rooms r ON r.id=p.room_id WHERE p.user_id=?`,
        binds: [user.id],
      },
      {
        name: "securityLog",
        alias: "s",
        sql: `SELECT s.event,s.user_agent,s.created_at,s.rowid AS __export_rowid
          FROM decave_security_events s WHERE s.user_id=?`,
        binds: [user.id],
      },
      {
        name: "hubRoomAttachments",
        alias: "a",
        sql: `SELECT a.r2_key AS __download_key,a.rowid AS __export_rowid,
            (SELECT m.attachment_name FROM decave_messages m WHERE m.attachment_key=a.r2_key AND m.author_user_id=? ORDER BY m.rowid LIMIT 1) AS fileName,
            (SELECT m.attachment_size FROM decave_messages m WHERE m.attachment_key=a.r2_key AND m.author_user_id=? ORDER BY m.rowid LIMIT 1) AS size,
            a.created_at
          FROM decave_attachment_access a
          WHERE a.owner_user_id=? AND a.kind='channel' AND EXISTS(
            SELECT 1 FROM decave_messages m WHERE m.attachment_key=a.r2_key AND m.author_user_id=?
          )`,
        binds: [user.id, user.id, user.id, user.id],
        transform: (row: Record<string, unknown>) => {
          const { __download_key: key, ...rest } = row;
          return {
            ...rest,
            downloadUrl: `/api/account/export/attachment?key=${encodeURIComponent(String(key ?? ""))}`,
          };
        },
      },
      {
        name: "legacyHubRoomAttachments",
        alias: "m",
        sql: `SELECT m.attachment_name AS fileName,m.attachment_mime AS mimeType,m.attachment_size AS size,
            m.created_at,m.attachment_key AS __download_key,m.rowid AS __export_rowid
          FROM decave_messages m
          WHERE m.author_user_id=? AND m.attachment_key IS NOT NULL
            AND m.rowid=(SELECT min(own.rowid) FROM decave_messages own
              WHERE own.author_user_id=m.author_user_id AND own.attachment_key=m.attachment_key)
            AND NOT EXISTS(SELECT 1 FROM decave_attachment_access a WHERE a.r2_key=m.attachment_key)`,
        binds: [user.id],
        transform: (row: Record<string, unknown>) => {
          const { __download_key: key, ...rest } = row;
          return {
            ...rest,
            downloadUrl: `/api/account/export/attachment?key=${encodeURIComponent(String(key ?? ""))}`,
          };
        },
      },
      {
        name: "directMessageAttachments",
        alias: "a",
        sql: `SELECT a.r2_key AS __download_key,a.created_at,a.rowid AS __export_rowid
          FROM decave_attachment_access a
          WHERE a.owner_user_id=? AND a.kind='dm' AND EXISTS(
            SELECT 1 FROM decave_direct_messages d WHERE d.from_user_id=?
              AND (instr(d.text,a.r2_key)>0 OR instr(COALESCE(d.attachment_refs,''),a.r2_key)>0)
          )`,
        binds: [user.id, user.id],
        transform: (row: Record<string, unknown>) => {
          const { __download_key: key, ...rest } = row;
          return {
            fileName: "attachment",
            ...rest,
            downloadUrl: `/api/account/export/attachment?key=${encodeURIComponent(String(key ?? ""))}`,
          };
        },
      },
    ] as const;
    const encoder = new TextEncoder();
    async function* exportJson(): AsyncGenerator<string> {
      yield `{"exportedAt":${JSON.stringify(payload.exportedAt)},"format":${JSON.stringify(payload.format)},"account":${JSON.stringify(payload.account)}`;
      for (const section of sections) {
        yield `,${JSON.stringify(section.name)}:[`;
        let first = true;
        let cursor = 0;
        try {
          while (true) {
            const page = await env.DB.prepare(
              `${section.sql} AND ${section.alias}.rowid>? ORDER BY ${section.alias}.rowid LIMIT ?`,
            )
              .bind(...section.binds, cursor, 100)
              .all<Record<string, unknown>>();
            if (!page.results.length) break;
            for (const result of page.results) {
              cursor = Number(result.__export_rowid);
              const { __export_rowid: _cursor, ...raw } = result;
              const row = "transform" in section && section.transform ? section.transform(raw) : raw;
              yield `${first ? "" : ","}${JSON.stringify(row)}`;
              first = false;
            }
          }
        } catch (error) {
          console.error(
            `Account export stopped while reading ${section.name}.`,
            error instanceof Error ? error.name : "UnknownError",
          );
          yield `],"complete":false,"error":"The export could not be completed. Retry the download."}`;
          return;
        }
        yield "]";
      }
      yield `,"complete":true}`;
    }
    const generator = exportJson();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await generator.next();
          if (next.done) controller.close();
          else controller.enqueue(encoder.encode(next.value));
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel() {
        await generator.return(undefined);
      },
    });
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="decave-data-${new Date().toISOString().slice(0, 10)}.json"`,
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  return null;
}

export async function handleAccountSettingsRoutes({ request, env, p, method }: ApiContext): Promise<Response | null> {
  if (method === "GET" && p === "/api/account/preferences") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const preferences = await accountPreferencesRow(env, user.id);
    return json(
      {
        username: user.username,
        email: user.email ?? null,
        emailVerified: Boolean(user.email_verified_at),
        safety: safetyProfileForClient(await getSafetyProfile(env.DB, user.id)),
        ...accountPreferencesForClient(preferences),
        activityVisibility: activityVisibilityOf(user),
      },
      200,
      { "Cache-Control": "no-store, private" },
    );
  }

  if (method === "PUT" && p === "/api/account/preferences") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const current = await accountPreferencesRow(env, user.id);
    const body = await bodyJson(request);

    const friendRequestPolicy =
      body.friendRequestPolicy === "friends_of_friends" || body.friendRequestPolicy === "none"
        ? body.friendRequestPolicy
        : body.friendRequestPolicy === "everyone"
          ? "everyone"
          : current.friend_request_policy;
    const allowStreamPreviews =
      typeof body.allowStreamPreviews === "boolean" ? body.allowStreamPreviews : current.allow_stream_previews !== 0;
    const streamerMode = typeof body.streamerMode === "boolean" ? body.streamerMode : current.streamer_mode === 1;
    const language =
      body.language === "pl" ||
      body.language === "el" ||
      body.language === "de" ||
      body.language === "fr" ||
      body.language === "es" ||
      body.language === "it" ||
      body.language === "pt" ||
      body.language === "en"
        ? body.language
        : current.language;
    const timeFormat =
      body.timeFormat === "12h" || body.timeFormat === "24h" || body.timeFormat === "system"
        ? body.timeFormat
        : current.time_format;
    const rawVoicePosition = body.voiceMiniPlayerPosition;
    const voicePositionObject =
      rawVoicePosition && typeof rawVoicePosition === "object" && !Array.isArray(rawVoicePosition)
        ? (rawVoicePosition as Record<string, unknown>)
        : null;
    const incomingVoicePosition =
      voicePositionObject &&
      Number.isFinite(Number(voicePositionObject.x)) &&
      Number.isFinite(Number(voicePositionObject.y))
        ? {
            x: Math.max(-10000, Math.min(10000, Number(voicePositionObject.x))),
            y: Math.max(-10000, Math.min(10000, Number(voicePositionObject.y))),
          }
        : null;
    const voicePositionWasProvided = Object.prototype.hasOwnProperty.call(body, "voiceMiniPlayerPosition");
    const voicePositionX = voicePositionWasProvided ? (incomingVoicePosition?.x ?? null) : current.voice_mini_player_x;
    const voicePositionY = voicePositionWasProvided ? (incomingVoicePosition?.y ?? null) : current.voice_mini_player_y;

    await env.DB.prepare(
      `UPDATE decave_account_preferences
       SET friend_request_policy=?, allow_stream_previews=?, streamer_mode=?, language=?, time_format=?, voice_mini_player_x=?, voice_mini_player_y=?, updated_at=?
       WHERE user_id=?`,
    )
      .bind(
        friendRequestPolicy,
        allowStreamPreviews ? 1 : 0,
        streamerMode ? 1 : 0,
        language,
        timeFormat,
        voicePositionX,
        voicePositionY,
        nowIso(),
        user.id,
      )
      .run();

    if (typeof body.loginAlerts === "boolean") {
      await env.DB.prepare("UPDATE decave_account_preferences SET login_alerts=? WHERE user_id=?")
        .bind(body.loginAlerts ? 1 : 0, user.id)
        .run();
    }
    // clientSettingsPatch (the iOS app): merge top-level keys into what is
    // stored, so a phone that only knows some settings doesn't wipe the rest.
    let nextClientSettings: unknown = body.clientSettings;
    if (
      !nextClientSettings &&
      body.clientSettingsPatch &&
      typeof body.clientSettingsPatch === "object" &&
      !Array.isArray(body.clientSettingsPatch)
    ) {
      const stored = parseClientSettings(current.client_settings_json);
      const patch = body.clientSettingsPatch as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...stored, v: 1 };
      for (const [key, value] of Object.entries(patch).slice(0, 20)) {
        if (key === "v") continue;
        const before = merged[key];
        // mutedHubs is always sent as the complete list, so it replaces the
        // stored one; merging would keep Hubs muted after they're unmuted.
        merged[key] =
          key !== "mutedHubs" &&
          value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          before &&
          typeof before === "object" &&
          !Array.isArray(before)
            ? { ...(before as Record<string, unknown>), ...(value as Record<string, unknown>) }
            : value;
      }
      nextClientSettings = merged;
    }
    if (nextClientSettings && typeof nextClientSettings === "object" && !Array.isArray(nextClientSettings)) {
      const serialized = JSON.stringify(nextClientSettings);
      if (new TextEncoder().encode(serialized).byteLength > CLIENT_SETTINGS_MAX_BYTES) {
        return json({ error: "Your synced settings are too large." }, 413);
      }
      await env.DB.prepare(
        "UPDATE decave_account_preferences SET client_settings_json=?, client_settings_updated_at=? WHERE user_id=?",
      )
        .bind(serialized, nowIso(), user.id)
        .run();
      // Keep the "All messages" lookup for phone notifications in step.
      try {
        const subscriptions = allMessageSubscriptions(pushSettingsFromJson(serialized));
        const stamp = nowIso();
        await env.DB.batch([
          env.DB.prepare("DELETE FROM decave_push_subscriptions WHERE user_id=?").bind(user.id),
          ...subscriptions.map((row) =>
            env.DB.prepare(
              "INSERT INTO decave_push_subscriptions(user_id,hub_id,room_id,created_at) VALUES(?,?,?,?)",
            ).bind(user.id, row.hubId, row.roomId, stamp),
          ),
        ]);
      } catch (error) {
        console.warn("Could not update push subscriptions", error instanceof Error ? error.name : "UnknownError");
      }
    }
    let activityVisibility = activityVisibilityOf(user);
    if (
      body.activityVisibility === "everyone" ||
      body.activityVisibility === "friends" ||
      body.activityVisibility === "nobody"
    ) {
      if (body.activityVisibility !== activityVisibility) {
        activityVisibility = body.activityVisibility;
        await env.DB.prepare("UPDATE decave_users SET activity_visibility=? WHERE id=?")
          .bind(activityVisibility, user.id)
          .run();
        const changed = await env.DB.prepare("SELECT * FROM decave_users WHERE id=?").bind(user.id).first<UserRow>();
        // Everyone's copy of this profile drops (or regains) the game at once.
        if (changed) await broadcastProfileUpdate(env, changed);
      }
    }

    const updated = await accountPreferencesRow(env, user.id);
    await securityEvent(env, user.id, "account.preferences_updated", request);
    return json(
      {
        ...accountPreferencesForClient(updated),
        activityVisibility,
        safety: safetyProfileForClient(await getSafetyProfile(env.DB, user.id)),
      },
      200,
      { "Cache-Control": "no-store, private" },
    );
  }

  if (method === "PUT" && p === "/api/account/username") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const limited = await env.RECOVERY_RATE_LIMITER.limit({ key: `account-username:${user.id}` });
    if (!limited.success) return json({ error: "Too many username changes. Please try again later." }, 429);
    const body = await bodyJson(request);
    if (!body) {
      return json({ error: "Invalid account mutation request.", code: "INVALID_INPUT" }, 400);
    }
    const username = validateUsername(body.username);
    if (!username) {
      return json({ error: "Username must be 3-24 characters using letters, numbers, _, . or -" }, 400);
    }
    {
      const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
      if (!(await verifyPassword(currentPassword, user.password_salt, user.password_hash))) {
        await securityEvent(env, user.id, "username.change_failed_password", request);
        return json({ error: "Current password is incorrect." }, 403);
      }
    }
    if (username.toLocaleLowerCase("en-US") === user.username.toLocaleLowerCase("en-US")) {
      return json({ error: "Choose a different username." }, 400);
    }

    const preferences = await accountPreferencesRow(env, user.id);
    if (preferences.username_changed_at) {
      const availableAt = Date.parse(preferences.username_changed_at) + 30 * 24 * 60 * 60 * 1000;
      if (Number.isFinite(availableAt) && availableAt > Date.now()) {
        return json(
          {
            error: "You can change your username once every 30 days.",
            usernameChangeAvailableAt: new Date(availableAt).toISOString(),
          },
          409,
        );
      }
    }

    const changedAt = nowIso();
    let usernameApplied: boolean;
    {
      const usernameUpdate = await env.DB.prepare(
        `UPDATE decave_users
       SET username=?
       WHERE id=?
         AND NOT EXISTS (
           SELECT 1 FROM decave_users AS other
           WHERE other.id<>? AND other.username=? COLLATE NOCASE
         )`,
      )
        .bind(username, user.id, user.id, username)
        .run();
      usernameApplied = Number(usernameUpdate.meta.changes ?? 0) === 1;
    }
    if (!usernameApplied) {
      return json({ error: "That username is already in use." }, 409);
    }
    {
      await env.DB.prepare("UPDATE decave_account_preferences SET username_changed_at=?, updated_at=? WHERE user_id=?")
        .bind(changedAt, changedAt, user.id)
        .run();
    }

    const updated = await env.DB.prepare("SELECT * FROM decave_users WHERE id=?").bind(user.id).first<UserRow>();
    if (!updated) return json({ error: "Account not found." }, 404);
    await securityEvent(env, user.id, "username.changed", request, `old=${user.username};new=${username}`);
    await broadcastProfileUpdate(env, updated);
    await realtimeBroadcast(env, { type: "SOCIAL_REFRESH" });
    const nextPreferences = await accountPreferencesRow(env, user.id);
    return json({
      user: privateUser(updated),
      ...accountPreferencesForClient(nextPreferences),
    });
  }

  if (method === "PUT" && p === "/api/account/phone") {
    return json({ error: "Phone numbers are no longer collected.", code: "FEATURE_REMOVED" }, 410);
  }

  if (method === "POST" && (p === "/api/account/disable" || p === "/api/account/delete")) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const limited = await env.RECOVERY_RATE_LIMITER.limit({ key: `account-state:${user.id}` });
    if (!limited.success) return json({ error: "Too many account changes. Please try again later." }, 429);
    const deleting = p === "/api/account/delete";
    if (user.platform_role === "owner")
      return json(
        {
          error: deleting
            ? "Platform owner accounts cannot schedule self-deletion."
            : "Platform owner accounts cannot disable themselves.",
        },
        409,
      );
    if ((await ownedHubCount(env.DB, user.id)) > 0)
      return json(
        {
          error: deleting
            ? "Transfer ownership of all Hubs you own before deleting your account."
            : "Transfer or delete every Hub you own before disabling your account.",
        },
        409,
      );
    const body = await bodyJson(request);
    if (!body) {
      return json({ error: "Invalid account mutation request.", code: "INVALID_INPUT" }, 400);
    }
    const confirm = typeof body.confirmUsername === "string" ? body.confirmUsername.trim() : "";
    {
      const password = typeof body.currentPassword === "string" ? body.currentPassword : "";
      if (!(await verifyPassword(password, user.password_salt, user.password_hash))) {
        return json({ error: "Current password is incorrect" }, 403);
      }
      if (deleting && confirm !== user.username)
        return json({ error: "Type your username exactly to confirm deletion." }, 400);
    }
    const at = nowIso();
    const deleteAfter = new Date(Date.parse(at) + 30 * 86400000).toISOString();
    const reason = deleting ? "account_deletion_scheduled" : "account_disabled";
    const event = deleting ? "account.self_deletion_scheduled" : "account.self_disabled";
    const update = deleting
      ? "deleted_at=?,delete_after=?,deletion_reason='Self-service account deletion',suspended_at=NULL,suspended_until=NULL,suspension_reason=''"
      : "suspended_at=?,suspended_until=NULL,suspension_reason='Self-disabled by account holder'";
    const bindings = deleting ? [at, deleteAfter, user.id, confirm] : [at, user.id];
    const predicate = `id=? ${deleting ? "AND username=?" : ""} AND COALESCE(platform_role,'user')<>'owner'
      AND NOT EXISTS(SELECT 1 FROM decave_hubs WHERE owner_id=decave_users.id)`;
    {
      const result = await env.DB.prepare(`UPDATE decave_users SET ${update} WHERE ${predicate}`)
        .bind(...bindings)
        .run();
      if (Number(result.meta.changes ?? 0) !== 1)
        return json({ error: "Account state changed. Fresh scoped authentication may be required." }, 409);
      await revokeAccountSessions(env, user.id, reason);
      await securityEvent(env, user.id, event, request);
    }
    return json(deleting ? { success: true, deletedAt: at, deleteAfter } : { success: true, disabledAt: at }, 200, {
      "Set-Cookie": clearSessionCookie(request),
      "Cache-Control": "no-store, private",
    });
  }

  return null;
}
