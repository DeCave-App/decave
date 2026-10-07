// Mobile push notifications through the Expo push service.
//
// Devices register an Expo push token after sign-in. The realtime room sends a
// push only to recipients with no open realtime connection, so people who are
// in the app get the in-app notification instead of a duplicate.

type PushEnv = { DB: D1Database };

export type PushMessage = {
  title: string;
  body: string;
  /** In-app route the notification opens, e.g. "/dm/<id>". */
  route: string;
  threadId?: string;
};

let pushSchemaReady: Promise<void> | null = null;

export function ensurePushSchema(db: D1Database): Promise<void> {
  if (pushSchemaReady) return pushSchemaReady;
  pushSchemaReady = db
    .batch([
      db.prepare(
        `CREATE TABLE IF NOT EXISTS decave_push_tokens (
          token TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          session_hash TEXT,
          platform TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
        )`,
      ),
      db.prepare("CREATE INDEX IF NOT EXISTS idx_decave_push_tokens_user ON decave_push_tokens(user_id)"),
      db.prepare(
        "CREATE INDEX IF NOT EXISTS idx_decave_push_tokens_user_session_hash ON decave_push_tokens(user_id,session_hash)",
      ),
    ])
    .then(() => undefined)
    .catch((error) => {
      pushSchemaReady = null;
      throw error;
    });
  return pushSchemaReady;
}

export function isExpoPushToken(value: unknown): value is string {
  return typeof value === "string" && /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,}\]$/.test(value);
}

export async function registerPushToken(
  env: PushEnv,
  userId: string,
  sessionHash: string,
  token: string,
  platform: string,
): Promise<void> {
  if (!sessionHash) throw new Error("Push registration requires an authenticated session");
  await ensurePushSchema(env.DB);
  // A token belongs to one active account session; re-registration moves it.
  await env.DB.prepare(
    `INSERT INTO decave_push_tokens(token,user_id,session_hash,platform,created_at)
     SELECT ?,?,?,?,? WHERE EXISTS(
       SELECT 1 FROM decave_sessions s JOIN decave_users u ON u.id=s.user_id
       WHERE s.token_hash=? AND s.user_id=? AND s.expires_at>?
         AND u.erased_at IS NULL AND u.deleted_at IS NULL AND u.must_reset_password=0
         AND u.erasure_started_at IS NULL
         AND (u.suspended_at IS NULL OR (u.suspended_until IS NOT NULL AND u.suspended_until<=?) )
     )
     ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id, session_hash=excluded.session_hash,
       platform=excluded.platform, created_at=excluded.created_at`,
  )
    .bind(
      token,
      userId,
      sessionHash,
      platform === "android" ? "android" : "ios",
      new Date().toISOString(),
      sessionHash,
      userId,
      new Date().toISOString(),
      new Date().toISOString(),
    )
    .run();
}

export async function removePushToken(env: PushEnv, userId: string, sessionHash: string, token: string): Promise<void> {
  if (!sessionHash) return;
  await ensurePushSchema(env.DB);
  await env.DB.prepare("DELETE FROM decave_push_tokens WHERE token=? AND user_id=? AND session_hash=?")
    .bind(token, userId, sessionHash)
    .run();
}

export async function removePushTokensForSession(env: PushEnv, sessionHash: string): Promise<void> {
  await ensurePushSchema(env.DB);
  await env.DB.prepare("DELETE FROM decave_push_tokens WHERE session_hash=?").bind(sessionHash).run();
}

export async function removePushTokensForUser(env: PushEnv, userId: string): Promise<void> {
  await ensurePushSchema(env.DB);
  await env.DB.prepare("DELETE FROM decave_push_tokens WHERE user_id=?").bind(userId).run();
}

