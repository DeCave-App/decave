# Backend contract — redesign 2026-10 (events, forum, realtime fixes)

Authoritative for frontend work. Source: `worker/hub-events.ts`, `worker/forum-posts.ts`,
`worker/index.ts`, `worker/HubRoom.ts`, shared types in `shared/hub-events.ts` and `shared/forum.ts`
(importable from `src/` — prefer importing the types over redefining them).
Migration: `migrations/0057_hub_events_forum_index.sql` (must be applied before deploy).

General rules
- Auth: same as every other `/api/*` route (session cookie or `Authorization: Bearer`).
- Errors: JSON `{ error: string, field?: string, code?: string }` with a 4xx status.
  `field` names the offending request field (use it for inline validation); `code` is a stable machine code.
- Hub routes accept both `/api/servers/:hubId/...` (house style) and `/api/hubs/:hubId/...` (alias) for events.
- All event timestamps are **integers in ms since epoch (UTC)**. Forum/message timestamps stay ISO strings (unchanged message format).
- IDs of users are always **public ids** (`DC-…`) on the wire.

---

## 1. Permissions

| Capability | Who |
|---|---|
| Create event | Hub owner, Hub admin, or custom role with `manageEvents` **or** `manageRooms` |
| Edit / cancel an event | Its creator, or anyone who can create events (above) |
| See an event | Owner/admin/event managers/creator always. Others: Hub member **and** can access `channelId`/`voiceChannelId` rooms (if set) **and** matches audience (`all`; `roles` → has one of the role ids; `members` → listed) |
| RSVP | Anyone who can see the event |
| Forum pin / lock | Owner, admin, or custom role `manageRooms` |
| Forum mark solved | Post author, owner/admin/`manageRooms`, or forum staff (below) |
| Forum staff (policy `staff`, may reply to locked posts) | Owner, admin, custom role with `moderateMessages` or `manageRooms`, or a custom role literally named `mod`/`moderator` (legacy) |
| Create forum post | Owner/admin always; otherwise per room `forumPostPolicy`: `everyone`; `staff` (above); `roles` (member has one of `forumPostRoleIds`); `members` (public id in `forumPostMemberIds`) |

New custom role permission: **`manageEvents`**. `POST/PATCH /api/servers/:hubId/roles[/:roleId]` now accept
`permissions` ⊆ `["manageRooms","moderateMessages","moderateMembers","voiceModerate","createInvites","viewAudit","manageEvents"]`
(unknown values dropped, duplicates removed; the old 6-item cap is gone). Role editor UI must add a toggle for it.

---

## 2. Events

### Type `HubEvent` (`shared/hub-events.ts`)
```ts
{
  id: string; hubId: number;
  channelId: number | null;        // announcement text room
  voiceChannelId: number | null;   // "Join voice" target
  title: string;                   // 1–100 chars
  description: string;             // ≤ 2000 chars ("" when none)
  coverUrl: string | null;         // "/uploads/…", "/api/media/…" or https URL
  startsAt: number;                // series start (ms)
  endsAt: number | null;           // series first-occurrence end (ms)
  timezone: string;                // IANA, e.g. "Europe/Athens" (default "UTC")
  recurrence: "none" | "daily" | "weekly" | "monthly";
  audience: "all" | "roles" | "members";
  audienceIds: string[];           // role ids (roles) | public user ids (members) | [] (all)
  reminderMinutes: number | null;  // stored only; reminders are client-side (no server push)
  capacity: number | null;         // 1–10000, max "going" RSVPs
  gameTag: string | null;          // ≤ 40 chars
  createdBy: string;               // public user id
  createdAt: number; updatedAt: number; cancelledAt: number | null;
  occurrenceStart: number;         // start of THIS occurrence (== startsAt when not recurring)
  occurrenceEnd: number | null;    // occurrenceStart + (endsAt - startsAt), or null
  rsvpCounts: { going: number; maybe: number; declined: number };
  myRsvp: "going" | "maybe" | "declined" | null;
  goingUserIds: string[];          // ≤ 12 public ids, most recent first
  canManage: boolean;              // viewer may PATCH/DELETE
}
```
RSVPs and capacity apply to the **event series** (not per occurrence).

