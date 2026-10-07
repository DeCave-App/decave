// Forum feed endpoints backed by decave_forum_post_state (migration 0057).
import { getRoom, hasPermission, isForumStaff, type RoomRow, type UserRow } from "./db";
import { FORUM_PAGE_SIZE, FORUM_REPLY_PAGE_SIZE, FORUM_SORTS, type ForumSort } from "../shared/forum";

export type ForumDeps = {
  json(data: unknown, status?: number, headers?: HeadersInit): Response;
  requireUser(request: Request): Promise<UserRow | Response>;
  canAccessRoom(room: RoomRow, userId: string): Promise<boolean>;
  bodyJson(request: Request): Promise<Record<string, unknown>>;
  broadcast(event: unknown, filter: Record<string, unknown>): Promise<void>;
  messagesForClient(ids: readonly string[]): Promise<unknown[]>;
};

type PostStateRow = {
  message_id: string;
  channel_id: number;
  pinned: number;
  locked: number;
  solved_reply_id: string | null;
  last_activity_at: string;
  reply_count: number;
  author_user_id: string;
};

const FORUM_ROUTE = /^\/api\/channels\/(\d+)\/forum\/posts(?:\/([^/]+))?(?:\/(replies))?$/;

export function matchForumRoute(pathname: string): RegExpMatchArray | null {
  return pathname.match(FORUM_ROUTE);
}