/** Sends one notification to every registered device of the given users. Never throws. */
export async function sendPush(env: PushEnv, userIds: string[], message: PushMessage): Promise<void> {
  if (userIds.length === 0) return;
  try {
    await ensurePushSchema(env.DB);
    const registered: Array<{ token: string; session_hash: string }> = [];
    for (let offset = 0; offset < userIds.length; offset += 90) {
      const chunk = userIds.slice(offset, offset + 90);
      const placeholders = chunk.map(() => "?").join(",");
      const rows = await env.DB.prepare(
        `SELECT p.token,p.session_hash FROM decave_push_tokens p
         JOIN decave_sessions s ON s.token_hash=p.session_hash AND s.user_id=p.user_id
         JOIN decave_users u ON u.id=p.user_id
         WHERE p.user_id IN (${placeholders}) AND p.session_hash IS NOT NULL AND s.expires_at>?
           AND u.erased_at IS NULL AND u.deleted_at IS NULL AND u.must_reset_password=0
           AND u.erasure_started_at IS NULL
           AND (u.suspended_at IS NULL OR (u.suspended_until IS NOT NULL AND u.suspended_until<=?))`,
      )
        .bind(...chunk, new Date().toISOString(), new Date().toISOString())
        .all<{ token: string; session_hash: string }>();
      registered.push(...rows.results);
    }
    if (registered.length === 0) return;

    // Recheck bounded pairs immediately before handing tokens to Expo. This
    // blocks rows loaded before logout or session revocation when that happens
    // during settings or recipient processing.
    const activeKeys = new Set<string>();
    for (let offset = 0; offset < registered.length; offset += 40) {
      const chunk = registered.slice(offset, offset + 40);
      const current = await env.DB.prepare(
        `SELECT p.token,p.session_hash FROM decave_push_tokens p
         JOIN decave_sessions s ON s.token_hash=p.session_hash AND s.user_id=p.user_id
         JOIN decave_users u ON u.id=p.user_id
         WHERE s.expires_at>? AND u.erased_at IS NULL AND u.deleted_at IS NULL AND u.must_reset_password=0
           AND u.erasure_started_at IS NULL
           AND (u.suspended_at IS NULL OR (u.suspended_until IS NOT NULL AND u.suspended_until<=?))
           AND (${chunk.map(() => "(p.token=? AND p.session_hash=?)").join(" OR ")})`,
      )
        .bind(
          new Date().toISOString(),
          new Date().toISOString(),
          ...chunk.flatMap(({ token, session_hash }) => [token, session_hash]),
        )
        .all<{ token: string; session_hash: string }>();
      for (const row of current.results) activeKeys.add(`${row.token}\u0000${row.session_hash}`);
    }
    const active = registered.filter((row) => activeKeys.has(`${row.token}\u0000${row.session_hash}`));

    // Expo accepts batches of at most 100 tokens; smaller chunks also keep
    // subsequent stale-token cleanup well below SQLite's bind limit.
    for (let offset = 0; offset < active.length; offset += 100) {
      const sent = active.slice(offset, offset + 100);
      const payload = sent.map(({ token: to }) => ({
        to,
        title: message.title.slice(0, 120),
        body: message.body.slice(0, 240),
        sound: "default",
        data: { route: message.route },
        ...(message.threadId ? { threadId: message.threadId } : {}),
      }));
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        console.warn("[push] Expo push send failed", response.status);
        continue;
      }
      const result = (await response.json()) as { data?: Array<{ status?: string; details?: { error?: string } }> };
      const stale = (result.data ?? [])
        .map((ticket, index) => (ticket.details?.error === "DeviceNotRegistered" ? sent[index] : null))
        .filter((row): row is { token: string; session_hash: string } => !!row);
      // Keep each cleanup statement below the D1 bind limit even when Expo
      // returns a full 100-token response with every token stale.
      for (let staleOffset = 0; staleOffset < stale.length; staleOffset += 40) {
        const staleChunk = stale.slice(staleOffset, staleOffset + 40);
        await env.DB.prepare(
          `DELETE FROM decave_push_tokens WHERE ${staleChunk.map(() => "(token=? AND session_hash=?)").join(" OR ")}`,
        )
          .bind(...staleChunk.flatMap(({ token, session_hash }) => [token, session_hash]))
          .run();
      }
    }
  } catch (error) {
    console.warn("[push] could not send", error instanceof Error ? error.name : "UnknownError");
  }
}

/** Preview text for a message body, hiding attachment and GIF payloads. */
export function pushPreview(text: string): string {
  if (text.startsWith("__DECAVE_GIF__")) return "Sent a GIF";
  if (text.startsWith("__DECAVE_DM_ATTACHMENT__")) return "Sent an attachment";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 140 ? `${clean.slice(0, 137)}…` : clean;
}