### `GET /api/servers/:hubId/events?from=&to=[&includeCancelled=1]`
- `from`, `to`: ms. Defaults: `from = now − 31 days`, `to = from + 92 days`. Requires `to > from`, range ≤ 400 days (else 400).
- Returns occurrences overlapping `[from, to)`, recurring events expanded (wall-clock time preserved in `timezone` across DST; monthly on the 29th–31st skips months without that day). Sorted by `occurrenceStart`. Max 200 occurrences total.
- Cancelled events excluded unless `includeCancelled=1`.
- 200 → `{ events: HubEvent[], truncated: boolean, canCreate: boolean }` (`canCreate`: viewer may POST).
- 403 not a Hub member, 404 Hub not found.

### `GET /api/servers/:hubId/events/:eventId`
200 → `{ event: HubEvent }` (occurrenceStart = startsAt). 404 when missing **or not visible** to the viewer.

### `POST /api/servers/:hubId/events`
Body (JSON):
```ts
{ title: string; description?: string; coverUrl?: string | null;
  startsAt: number; endsAt?: number | null; timezone?: string;
  recurrence?: "none"|"daily"|"weekly"|"monthly";           // default "none"
  audience?: "all"|"roles"|"members"; audienceIds?: string[]; // default "all"
  reminderMinutes?: number | null; capacity?: number | null; gameTag?: string | null;
  channelId?: number | null; voiceChannelId?: number | null }
```
Validation (400 with `field`):
- `title` trimmed 1–100; `description` ≤ 2000; `coverUrl` `/uploads/…`, `/api/media/…` or `https:`.
- `startsAt` integer, **≥ now − 5 min**; `endsAt` > `startsAt` and duration ≤ 14 days.
- `timezone` valid IANA zone; `recurrence`/`audience` enums.
- `audience` `roles`/`members` require 1–100 `audienceIds`; roles must be custom roles of this Hub, members must be current Hub members (public ids).
- `reminderMinutes` 0–40320; `capacity` 1–10000.
- `channelId` must be a **text** room of this Hub the creator can access; `voiceChannelId` a **voice** room of this Hub the creator can access.
- 403 `Missing manageEvents permission`; 429 when the Hub already has 500 upcoming/recurring events.
- 201 → `{ event: HubEvent }`.

### `PATCH /api/servers/:hubId/events/:eventId`
Partial body, same fields/rules as POST (only provided keys change; `null` clears nullable fields).
`startsAt` "not in the past" is only checked when `startsAt` is sent. Changing `audience` without `audienceIds` resets them (and fails for roles/members).
403 unless creator/manager; 409 if cancelled. 200 → `{ event: HubEvent }`.

### `DELETE /api/servers/:hubId/events/:eventId`
Soft-cancel (sets `cancelledAt`, idempotent). 403 unless creator/manager. 200 → `{ success: true, id, cancelledAt: number }`.

### `PUT /api/servers/:hubId/events/:eventId/rsvp`
Body `{ status: "going" | "maybe" | "declined" | null }` (`null` removes the RSVP).
- 409 `{ code: "EVENT_FULL" }` when `going` would exceed `capacity` (switching an existing `going` is fine).
- 409 when cancelled, or a non-recurring event already ended. 400 bad status.
- 200 → `{ event: HubEvent }`.

### `GET /api/servers/:hubId/events/:eventId/ics`
`text/calendar; charset=utf-8`, `Content-Disposition: attachment; filename="<title>.ics"`. One VEVENT,
`UID:<id>@decave`, UTC `DTSTART`/`DTEND` (1 h default when no end), `RRULE:FREQ=DAILY|WEEKLY|MONTHLY` when recurring,
`STATUS:CANCELLED|CONFIRMED`, `LOCATION:<hub name>`. Use a normal authenticated fetch → Blob download (cookie auth works for `<a href>` on web).

### Realtime
After every create / update / cancel / RSVP, all **online Hub members** receive:
```json
{ "type": "HUB_EVENTS_CHANGED", "serverId": 1, "eventId": "…", "action": "created" | "updated" | "cancelled" | "rsvp" }
```
Clients should refetch the visible range (no event payload is pushed because visibility is per-user).

