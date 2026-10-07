import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export type ServerRole = "owner" | "admin" | "member";
export type PresenceStatus = "online" | "idle" | "dnd" | "invisible";
export type PlatformRole = "user" | "admin" | "owner";
export type CustomRolePermission =
  | "manageRooms"
  | "moderateMessages"
  | "moderateMembers"
  | "voiceModerate"
  | "createInvites"
  | "viewAudit"
  | "manageEvents";

export type UserRow = {
  id: string;
  public_id: string | null;
  username: string;
  password_salt: string;
  password_hash: string;
  created_at: string;
  avatar_key: string | null;
  avatar_updated_at: string | null;
  /** Added in migration 0061: "everyone" | "friends" | "nobody". */
  activity_visibility?: string;
  /** Added in migration 0060; undefined on databases that have not run it yet. */
  display_name?: string;
  pronouns?: string;
  banner_key?: string | null;
  banner_updated_at?: string | null;
  bio: string;
  status: PresenceStatus;
  status_text: string;
  activity_text: string;
  accent: string;
  email: string | null;
  email_normalized: string | null;
  email_verified_at: string | null;
  requires_email_verification: number;
  platform_role: PlatformRole;
  suspended_at: string | null;
  suspended_until: string | null;
  suspension_reason: string;
  must_reset_password: number;
  deleted_at: string | null;
  delete_after: string | null;
  deletion_reason: string;
  erased_at: string | null;
};

export type HubRow = {
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
  chat_background_key: string | null;
  created_at: string;
  updated_at: string;
};

export type RoomRow = {
  id: number;
  hub_id: number;
  name: string;
  type: "text" | "voice";
  kind: "chat" | "forum";
  category: string;
  position: number;
  private: number;
  icon: string;
  forum_guidelines: string;
  forum_post_policy: "everyone" | "staff" | "roles" | "members";
  forum_post_role_ids_json: string;
  forum_post_member_ids_json: string;
  forum_tags_json?: string;
};

export type GroupChatRow = {
  id: string;
  name: string;
  owner_user_id: string;
  created_at: string;
  updated_at: string;
};

type PasswordScryptOptions = { N: number; r: number; p: number; maxmem: number };

