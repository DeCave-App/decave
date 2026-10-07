// Per-account read markers so unread counts survive restarts and sync
// between devices. A room with no marker counts as read (its marker is created
// the first time the person opens it); DMs fall back to the person's last reply.

let readStateSchemaReady: Promise<void> | null = null;

export function ensureReadStateSchema(db: D1Database): Promise<void> {
  if (readStateSchemaReady) return readStateSchemaReady;
  readStateSchemaReady = db
    .prepare(
      `CREATE TABLE IF NOT EXISTS decave_read_state (
        user_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        target TEXT NOT NULL,
        last_read_at TEXT NOT NULL,
        PRIMARY KEY(user_id, scope, target),
        FOREIGN KEY(user_id) REFERENCES decave_users(id) ON DELETE CASCADE
      )`,
    )
    .run()
    .then(() => undefined)
    .catch((error) => {
      readStateSchemaReady = null;
      throw error;
    });
  return readStateSchemaReady;
}

/** Marks a room (by room id) or DM (by the other person's internal id) as read now. */
export async function markRead(db: D1Database, userId: string, scope: "room" | "dm", target: string): Promise<void> {
  await ensureReadStateSchema(db);
  await db
    .prepare(
      `INSERT INTO decave_read_state(user_id,scope,target,last_read_at) VALUES(?,?,?,?)
       ON CONFLICT(user_id,scope,target) DO UPDATE SET last_read_at=excluded.last_read_at`,
    )
    .bind(userId, scope, target, new Date().toISOString())
    .run();
}

/** When `readerId` last read their DM with `partnerId` (for "Seen"), or null. */
export async function dmReadAt(db: D1Database, readerId: string, partnerId: string): Promise<string | null> {
  await ensureReadStateSchema(db);
  const row = await db
    .prepare("SELECT last_read_at FROM decave_read_state WHERE user_id=? AND scope='dm' AND target=?")
    .bind(readerId, partnerId)
    .first<{ last_read_at: string }>();
  return row?.last_read_at ?? null;
}

export type UnreadSummary = {
  rooms: Array<{ channelId: number; hubId: number; count: number; mentions: number }>;
  dms: Array<{ userId: string; count: number }>;
};

/**
 * Unread counts after each marker, capped at 99. `username` is used to count
 * direct @mentions. Room access is re-checked by the caller's filter.
 */
export async function unreadSummary(
  db: D1Database,
  userId: string,
  username: string,
  canSeeRoom: (roomId: number) => Promise<boolean>,
): Promise<UnreadSummary> {
  await ensureReadStateSchema(db);
  const mention = `%@${username.replace(/[%_]/g, "\\$&")}%`;
  const rooms = await db
    .prepare(
      `SELECT r.target AS room_id, m.hub_id AS hub_id,
              COUNT(*) AS count,
              SUM(CASE WHEN m.text LIKE ? ESCAPE '\\' OR m.text LIKE '%@everyone%' THEN 1 ELSE 0 END) AS mentions
       FROM decave_read_state r
       JOIN decave_messages m ON m.room_id = CAST(r.target AS INTEGER) AND m.created_at > r.last_read_at
       WHERE r.user_id=? AND r.scope='room' AND m.author_user_id<>?
       GROUP BY r.target, m.hub_id`,
    )
    .bind(mention, userId, userId)
    .all<{ room_id: string; hub_id: number; count: number; mentions: number }>();

  // DMs with a marker count from it; never-opened DMs count from the person's
  // last reply in that conversation (or from the start if they never replied).
  const dms = await db
    .prepare(
      `SELECT u.public_id AS public_id, COUNT(*) AS count
       FROM decave_direct_messages d
       JOIN decave_users u ON u.id = d.from_user_id
       LEFT JOIN decave_read_state r ON r.user_id = d.to_user_id AND r.scope='dm' AND r.target = d.from_user_id
       WHERE d.to_user_id=?
         AND d.created_at > COALESCE(
           r.last_read_at,
           (SELECT MAX(mine.created_at) FROM decave_direct_messages mine WHERE mine.from_user_id = d.to_user_id AND mine.to_user_id = d.from_user_id),
           ''
         )
       GROUP BY u.public_id`,
    )
    .bind(userId)
    .all<{ public_id: string | null; count: number }>();

  const visibleRooms: UnreadSummary["rooms"] = [];
  for (const row of rooms.results) {
    const channelId = Number(row.room_id);
    if (!(await canSeeRoom(channelId))) continue;
    visibleRooms.push({
      channelId,
      hubId: row.hub_id,
      count: Math.min(99, row.count),
      mentions: Math.min(99, row.mentions ?? 0),
    });
  }
  return {
    rooms: visibleRooms,
    dms: dms.results
      .filter((row) => row.public_id)
      .map((row) => ({ userId: row.public_id!, count: Math.min(99, row.count) })),
  };
}