### Legacy
`__DECAVE_EVENT__` chat messages still render as before but are no longer the calendar source; the calendar must use
this API. Bots' `create_event` action still posts the legacy message (unchanged).

---

## 3. Forum

### Storage reality
Forum posts are still ordinary `decave_messages` rows created over the WebSocket `CHAT_MESSAGE` frame with
`text = "__DECAVE_FORUM_POST_V1__" + JSON.stringify({ version: 1, title, tags, body, iconUrl? })` and `replyToId: null`.
Replies are `CHAT_MESSAGE` with `replyToId = <postId>`. The server stores and can read the message payload.
`decave_forum_post_state` is maintained by **DB triggers** (insert post, insert/delete reply, edit post) and backfilled by the migration.

### Room fields
Room objects (`GET /api/servers`, `SERVERS_UPDATE`, create/PATCH responses) gain
`forumTags: string[]` (HTTP serializers). The raw realtime `SERVERS_UPDATE` channel rows also carry `forum_tags_json` (string).
- `POST /api/servers/:hubId/channels` (type `forum`) and `PATCH /api/channels/:id` accept `forumTags: string[]`:
  trimmed, whitespace-collapsed, ≤ 24 chars each, case-insensitively de-duplicated, ≤ 20 tags (400 `field:"forumTags"` otherwise).
- `forumPostRoleIds` must all be custom roles of this Hub (≤ 12) and `forumPostMemberIds` current Hub members' public ids (≤ 50); otherwise 400 with `field`.
- `PATCH /api/channels/:id`: `name` is optional (defaults to current), duplicate name (same type/kind in the Hub) → **409**, `position` is **ignored** (use `POST /api/servers/:hubId/channels/reorder`). Response `position` is the stored value.

### Post creation rules (WebSocket `CHAT_MESSAGE`, errors arrive as `{type:"ERROR", message, code?}`)
- Top-level message in a forum room must be a valid post payload with a non-empty `title`.
- ≤ 5 tags per post; if the room defines `forumTags`, every post tag must be in that list (case-insensitive) → `code: "FORUM_TAG_INVALID"`.
- Posting policy per §1.
- Replies must target a **top-level post of the same room** → else `code: "FORUM_REPLY_TARGET"`. Replies cannot carry the post prefix.
- Replies to a **locked** post are rejected for non-staff → `code: "FORUM_POST_LOCKED"`.
- Forum post prefix in non-forum rooms is rejected.

### Type `ForumPostEntry`
```ts
{ message: ChannelMessage;   // identical shape to GET /api/channels/:id/messages items
  replyCount: number;
  lastActivityAt: string;    // ISO; latest reply time, or post creation time
  pinned: boolean; locked: boolean;
  solvedReplyId: string | null }
```

### `GET /api/channels/:id/forum/posts?sort=&tag=&q=&cursor=`
- `sort`: `active` (default, by `lastActivityAt` desc) | `new` (creation desc) | `top` (forum_vote_up − forum_vote_down desc, then activity) | `unanswered` (`replyCount = 0`, newest first).
- Pinned posts always come first (within the filtered set).
- `tag`: exact tag, case-insensitive. `q`: substring match on post title/body (≤ 100 chars).
- Page size 25. `cursor` is opaque; pass back `nextCursor` (null when no more).
- 200 → `{ posts: ForumPostEntry[], nextCursor: string | null }`. 400 non-forum room / bad sort / bad cursor; 403 no room access.

### `GET /api/channels/:id/forum/posts/:postId`
200 → `{ post: ForumPostEntry }`; 404 if not a post of this room.

### `GET /api/channels/:id/forum/posts/:postId/replies?cursor=`
Oldest first, 50 per page. `cursor` = previous `nextCursor` (a reply id). 200 → `{ replies: ChannelMessage[], nextCursor: string | null }`.

### `PATCH /api/channels/:id/forum/posts/:postId`
Body `{ pinned?: boolean, locked?: boolean, solvedReplyId?: string | null }`.
- pinned/locked: owner/admin/`manageRooms` (403 otherwise). solvedReplyId: author/staff/managers; must be a reply of this post (400) or `null`.
- 200 → `{ postId, channelId, replyCount, lastActivityAt, pinned, locked, solvedReplyId }`.
- Broadcast to sockets subscribed to the room: `{ type: "FORUM_POST_UPDATED", serverId, postId, channelId, replyCount, lastActivityAt, pinned, locked, solvedReplyId }`.