function encodeCursor(value: Record<string, unknown>): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeCursor(value: string | null): Record<string, unknown> | null | false {
  if (!value) return null;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(atob(padded + "===".slice((padded.length + 3) % 4)));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : false;
  } catch {
    return false;
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function stateForClient(row: PostStateRow) {
  return {
    replyCount: Number(row.reply_count),
    lastActivityAt: row.last_activity_at,
    pinned: row.pinned === 1,
    locked: row.locked === 1,
    solvedReplyId: row.solved_reply_id,
  };
}

export async function handleForumRoute(
  request: Request,
  env: { DB: D1Database },
  match: RegExpMatchArray,
  deps: ForumDeps,
): Promise<Response | null> {
  const db = env.DB;
  const method = request.method.toUpperCase();
  const roomId = Number(match[1]);
  const postId = match[2] ? decodeURIComponent(match[2]) : null;
  const replies = match[3] === "replies";
  const allowed =
    (!postId && method === "GET") ||
    (postId && replies && method === "GET") ||
    (postId && !replies && (method === "PATCH" || method === "GET"));
  if (!allowed) return null;

  const user = await deps.requireUser(request);
  if (user instanceof Response) return user;
  const room = await getRoom(db, roomId);
  if (!room) return deps.json({ error: "Room not found" }, 404);
  if (!(await deps.canAccessRoom(room, user.id)))
    return deps.json({ error: "You do not have access to this room" }, 403);
  if (room.kind !== "forum") return deps.json({ error: "This room is not a forum" }, 400);
  const url = new URL(request.url);

  if (!postId) {
    const sortParam = url.searchParams.get("sort") ?? "active";
    if (!FORUM_SORTS.includes(sortParam as ForumSort))
      return deps.json({ error: "sort must be active, new, top or unanswered" }, 400);
    const sort = sortParam as ForumSort;
    const tag = (url.searchParams.get("tag") ?? "").trim().slice(0, 24);
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    const cursor = decodeCursor(url.searchParams.get("cursor"));
    if (cursor === false) return deps.json({ error: "Invalid cursor" }, 400);
    const offset = cursor && Number.isSafeInteger(cursor.o) && Number(cursor.o) >= 0 ? Number(cursor.o) : 0;
    if (offset > 10_000) return deps.json({ posts: [], nextCursor: null });
    // Optional smaller page (the Hub sidebar asks for a few posts per forum).
    const limitParam = Number(url.searchParams.get("limit"));
    const pageSize =
      Number.isSafeInteger(limitParam) && limitParam >= 1 && limitParam <= FORUM_PAGE_SIZE
        ? limitParam
        : FORUM_PAGE_SIZE;

    const where: string[] = ["s.channel_id=?"];
    const binds: unknown[] = [roomId];
    if (tag) {
      where.push(
        "EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(s.tags_json) THEN s.tags_json ELSE '[]' END) t WHERE LOWER(CAST(t.value AS TEXT))=LOWER(?))",
      );
      binds.push(tag);
    }
    if (q) {
      where.push("(LOWER(m.text) LIKE LOWER(?) ESCAPE '\\' OR LOWER(s.title) LIKE LOWER(?) ESCAPE '\\')");
      binds.push(`%${escapeLike(q)}%`, `%${escapeLike(q)}%`);
    }
    if (sort === "unanswered") where.push("s.reply_count=0");
    const score = `(SELECT COALESCE(SUM(CASE r.emoji WHEN 'forum_vote_up' THEN 1 WHEN 'forum_vote_down' THEN -1 ELSE 0 END),0)
                    FROM decave_message_reactions r WHERE r.message_id=s.message_id)`;
    const order =
      sort === "new" || sort === "unanswered"
        ? "m.created_at DESC, s.message_id DESC"
        : sort === "top"
          ? `${score} DESC, s.last_activity_at DESC, s.message_id DESC`
          : "s.last_activity_at DESC, s.message_id DESC";
    const rows = await db
      .prepare(
        `SELECT s.*, m.author_user_id FROM decave_forum_post_state s
       JOIN decave_messages m ON m.id=s.message_id
       WHERE ${where.join(" AND ")}
       ORDER BY s.pinned DESC, ${order}
       LIMIT ? OFFSET ?`,
      )
      .bind(...binds, pageSize + 1, offset)
      .all<PostStateRow>();
    const page = rows.results.slice(0, pageSize);
    const messages = (await deps.messagesForClient(page.map((r) => r.message_id))) as { id: string }[];
    const byId = new Map(messages.map((m) => [m.id, m]));
    return deps.json({
      posts: page.flatMap((r) =>
        byId.has(r.message_id) ? [{ message: byId.get(r.message_id), ...stateForClient(r) }] : [],
      ),
      nextCursor: rows.results.length > pageSize ? encodeCursor({ o: offset + pageSize }) : null,
    });
  }

  const post = await db
    .prepare(
      `SELECT s.*, m.author_user_id FROM decave_forum_post_state s JOIN decave_messages m ON m.id=s.message_id
     WHERE s.message_id=? AND s.channel_id=?`,
    )
    .bind(postId, roomId)
    .first<PostStateRow>();
  if (!post) return deps.json({ error: "Post not found" }, 404);

  if (method === "GET" && !replies) {
    const [message] = await deps.messagesForClient([post.message_id]);
    return deps.json({ post: { message, ...stateForClient(post) } });
  }

  if (replies) {
    const before = url.searchParams.get("cursor");
    let anchor: { created_at: string; id: string } | null = null;
    if (before) {
      anchor = await db
        .prepare("SELECT id, created_at FROM decave_messages WHERE id=? AND reply_to_id=? AND room_id=?")
        .bind(before, postId, roomId)
        .first<{ id: string; created_at: string }>();
      if (!anchor) return deps.json({ error: "Invalid cursor" }, 400);
    }
    const rows = await db
      .prepare(
        `SELECT id FROM decave_messages WHERE reply_to_id=? AND room_id=?
       ${anchor ? "AND (created_at > ? OR (created_at = ? AND id > ?))" : ""}
       ORDER BY created_at ASC, id ASC LIMIT ?`,
      )
      .bind(
        postId,
        roomId,
        ...(anchor ? [anchor.created_at, anchor.created_at, anchor.id] : []),
        FORUM_REPLY_PAGE_SIZE + 1,
      )
      .all<{ id: string }>();
    const page = rows.results.slice(0, FORUM_REPLY_PAGE_SIZE);
    return deps.json({
      replies: await deps.messagesForClient(page.map((r) => r.id)),
      nextCursor: rows.results.length > FORUM_REPLY_PAGE_SIZE ? page[page.length - 1].id : null,
    });
  }

  // PATCH
  const body = await deps.bodyJson(request);
  const wantsModeration = body.pinned !== undefined || body.locked !== undefined;
  const wantsSolved = body.solvedReplyId !== undefined;
  if (!wantsModeration && !wantsSolved) return deps.json({ error: "Nothing to update" }, 400);
  if (body.pinned !== undefined && typeof body.pinned !== "boolean")
    return deps.json({ error: "pinned must be a boolean" }, 400);
  if (body.locked !== undefined && typeof body.locked !== "boolean")
    return deps.json({ error: "locked must be a boolean" }, 400);
  if (wantsSolved && body.solvedReplyId !== null && typeof body.solvedReplyId !== "string")
    return deps.json({ error: "solvedReplyId must be a reply id or null" }, 400);
  const manager = await hasPermission(db, room.hub_id, user.id, "manageRooms");
  if (wantsModeration && !manager) return deps.json({ error: "Missing manageRooms permission" }, 403);
  if (wantsSolved && !manager && post.author_user_id !== user.id && !(await isForumStaff(db, room.hub_id, user.id))) {
    return deps.json({ error: "Only the post author or a forum moderator can mark a solution" }, 403);
  }
  let solved = post.solved_reply_id;
  if (wantsSolved) {
    if (body.solvedReplyId === null) solved = null;
    else {
      const reply = await db
        .prepare("SELECT 1 AS found FROM decave_messages WHERE id=? AND reply_to_id=? AND room_id=?")
        .bind(body.solvedReplyId, postId, roomId)
        .first<{ found: number }>();
      if (!reply) return deps.json({ error: "The solution must be a reply to this post" }, 400);
      solved = body.solvedReplyId as string;
    }
  }
  const pinned = body.pinned === undefined ? post.pinned : body.pinned ? 1 : 0;
  const locked = body.locked === undefined ? post.locked : body.locked ? 1 : 0;
  await db
    .prepare(
      "UPDATE decave_forum_post_state SET pinned=?, locked=?, solved_reply_id=?, updated_at=? WHERE message_id=?",
    )
    .bind(pinned, locked, solved, new Date().toISOString(), postId)
    .run();
  const updated = { ...post, pinned, locked, solved_reply_id: solved };
  const payload = { postId, channelId: roomId, ...stateForClient(updated) };
  try {
    await deps.broadcast({ type: "FORUM_POST_UPDATED", serverId: room.hub_id, ...payload }, { channelId: roomId });
  } catch {}
  return deps.json(payload);
}