function scryptAsync(
  password: string,
  salt: string,
  keyLength: number,
  options: PasswordScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

// New hashes use N=2^15, r=8 and p=3 (six times the legacy p=1 work).
// This uses roughly 32 MiB per active derivation; rate limits bound concurrent
// requests. The Worker runtime must support these Node crypto options.
const PASSWORD_SCRYPT_OPTIONS = { N: 1 << 15, r: 8, p: 3, maxmem: 48 * 1024 * 1024 } as const;
const LEGACY_PASSWORD_SCRYPT_OPTIONS = { N: 1 << 14, r: 8, p: 1, maxmem: 32 * 1024 * 1024 } as const;
const PASSWORD_HASH_VERSION = "scrypt-v2";

/**
 * A well-formed current-version hash that no password matches. Login verifies
 * against it when the identifier is unknown so that path runs the same v2
 * scrypt cost as a real upgraded account (no timing-based enumeration).
 */
export const DUMMY_PASSWORD_HASH = `${PASSWORD_HASH_VERSION}$${"00".repeat(64)}`;
export const DUMMY_PASSWORD_SALT = "decave-login-dummy-salt-v2";

let groupChatSchemaReady: Promise<void> | null = null;

export function ensureGroupChatSchema(db: D1Database): Promise<void> {
  if (groupChatSchemaReady) return groupChatSchemaReady;

  const ready = db
    .batch([
      db.prepare(
        `CREATE TABLE IF NOT EXISTS decave_group_chats (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          owner_user_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(owner_user_id) REFERENCES decave_users(id) ON DELETE CASCADE
        )`,
      ),
      db.prepare(
        `CREATE TABLE IF NOT EXISTS decave_group_chat_members (
          group_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          added_at TEXT NOT NULL,
          PRIMARY KEY(group_id, user_id),
          FOREIGN KEY(group_id) REFERENCES decave_group_chats(id) ON DELETE CASCADE,
          FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
        )`,
      ),
      db.prepare(
        `CREATE TABLE IF NOT EXISTS decave_group_chat_messages (
          id TEXT PRIMARY KEY,
          group_id TEXT NOT NULL,
          from_user_id TEXT NOT NULL,
          text TEXT NOT NULL,
          created_at TEXT NOT NULL,
          reply_to_id TEXT,
          FOREIGN KEY(group_id) REFERENCES decave_group_chats(id) ON DELETE CASCADE,
          FOREIGN KEY(from_user_id) REFERENCES decave_users(id) ON DELETE CASCADE
        )`,
      ),
      db.prepare(
        `CREATE INDEX IF NOT EXISTS idx_decave_group_chat_members_user
         ON decave_group_chat_members(user_id, group_id)`,
      ),
      db.prepare(
        `CREATE INDEX IF NOT EXISTS idx_decave_group_chat_messages_group_created
         ON decave_group_chat_messages(group_id, created_at)`,
      ),
    ])
    .then(async () => {
      // Group-chat tables predate reply support and are created lazily rather
      // than by a numbered D1 migration. Upgrade an existing installation
      // after the idempotent create statements have completed.
      const columns = await db.prepare("PRAGMA table_info(decave_group_chat_messages)").all<{ name: string }>();
      if (!columns.results.some((column) => column.name === "reply_to_id")) {
        await db.prepare("ALTER TABLE decave_group_chat_messages ADD COLUMN reply_to_id TEXT").run();
      }
      await db
        .prepare(
          `CREATE INDEX IF NOT EXISTS idx_decave_group_chat_messages_reply
           ON decave_group_chat_messages(group_id, reply_to_id)`,
        )
        .run();
    })
    .catch((error) => {
      groupChatSchemaReady = null;
      throw error;
    });

  groupChatSchemaReady = ready;
  return ready;
}

export async function groupChatMemberIds(db: D1Database, groupId: string): Promise<string[]> {
  await ensureGroupChatSchema(db);
  const rows = await db
    .prepare(
      `SELECT user_id
       FROM decave_group_chat_members
       WHERE group_id=?
       ORDER BY added_at ASC, user_id ASC`,
    )
    .bind(groupId)
    .all<{ user_id: string }>();
  return rows.results.map((row) => row.user_id);
}

export async function isGroupChatMember(db: D1Database, groupId: string, userId: string): Promise<boolean> {
  await ensureGroupChatSchema(db);
  const row = await db
    .prepare(
      `SELECT 1 AS found
       FROM decave_group_chat_members
       WHERE group_id=? AND user_id=?
       LIMIT 1`,
    )
    .bind(groupId, userId)
    .first<{ found: number }>();
  return Boolean(row?.found);
}

export async function usersAreFriends(db: D1Database, firstUserId: string, secondUserId: string): Promise<boolean> {
  if (!firstUserId || !secondUserId || firstUserId === secondUserId) return false;
  const [userA, userB] = [firstUserId, secondUserId].sort();
  const row = await db
    .prepare(
      `SELECT 1 AS found
       FROM decave_friendships
       WHERE user_a=? AND user_b=?
       LIMIT 1`,
    )
    .bind(userA, userB)
    .first<{ found: number }>();
  return Boolean(row?.found);
}

export function publicIdOf(user: Pick<UserRow, "id" | "public_id">): string {
  return user.public_id?.trim() || "";
}

export function createPublicUserId(): string {
  return `DC-${randomBytes(8).toString("hex").toUpperCase()}`;
}

export async function userByReference(db: D1Database, reference: string): Promise<UserRow | null> {
  const value = reference.trim();
  if (!value || value.length > 128) return null;
  return (
    (await db
      .prepare(
        `SELECT * FROM decave_users
         WHERE public_id = ? COLLATE NOCASE
            OR username = ? COLLATE NOCASE
         LIMIT 1`,
      )
      .bind(value, value)
      .first<UserRow>()) ?? null
  );
}

export async function canAccessRoom(db: D1Database, room: RoomRow, userId: string): Promise<boolean> {
  const role = await getRole(db, room.hub_id, userId);
  if (!role) return false;
  if (Number(room.private) !== 1) return true;
  if (role === "owner" || role === "admin") return true;
  return hasPermission(db, room.hub_id, userId, "manageRooms");
}

export async function usersSharePublicContext(
  db: D1Database,
  firstUserId: string,
  secondUserId: string,
): Promise<boolean> {
  if (!firstUserId || !secondUserId) return false;
  if (firstUserId === secondUserId) return true;
  if (await usersAreFriends(db, firstUserId, secondUserId)) return true;
  const pendingRequest = await db
    .prepare(
      `SELECT 1 AS found FROM decave_friend_requests
       WHERE (sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)
       LIMIT 1`,
    )
    .bind(firstUserId, secondUserId, secondUserId, firstUserId)
    .first<{ found: number }>();
  if (pendingRequest?.found) return true;
  const sharedHub = await db
    .prepare(
      `SELECT 1 AS found
       FROM decave_hub_members a
       JOIN decave_hub_members b ON b.hub_id=a.hub_id
       WHERE a.user_id=? AND b.user_id=?
       LIMIT 1`,
    )
    .bind(firstUserId, secondUserId)
    .first<{ found: number }>();
  return Boolean(sharedHub?.found);
}

export async function consumeWsToken(db: D1Database, rawToken: string): Promise<UserRow | null> {
  if (!rawToken) return null;
  const now = nowIso();
  const claimed = await db
    .prepare(
      `UPDATE decave_ws_tokens
       SET used_at=?
       WHERE token_hash=? AND used_at IS NULL AND expires_at>?
       RETURNING user_id`,
    )
    .bind(now, tokenHash(rawToken), now)
    .first<{ user_id: string }>();
  if (!claimed?.user_id) return null;
  return (
    (await db.prepare("SELECT * FROM decave_users WHERE id=? LIMIT 1").bind(claimed.user_id).first<UserRow>()) ?? null
  );
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Opaque, stable identifier for a session shown in the signed-in devices list.
 * Derived from the stored token hash with a domain-separation prefix so the
 * stored lookup key itself is never exposed to clients.
 */
export function sessionPublicId(sessionTokenHash: string): string {
  return createHash("sha256").update(`decave-session-public-id-v1\0${sessionTokenHash}`).digest("hex").slice(0, 32);
}

export function createRawToken(): string {
  return randomBytes(32).toString("hex");
}

export async function hashPassword(password: string, salt?: string): Promise<{ salt: string; hash: string }> {
  const actualSalt = salt ?? randomBytes(16).toString("hex");
  const key = (await scryptAsync(password, actualSalt, 64, PASSWORD_SCRYPT_OPTIONS)) as Buffer;
  return { salt: actualSalt, hash: `${PASSWORD_HASH_VERSION}$${key.toString("hex")}` };
}

export async function verifyPassword(password: string, salt: string, expectedHex: string): Promise<boolean> {
  const currentVersion = expectedHex.startsWith(`${PASSWORD_HASH_VERSION}$`);
  const expectedValue = currentVersion ? expectedHex.slice(PASSWORD_HASH_VERSION.length + 1) : expectedHex;
  const options = currentVersion ? PASSWORD_SCRYPT_OPTIONS : LEGACY_PASSWORD_SCRYPT_OPTIONS;
  const actualKey = (await scryptAsync(password, salt, 64, options)) as Buffer;
  const expected = Buffer.from(expectedValue, "hex");
  const actual = actualKey;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function passwordHashNeedsUpgrade(expectedHash: string): boolean {
  return !expectedHash.startsWith(`${PASSWORD_HASH_VERSION}$`);
}

export function rawSessionTokenFromRequest(request: Request): string {
  const cookie = request.headers.get("Cookie") ?? "";

  // Production cookie first.
  const productionMatch = cookie.match(/(?:^|;\s*)__Host-decave_session=([^;]+)/);
  if (productionMatch?.[1]) {
    try {
      return decodeURIComponent(productionMatch[1]);
    } catch {
      return productionMatch[1];
    }
  }

  // Local wrangler dev cookie. This is intentionally a different name because
  // __Host- cookies require Secure and are not reliable over http://127.0.0.1.
  const localMatch = cookie.match(/(?:^|;\s*)decave_session_local=([^;]+)/);
  if (localMatch?.[1]) {
    try {
      return decodeURIComponent(localMatch[1]);
    } catch {
      return localMatch[1];
    }
  }

  const auth = request.headers.get("Authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

export async function userFromBearer(db: D1Database, request: Request): Promise<UserRow | null> {
  const auth = request.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  return userFromRawToken(db, auth.slice(7).trim());
}

export async function userFromRequest(db: D1Database, request: Request): Promise<UserRow | null> {
  const raw = rawSessionTokenFromRequest(request);
  return raw ? userFromRawToken(db, raw) : null;
}

export async function userFromRawToken(db: D1Database, token: string): Promise<UserRow | null> {
  if (!token) return null;
  const hash = tokenHash(token);
  const legacy = await db
    .prepare(
      `SELECT u.*
         FROM decave_sessions s
         JOIN decave_users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?
         LIMIT 1`,
    )
    .bind(hash, nowIso())
    .first<UserRow>();
  return legacy ?? null;
}

export async function getRole(db: D1Database, hubId: number, userId: string): Promise<ServerRole | null> {
  const row = await db
    .prepare("SELECT role FROM decave_hub_members WHERE hub_id = ? AND user_id = ?")
    .bind(hubId, userId)
    .first<{ role: ServerRole }>();
  return row?.role ?? null;
}

export type OfficialHubPostingPolicy = { status: "available"; ownerOnly: boolean } | { status: "unavailable" };

export type OfficialHubPostingDecision = "allow" | "deny" | "unavailable";

export async function getOfficialHubPostingPolicy(db: D1Database, hubId: number): Promise<OfficialHubPostingPolicy> {
  try {
    const row = await db
      .prepare("SELECT owner_only_posts FROM decave_official_hubs WHERE hub_id=? LIMIT 1")
      .bind(hubId)
      .first<{ owner_only_posts: unknown }>();
    if (!row) return { status: "available", ownerOnly: false };
    if (
      typeof row.owner_only_posts !== "number" ||
      !Number.isInteger(row.owner_only_posts) ||
      (row.owner_only_posts !== 0 && row.owner_only_posts !== 1)
    ) {
      return { status: "unavailable" };
    }
    return {
      status: "available",
      ownerOnly: row.owner_only_posts === 1,
    };
  } catch {
    return { status: "unavailable" };
  }
}

export async function officialHubPostingDecision(
  db: D1Database,
  hubId: number,
  userId: string,
): Promise<OfficialHubPostingDecision> {
  const policy = await getOfficialHubPostingPolicy(db, hubId);
  if (policy.status === "unavailable") return "unavailable";
  if (!policy.ownerOnly) return "allow";

  try {
    return (await getRole(db, hubId, userId)) === "owner" ? "allow" : "deny";
  } catch {
    return "unavailable";
  }
}

export async function getHub(db: D1Database, hubId: number): Promise<HubRow | null> {
  return (await db.prepare("SELECT * FROM decave_hubs WHERE id = ?").bind(hubId).first<HubRow>()) ?? null;
}

export async function getRoom(db: D1Database, roomId: number): Promise<RoomRow | null> {
  return (await db.prepare("SELECT * FROM decave_rooms WHERE id = ?").bind(roomId).first<RoomRow>()) ?? null;
}

export async function customPermissions(
  db: D1Database,
  hubId: number,
  userId: string,
): Promise<Set<CustomRolePermission>> {
  const result = await db
    .prepare(
      `SELECT cr.permissions_json
       FROM decave_member_roles mr
       JOIN decave_custom_roles cr ON cr.id = mr.role_id
       WHERE mr.hub_id = ? AND mr.user_id = ?`,
    )
    .bind(hubId, userId)
    .all<{ permissions_json: string }>();

  const out = new Set<CustomRolePermission>();
  const allowed = new Set<CustomRolePermission>([
    "manageRooms",
    "moderateMessages",
    "moderateMembers",
    "voiceModerate",
    "createInvites",
    "viewAudit",
    "manageEvents",
  ]);

  for (const row of result.results) {
    try {
      const values = JSON.parse(row.permissions_json) as unknown[];
      for (const value of values) {
        if (typeof value === "string" && allowed.has(value as CustomRolePermission)) {
          out.add(value as CustomRolePermission);
        }
      }
    } catch {}
  }
  return out;
}

export async function hasPermission(
  db: D1Database,
  hubId: number,
  userId: string,
  permission: CustomRolePermission,
): Promise<boolean> {
  const role = await getRole(db, hubId, userId);
  if (role === "owner" || role === "admin") return true;
  return (await customPermissions(db, hubId, userId)).has(permission);
}

export type ActivityVisibility = "everyone" | "friends" | "nobody";

export function activityVisibilityOf(user: Pick<UserRow, "activity_visibility">): ActivityVisibility {
  return user.activity_visibility === "friends" || user.activity_visibility === "nobody"
    ? user.activity_visibility
    : "everyone";
}

/**
 * The game activity a viewer may see. `relation` is the viewer's relation to
 * `user`: the account itself, a friend, or anyone else.
 */
export function activityTextFor(
  user: Pick<UserRow, "activity_text" | "activity_visibility">,
  relation: "self" | "friend" | "other",
): string {
  const visibility = activityVisibilityOf(user);
  if (relation === "self" || visibility === "everyone") return user.activity_text ?? "";
  if (visibility === "friends" && relation === "friend") return user.activity_text ?? "";
  return "";
}

export function publicUser(user: UserRow) {
  // Public/social serialization intentionally uses the opaque public DeCave ID.
  // The database UUID never leaves the Worker through this serializer.
  const decaveId = publicIdOf(user);
  return {
    id: decaveId,
    decaveId,
    username: user.username,
    avatarUrl: user.avatar_key
      ? `/api/users/${encodeURIComponent(decaveId)}/avatar?v=${encodeURIComponent(user.avatar_updated_at ?? "")}`
      : null,
    displayName: user.display_name ?? "",
    pronouns: user.pronouns ?? "",
    bannerUrl: user.banner_key
      ? `/api/users/${encodeURIComponent(decaveId)}/banner?v=${encodeURIComponent(user.banner_updated_at ?? "")}`
      : null,
    bio: user.bio,
    status: user.status,
    statusText: user.status_text,
    // Public serialization goes to people with no known relation, so it only
    // carries activity the user shows to everyone.
    activityText: activityTextFor(user, "other"),
    accent: user.accent,
  };
}

/** Public profile fields with presence details hidden for disconnected users. */
export function publicUserWithPresence(user: UserRow, online: boolean, relation: "friend" | "other" = "other") {
  const visibleOnline = online && user.status !== "invisible";
  return {
    ...publicUser(user),
    status: visibleOnline ? user.status : "invisible",
    statusText: visibleOnline ? user.status_text : "",
    activityText: visibleOnline ? activityTextFor(user, relation) : "",
  };
}

export function privateUser(user: UserRow) {
  // Private/self serialization. This may only be returned to the authenticated
  // account that owns these fields. Server-side authorization remains authoritative.
  return {
    ...publicUser(user),
    activityText: user.activity_text,
    activityVisibility: activityVisibilityOf(user),
    // Account creation time is private account metadata; only return it to the account owner.
    createdAt: user.created_at,
    email: user.email,
    emailVerified: Boolean(user.email_verified_at),
    platformRole: user.platform_role,
  };
}

export async function audit(
  db: D1Database,
  hubId: number,
  actorUserId: string,
  action: string,
  targetUserId?: string,
  detail = "",
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO decave_audit
       (id, hub_id, action, actor_user_id, target_user_id, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), hubId, action, actorUserId, targetUserId ?? null, detail, nowIso())
    .run();
}

function safeStringArray(value: unknown): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Forum "staff": Hub owner/admin, or a custom role granting moderateMessages or
 * manageRooms. A custom role literally named "mod"/"moderator" also counts for
 * backwards compatibility with Hubs created before role permissions existed.
 */
export async function isForumStaff(db: D1Database, hubId: number, userId: string): Promise<boolean> {
  const role = await getRole(db, hubId, userId);
  if (!role) return false;
  if (role === "owner" || role === "admin") return true;
  const perms = await customPermissions(db, hubId, userId);
  if (perms.has("moderateMessages") || perms.has("manageRooms")) return true;
  const named = await db
    .prepare(
      `SELECT 1 AS found FROM decave_member_roles mr
       JOIN decave_custom_roles cr ON cr.id=mr.role_id
       WHERE mr.hub_id=? AND mr.user_id=? AND LOWER(cr.name) IN ('mod','moderator')
       LIMIT 1`,
    )
    .bind(hubId, userId)
    .first<{ found: number }>();
  return Boolean(named);
}

/** Single source of truth for "may this user create a top-level forum post". */
export async function canCreateForumPost(db: D1Database, room: RoomRow, userId: string): Promise<boolean> {
  const role = await getRole(db, room.hub_id, userId);
  if (!role) return false;
  if (role === "owner" || role === "admin") return true;
  const policy = room.forum_post_policy;
  if (policy === "everyone" || !policy) return true;
  if (policy === "staff") return isForumStaff(db, room.hub_id, userId);
  if (policy === "roles") {
    const roleIds = safeStringArray(room.forum_post_role_ids_json).slice(0, 50);
    if (!roleIds.length) return false;
    const found = await db
      .prepare(
        `SELECT 1 AS found FROM decave_member_roles WHERE hub_id=? AND user_id=? AND role_id IN (${roleIds.map(() => "?").join(",")}) LIMIT 1`,
      )
      .bind(room.hub_id, userId, ...roleIds)
      .first<{ found: number }>();
    return Boolean(found);
  }
  if (policy === "members") {
    const user = await db
      .prepare("SELECT id, public_id FROM decave_users WHERE id=?")
      .bind(userId)
      .first<Pick<UserRow, "id" | "public_id">>();
    return Boolean(user && safeStringArray(room.forum_post_member_ids_json).includes(publicIdOf(user)));
  }
  return false;
}

/** Active Hub timeout (expires_at in the future). */
export async function isTimedOut(db: D1Database, hubId: number, userId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT expires_at FROM decave_timeouts WHERE hub_id=? AND user_id=?")
    .bind(hubId, userId)
    .first<{ expires_at: string }>();
  return Boolean(row && Date.parse(row.expires_at) > Date.now());
}
