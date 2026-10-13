// Account settings: two-factor setup, data export, preferences, username,
// phone number, and disabling or deleting the account.

import {
  requireUser,
  securityEvent,
  revokeAccountSessions,
  clearSessionCookie,
  currentPasswordThrottle,
} from "../lib/sessions";
import { json, bodyJson, apiError, apiErrorLegacy } from "../lib/http";
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
import { ensurePushSchema } from "../push";
import { isDateStyleLanguage } from "../../shared/date-style";
import { accountExportChunks, accountExportResponse, accountExportSections } from "../lib/account-export";
import { serveR2 } from "../lib/media";
import {
  accountPreferencesRow,
  accountPreferencesForClient,
  parseClientSettings,
  CLIENT_SETTINGS_MAX_BYTES,
  accountConnections,
  isConnectionProvider,
  setConnectionVisibility,
} from "../lib/account-preferences";
import { safetyProfileForClient, getSafetyProfile } from "../trust-safety";
import { allMessageSubscriptions, pushSettingsFromJson } from "../push-policy";
import { broadcastProfileUpdate, realtimeBroadcast } from "../lib/realtime";
import { validateUsername } from "../lib/validation";
import { ownedHubCount } from "../lib/hubs";
import { storedLocale } from "../lib/i18n";
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

    if (method !== "POST") return apiError("common.notFound", 404);
    const limited = await env.AUTH_RATE_LIMITER.limit({ key: `account-mfa:${user.id}` });
    if (!limited.success) return apiError("common.tooManyAttempts", 429);
    const body = await bodyJson(request);
    const password = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const enabled = await userMfaEnabled(env.DB, user.id);

    if (p === "/api/account/mfa/setup") {
      if (enabled) return apiError("account.mfaAlreadyOn", 409);
      const passwordThrottle = await currentPasswordThrottle(env, user.id);
      if (passwordThrottle) return passwordThrottle;
      if (!(await verifyPassword(password, user.password_salt, user.password_hash))) {
        await securityEvent(env, user.id, "account.mfa_setup_reauth_failed", request);
        return apiError("common.currentPasswordIncorrect", 403);
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
      if (enabled) return apiError("account.mfaAlreadyOn", 409);
      const code = typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";
      const row = await env.DB.prepare(
        "SELECT secret_ciphertext FROM decave_user_mfa WHERE user_id=? AND enabled_at IS NULL LIMIT 1",
      )
        .bind(user.id)
        .first<{ secret_ciphertext: string }>();
      if (!row) return apiError("account.mfaSetupNotStarted", 409);
      const matchedStep = await ownerMatchingTotpStep(await ownerDecryptMfa(env, row.secret_ciphertext), code);
      if (matchedStep === null) {
        return apiError("account.codeInvalidCheckTime", 403);
      }
      const codes = Array.from({ length: 10 }, () => ownerRecoveryCode());
      const now = nowIso();
      const results = await env.DB.batch([
        env.DB.prepare(
          "UPDATE decave_user_mfa SET enabled_at=?,last_totp_step=?,updated_at=? WHERE user_id=? AND secret_ciphertext=? AND enabled_at IS NULL",
        ).bind(now, matchedStep, now, user.id, row.secret_ciphertext),
        ...userRecoveryCodeStatements(env, user.id, codes, now),
      ]);
      if (Number(results[0]?.meta.changes) !== 1) return apiError("account.mfaSetupChanged", 409);
      await securityEvent(env, user.id, "account.mfa_enabled", request);
      return json({ enabled: true, recoveryCodes: codes }, 200, noStore);
    }

    // Turning 2FA off or replacing recovery codes needs the password and a
    // current code, so a stolen session alone cannot weaken the account.
    if (p === "/api/account/mfa/disable" || p === "/api/account/mfa/recovery-codes") {
      if (!enabled) return apiError("account.mfaOff", 409);
      const passwordThrottle = await currentPasswordThrottle(env, user.id);
      if (passwordThrottle) return passwordThrottle;
      if (!(await verifyPassword(password, user.password_salt, user.password_hash))) {
        await securityEvent(env, user.id, "account.mfa_reauth_failed", request);
        return apiError("common.currentPasswordIncorrect", 403);
      }
      if (!(await userVerifyMfaOrRecovery(env, user.id, body.code))) {
        return apiError("account.codeInvalid", 403);
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
    return apiError("common.notFound", 404);
  }

  // Export attachment downloads must still point to a live object referenced by
  // content this account authored. The attachment-access row alone is not enough:
  // a DM recipient may access the original, but must not export another person's
  // upload as their own data.
  if (method === "GET" && p === "/api/account/export/attachment") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const key = new URL(request.url).searchParams.get("key") ?? "";
    if (!key || key.length > 1024 || key.includes("..") || key.includes("\\") || key.startsWith("/")) {
      return apiError("account.attachmentNotFound", 404);
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
    if (!ownedReference) return apiError("account.attachmentNotFound", 404);

    const mediaRequestUrl = new URL(request.url);
    mediaRequestUrl.pathname = `/uploads/${key.split("/").map(encodeURIComponent).join("/")}`;
    const response = await serveR2(new Request(mediaRequestUrl, request), env, user.id);
    if (response.status !== 200) return response;
    const headers = new Headers(response.headers);
    headers.set("cache-control", "no-store, private");
    if (!/^attachment(?:\s*;|$)/i.test(headers.get("content-disposition") ?? "")) {
      headers.set("content-disposition", "attachment");
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  // "Download my data": streamed by worker/lib/account-export.ts.
  if (method === "GET" && p === "/api/account/export") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const limited = await env.AUTH_RATE_LIMITER.limit({ key: `account-export:${user.id}` });
    if (!limited.success) return apiError("account.exportCooldown", 429);
    // Lazily created tables and columns the export reads.
    await ensureGroupChatSchema(env.DB);
    await ensurePushSchema(env.DB);
    const preferences = await accountPreferencesRow(env, user.id);
    const consent = await env.DB.prepare(
      "SELECT terms_accepted_at,terms_version,privacy_version FROM decave_users WHERE id=? LIMIT 1",
    )
      .bind(user.id)
      .first<{ terms_accepted_at: string | null; terms_version: string | null; privacy_version: string | null }>();
    await securityEvent(env, user.id, "account.data_exported", request);
    const header = {
      exportedAt: nowIso(),
      format: "decave-account-export-v2",
      note: "End-to-end encrypted content (envelopes, key backup, sealed keys) is exported as stored: ciphertext the server cannot read. The last field, complete, is true only when the whole export was written.",
      account: {
        ...privateUser(user),
        ...accountPreferencesForClient(preferences),
        twoFactorEnabled: await userMfaEnabled(env.DB, user.id),
        consent: consent ?? { terms_accepted_at: null, terms_version: null, privacy_version: null },
      },
    };
    return accountExportResponse(accountExportChunks(env.DB, header, accountExportSections(user.id)));
  }

  return null;
}

export async function handleAccountSettingsRoutes({ request, env, p, method }: ApiContext): Promise<Response | null> {
  if (method === "PUT" && p === "/api/account/locale") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const body = await bodyJson(request);
    const locale = body.locale === null ? null : storedLocale(body.locale);
    if (locale === null && body.locale !== null) {
      return apiError("account.localeInvalid", 400);
    }
    await env.DB.prepare("UPDATE decave_users SET locale=? WHERE id=?").bind(locale, user.id).run();
    return json({ locale });
  }

  if (method === "GET" && p === "/api/account/connections") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    return json({ connections: await accountConnections(env, user.id) }, 200, { "Cache-Control": "no-store, private" });
  }

  const visibilityRoute = p.match(/^\/api\/account\/connections\/([a-z0-9_-]{1,32})\/visibility$/);
  if (method === "PUT" && visibilityRoute) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const provider = visibilityRoute[1];
    if (!isConnectionProvider(provider)) return apiError("connections.unknownProvider", 404);
    const body = await bodyJson(request);
    if (typeof body.showOnProfile !== "boolean") return apiError("connections.visibilityInvalid", 400);
    await setConnectionVisibility(env, user.id, provider, body.showOnProfile);
    return json({ provider, showOnProfile: body.showOnProfile });
  }

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
    const language = isDateStyleLanguage(body.language) ? body.language : current.language;
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
        return apiError("account.settingsTooLarge", 413);
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
    const body = await bodyJson(request);
    if (!body) {
      return apiErrorLegacy("INVALID_INPUT", "account.invalidMutation", 400);
    }
    const username = validateUsername(body.username);
    if (!username) {
      return apiError("common.usernameFormat", 400);
    }
    {
      const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
      const passwordThrottle = await currentPasswordThrottle(env, user.id);
      if (passwordThrottle) return passwordThrottle;
      if (!(await verifyPassword(currentPassword, user.password_salt, user.password_hash))) {
        await securityEvent(env, user.id, "username.change_failed_password", request);
        return apiError("common.currentPasswordIncorrect", 403);
      }
    }
    if (username.toLocaleLowerCase("en-US") === user.username.toLocaleLowerCase("en-US")) {
      return apiError("account.usernameUnchanged", 400);
    }

    const preferences = await accountPreferencesRow(env, user.id);
    if (preferences.username_changed_at) {
      const availableAt = Date.parse(preferences.username_changed_at) + 30 * 24 * 60 * 60 * 1000;
      if (Number.isFinite(availableAt) && availableAt > Date.now()) {
        return apiError("account.usernameChangeCooldown", 409, undefined, undefined, {
          usernameChangeAvailableAt: new Date(availableAt).toISOString(),
        });
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
      return apiError("account.usernameTaken", 409);
    }
    {
      await env.DB.prepare("UPDATE decave_account_preferences SET username_changed_at=?, updated_at=? WHERE user_id=?")
        .bind(changedAt, changedAt, user.id)
        .run();
    }

    const updated = await env.DB.prepare("SELECT * FROM decave_users WHERE id=?").bind(user.id).first<UserRow>();
    if (!updated) return apiError("account.notFound", 404);
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
    // DeCave no longer collects phone numbers (nothing used them).
    return apiErrorLegacy("FEATURE_REMOVED", "account.phoneRemoved", 410);
  }

  if (method === "POST" && (p === "/api/account/disable" || p === "/api/account/delete")) {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;
    const deleting = p === "/api/account/delete";
    if (user.platform_role === "owner")
      return apiError(deleting ? "account.ownerCannotDelete" : "account.ownerCannotDisable", 409);
    if ((await ownedHubCount(env.DB, user.id)) > 0)
      return apiError(deleting ? "account.hubsOwnedBeforeDelete" : "account.hubsOwnedBeforeDisable", 409);
    const body = await bodyJson(request);
    if (!body) {
      return apiErrorLegacy("INVALID_INPUT", "account.invalidMutation", 400);
    }
    const confirm = typeof body.confirmUsername === "string" ? body.confirmUsername.trim() : "";
    {
      const password = typeof body.currentPassword === "string" ? body.currentPassword : "";
      const passwordThrottle = await currentPasswordThrottle(env, user.id);
      if (passwordThrottle) return passwordThrottle;
      if (!(await verifyPassword(password, user.password_salt, user.password_hash))) {
        return apiError("common.currentPasswordIncorrectShort", 403);
      }
      if (deleting && confirm !== user.username) return apiError("account.deleteConfirmMismatch", 400);
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
      if (Number(result.meta.changes ?? 0) !== 1) return apiError("account.stateChanged", 409);
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