### Message edit/delete changes (`/api/channels/:id/messages/:messageId`)
- PATCH: cannot add/remove/switch a structured prefix (`__DECAVE_FORUM_POST_V1__`, `__DECAVE_EVENT__`, `__DECAVE_POLL__`, `__DECAVE_BOT__`) → 400 `code:"STRUCTURED_TYPE_CHANGE"`.
  Editing a forum post re-applies the posting policy (403), requires a title and allowed tags; the index title/tags update automatically.
- DELETE of a forum post deletes **its whole thread** (replies + their attachments). Deleting a reply updates `replyCount`/`lastActivityAt` and clears `solvedReplyId` if it was the solution.
  Clients get `MESSAGE_DELETED` only for the post id — drop its replies locally.

---

## 4. Realtime / voice behaviour changes

New / changed server → client frames:
| Frame | When |
|---|---|
| `{type:"ROOM_ACCESS_REVOKED", serverId, channelId, fallbackChannelId, message}` | A socket's current text room became inaccessible (made private, removed from member list, role demoted, custom role edited/removed) or was deleted. Server already moved the subscription to `fallbackChannelId` (0 = none). |
| `{type:"VOICE_ERROR", message, code:"ACCESS_REVOKED"\|"ROOM_DELETED"\|"TIMED_OUT"}` followed by `{type:"VOICE_LEFT"}` | Server ended the voice session (lost access, voice room deleted, member timed out). Tear down RTC immediately. |
| `{type:"VOICE_ERROR", code:"TIMED_OUT"}` | `VOICE_JOIN`, screen share/camera **start**, or soundboard while timed out. Starting media while timed out also ends the voice session. |
| `CHANNEL_DELETED` | now includes `serverId`: `{type:"CHANNEL_DELETED", serverId, channelId, fallbackChannelId}`. |
| `HUB_EVENTS_CHANGED`, `FORUM_POST_UPDATED` | see §2/§3. |

Other fixes visible to clients:
- Voice participants in a deleted room / revoked room are removed server-side (no ghost tiles); closing a socket no longer leaves a ghost participant.
- `VOICE_MUTE` / `VOICE_DEAFEN` / `VOICE_SCREEN_STATE` / `VOICE_CAMERA_STATE`: max 20 per 10 s per connection (exceeding → `ERROR "Too many realtime requests"`, repeated abuse closes 4008); unchanged values are ignored (no broadcast). `VOICE_JOIN`/`VOICE_LEAVE`: 20 per 10 s.
- Soundboard resolves sounds from the **voice room's Hub** (not the currently viewed Hub).
- `PATCH /api/servers/:hubId/members/:userId/custom-roles` → 404 `User is not a Hub member` for non-members (was 500).
- Corrupt stored forum policy JSON no longer 500s Hub listing (treated as `[]`).

---

## 5. Bug status (B1–B13)
| ID | Fix |
|---|---|
| B1 | `/internal/recheck-access` re-runs `canAccessRoom` for all sockets in the Hub after room PATCH, member role change, custom-role assign/update/delete; resets channel, ends voice. |
| B2 | Timeouts checked on VOICE_JOIN / screen / camera / soundboard; applying a timeout ends the member's voice session. |
| B3 | Room delete ends voice sessions server-side; `CHANNEL_DELETED` includes `serverId`. |
| B4 | `webSocketClose` clears `voiceChannelId` before broadcasting voice state. |
| B5 | Voice-state broadcast builds participants once and caches access per (room,user); media-state frames rate-limited and de-duplicated. |
| B6 | Soundboard uses the voice room's Hub. |
| B7 | Custom role assign to non-member → 404. |
| B8 | Room PATCH duplicate-name check (409), `position` ignored. |
| B9 | Safe JSON parse for forum role/member ids and role permissions. |
| B10 | Structured prefix changes rejected on edit; forum policy applied to post edits. |
| B11 | Forum replies must target top-level posts; locked posts reject non-staff replies. |
| B12 | Forum policy role/member ids validated against the Hub on create/PATCH. |
| B13 | Events table + API; forum post index + feed/replies endpoints (this document). |
