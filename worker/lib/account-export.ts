// "Download my data" (GDPR Art. 15/20): every account-owned record, streamed
// in bounded pages so a large account never has to fit in Worker memory.
//
// The JSON object ends with `"complete":true` (or `"complete":false` and an
// error), written last, so a client can tell a truncated download from a
// whole one (shared/account-export.ts). Messages other people sent are not
// included (they are those people's data); conversations name the peer.
//
// End-to-end encrypted data is exported exactly as the server holds it: public
// keys, the key backup, sealed link-request payloads and message/reaction
// envelopes are opaque ciphertext. The server cannot and does not decrypt them;
// the account's own devices (or its recovery code) can.

import { maskPushToken } from "../../shared/account-export";

type Row = Record<string, unknown>;

type ExportSection = {
  name: string;
  /** Table alias whose rowid pages the query. */
  alias: string;
  /** A SELECT ending in a WHERE clause; paging conditions are appended. */
  sql: string;
  binds: unknown[];
  transform?: (row: Row) => Row;
};

const PAGE_SIZE = 100;

export function accountExportSections(userId: string): ExportSection[] {
  const me = userId;
  return [
    {
      name: "friends",
      alias: "f",
      sql: `SELECT u.username, f.created_at AS since, f.rowid AS __rowid FROM decave_friendships f
        JOIN decave_users u ON u.id = CASE WHEN f.user_a=? THEN f.user_b ELSE f.user_a END
        WHERE (f.user_a=? OR f.user_b=?)`,
      binds: [me, me, me],
    },
    {
      name: "friendRequests",
      alias: "r",
      sql: `SELECT CASE WHEN r.sender_id=? THEN 'sent' ELSE 'received' END AS direction, u.username, r.created_at,
          r.rowid AS __rowid
        FROM decave_friend_requests r
        JOIN decave_users u ON u.id = CASE WHEN r.sender_id=? THEN r.recipient_id ELSE r.sender_id END
        WHERE (r.sender_id=? OR r.recipient_id=?)`,
      binds: [me, me, me, me],
    },
    {
      name: "blocked",
      alias: "b",
      sql: `SELECT u.username, b.created_at, b.rowid AS __rowid FROM decave_user_blocks b
        JOIN decave_users u ON u.id=b.blocked_user_id WHERE b.blocker_user_id=?`,
      binds: [me],
    },
    {
      name: "muted",
      alias: "m",
      sql: `SELECT u.username, m.created_at, m.rowid AS __rowid FROM decave_user_mutes m
        JOIN decave_users u ON u.id=m.muted_user_id WHERE m.muter_user_id=?`,
      binds: [me],
    },
    {
      name: "hubs",
      alias: "m",
      sql: `SELECT h.name AS hub, m.role, m.joined_at, m.rowid AS __rowid FROM decave_hub_members m
        JOIN decave_hubs h ON h.id=m.hub_id WHERE m.user_id=?`,
      binds: [me],
    },
    {
      name: "groupChats",
      alias: "gm",
      sql: `SELECT COALESCE(NULLIF(g.name,''),'Group chat') AS name,
          CASE WHEN g.owner_user_id=? THEN 'owner' ELSE 'member' END AS role, gm.added_at, gm.rowid AS __rowid
        FROM decave_group_chat_members gm JOIN decave_group_chats g ON g.id=gm.group_id WHERE gm.user_id=?`,
      binds: [me, me],
    },
    {
      name: "hubRoomMessages",
      alias: "m",
      sql: `SELECT h.name AS hub, r.name AS room, m.text, m.attachment_name AS attachment, m.created_at, m.edited_at,
          m.rowid AS __rowid
        FROM decave_messages m LEFT JOIN decave_rooms r ON r.id=m.room_id LEFT JOIN decave_hubs h ON h.id=m.hub_id
        WHERE m.author_user_id=? AND (m.visible_to_user_id IS NULL OR m.visible_to_user_id=?)`,
      binds: [me, me],
    },
    {
      // Only include channel uploads this account owns and has referenced from
      // a message it authored. The download route rechecks this relationship.
      name: "hubRoomAttachments",
      alias: "a",
      sql: `SELECT a.r2_key AS __download_key,a.created_at,a.rowid AS __rowid,
          (SELECT m.attachment_name FROM decave_messages m
            WHERE m.attachment_key=a.r2_key AND m.author_user_id=? ORDER BY m.rowid LIMIT 1) AS fileName,
          (SELECT m.attachment_mime FROM decave_messages m
            WHERE m.attachment_key=a.r2_key AND m.author_user_id=? ORDER BY m.rowid LIMIT 1) AS mimeType,
          (SELECT m.attachment_size FROM decave_messages m
            WHERE m.attachment_key=a.r2_key AND m.author_user_id=? ORDER BY m.rowid LIMIT 1) AS size
        FROM decave_attachment_access a
        WHERE a.owner_user_id=? AND a.kind='channel' AND EXISTS(
          SELECT 1 FROM decave_messages m WHERE m.attachment_key=a.r2_key AND m.author_user_id=?
        )`,
      binds: [me, me, me, me, me],
      transform: ({ __download_key: key, ...row }) => ({
        ...row,
        downloadUrl: `/api/account/export/attachment?key=${encodeURIComponent(String(key ?? ""))}`,
      }),
    },
    {
      // Historical Hub uploads predate decave_attachment_access. Deduplicate
      // by object key and keep this limited to the account's authored messages.
      name: "legacyHubRoomAttachments",
      alias: "m",
      sql: `SELECT m.attachment_name AS fileName,m.attachment_mime AS mimeType,m.attachment_size AS size,
          m.created_at,m.attachment_key AS __download_key,m.rowid AS __rowid
        FROM decave_messages m
        WHERE m.author_user_id=? AND m.attachment_key IS NOT NULL
          AND m.rowid=(SELECT min(own.rowid) FROM decave_messages own
            WHERE own.author_user_id=m.author_user_id AND own.attachment_key=m.attachment_key)
          AND NOT EXISTS(SELECT 1 FROM decave_attachment_access a WHERE a.r2_key=m.attachment_key)`,
      binds: [me],
      transform: ({ __download_key: key, ...row }) => ({
        ...row,
        downloadUrl: `/api/account/export/attachment?key=${encodeURIComponent(String(key ?? ""))}`,
      }),
    },
    {
      // Private bot notices addressed to this account (a bot's reply only
      // they could see). Notices for other people are never exported here.
      name: "hubBotNoticesReceived",
      alias: "m",
      sql: `SELECT h.name AS hub, r.name AS room, m.text, m.created_at, m.edited_at, m.rowid AS __rowid
        FROM decave_messages m LEFT JOIN decave_rooms r ON r.id=m.room_id LEFT JOIN decave_hubs h ON h.id=m.hub_id
        WHERE m.visible_to_user_id=? AND m.author_user_id<>?`,
      binds: [me, me],
    },
    {
      // An encrypted DM has text='' and its content in `envelope` (opaque ciphertext).
      name: "directMessagesSent",
      alias: "d",
      sql: `SELECT d.id, u.username AS "to", CASE WHEN d.envelope IS NULL THEN d.text ELSE '[end-to-end encrypted]' END AS text,
        d.envelope, d.created_at, d.rowid AS __rowid
        FROM decave_direct_messages d LEFT JOIN decave_users u ON u.id=d.to_user_id WHERE d.from_user_id=?`,
      binds: [me],
    },
    {
      // DM attachment references are public object keys alongside the opaque
      // ciphertext. Export only uploads owned by this account and referenced by
      // a message it sent; a counterpart's attachments are never included.
      name: "directMessageAttachments",
      alias: "a",
      sql: `SELECT a.r2_key AS __download_key,a.created_at,a.rowid AS __rowid
        FROM decave_attachment_access a
        WHERE a.owner_user_id=? AND a.kind='dm' AND EXISTS(
          SELECT 1 FROM decave_direct_messages d WHERE d.from_user_id=?
            AND (instr(d.text,a.r2_key)>0 OR instr(COALESCE(d.attachment_refs,''),a.r2_key)>0)
        )`,
      binds: [me, me],
      transform: ({ __download_key: key, ...row }) => ({
        fileName: "attachment",
        ...row,
        downloadUrl: `/api/account/export/attachment?key=${encodeURIComponent(String(key ?? ""))}`,
      }),
    },
    {
      name: "directMessageReactions",
      alias: "r",
      sql: `SELECT r.message_id, r.emoji, r.created_at, r.rowid AS __rowid FROM decave_dm_reactions r WHERE r.user_id=?`,
      binds: [me],
    },
    {
      // This account's encrypted reactions and poll votes: opaque ciphertext.
      name: "directMessageReactionEnvelopes",
      alias: "r",
      sql: `SELECT r.message_id, r.envelope, r.updated_at, r.rowid AS __rowid
        FROM decave_dm_reaction_envelopes r WHERE r.user_id=?`,
      binds: [me],
    },
    {
      name: "groupChatMessages",
      alias: "m",
      sql: `SELECT COALESCE(NULLIF(g.name,''),'Group chat') AS "group", CASE WHEN m.envelope IS NULL THEN m.text ELSE '[end-to-end encrypted]' END AS text,
        m.envelope, m.created_at,
          m.rowid AS __rowid
        FROM decave_group_chat_messages m LEFT JOIN decave_group_chats g ON g.id=m.group_id WHERE m.from_user_id=?`,
      binds: [me],
    },
    {
      // Public keys; certificate and sealed_for_previous are opaque, signed or sealed by the account's devices.
      name: "encryptionKeys",
      alias: "k",
      sql: `SELECT k.key_id, k.x25519_public, k.ed25519_public, k.previous_key_id, k.certificate,
          k.sealed_for_previous, k.created_at, k.retired_at, k.rowid AS __rowid
        FROM decave_dm_keys k WHERE k.user_id=?`,
      binds: [me],
    },
    {
      // Encrypted under the account's recovery code; the server cannot open it.
      name: "encryptionKeyBackup",
      alias: "b",
      sql: `SELECT b.key_id, b.backup, b.updated_at, b.rowid AS __rowid FROM decave_dm_key_backups b WHERE b.user_id=?`,
      binds: [me],
    },
    {
      name: "encryptionSettings",
      alias: "s",
      sql: `SELECT s.history_days, s.updated_at, s.rowid AS __rowid FROM decave_dm_key_settings s WHERE s.user_id=?`,
      binds: [me],
    },
    {
      // Device-link requests; `sealed` is the key sealed to the new device (opaque).
      name: "encryptionLinkRequests",
      alias: "l",
      sql: `SELECT l.id, l.device_label, l.link_public, l.sealed, l.created_at, l.expires_at, l.resolved_at,
          l.rowid AS __rowid
        FROM decave_dm_link_requests l WHERE l.user_id=?`,
      binds: [me],
    },
    {
      name: "signIns",
      alias: "s",
      sql: `SELECT s.client, s.device_label, s.created_at, s.rowid AS __rowid
        FROM decave_session_clients s WHERE s.user_id=?`,
      binds: [me],
    },
    {
      name: "pushTokens",
      alias: "t",
      sql: `SELECT t.token AS __token, t.platform, t.created_at, t.rowid AS __rowid
        FROM decave_push_tokens t WHERE t.user_id=?`,
      binds: [me],
      // Show which registrations exist without handing out a usable push credential.
      transform: ({ __token, ...rest }) => ({ token: maskPushToken(__token), ...rest }),
    },
    {
      name: "securityLog",
      alias: "s",
      sql: `SELECT s.event, s.user_agent, s.created_at, s.rowid AS __rowid
        FROM decave_security_events s WHERE s.user_id=?`,
      binds: [me],
    },
    {
      name: "knownDevices",
      alias: "d",
      sql: `SELECT d.first_seen_at, d.last_seen_at, d.rowid AS __rowid FROM decave_known_devices d WHERE d.user_id=?`,
      binds: [me],
    },
    {
      name: "ageCheck",
      alias: "s",
      sql: `SELECT s.age_status, s.age_band, s.age_assurance_method, s.age_acknowledged_at, s.age_verified_at,
          s.rowid AS __rowid
        FROM decave_user_safety_profiles s WHERE s.user_id=?`,
      binds: [me],
    },
    {
      name: "steam",
      alias: "s",
      sql: `SELECT s.steam_id, s.persona_name, s.profile_url, s.linked_at AS created_at, s.updated_at, s.rowid AS __rowid
        FROM decave_steam_links s WHERE s.user_id=?`,
      binds: [me],
    },
    {
      name: "activity",
      alias: "a",
      sql: `SELECT a.automatic_text, a.source, a.started_at, a.rowid AS __rowid
        FROM decave_activity_state a WHERE a.user_id=?`,
      binds: [me],
    },
    {
      name: "squadSearch",
      alias: "s",
      sql: `SELECT s.game, s.platform, s.language, s.region, s.microphone_required, s.created_at, s.expires_at,
          s.rowid AS __rowid
        FROM decave_squad_searches s WHERE s.user_id=?`,
      binds: [me],
    },
    {
      name: "eventRsvps",
      alias: "r",
      sql: `SELECT e.title, r.status, r.updated_at, r.rowid AS __rowid FROM decave_hub_event_rsvps r
        JOIN decave_hub_events e ON e.id=r.event_id WHERE r.user_id=?`,
      binds: [me],
    },
    {
      name: "reportsFiled",
      alias: "r",
      sql: `SELECT r.category, r.target_type, r.context_type, r.description, r.status, r.created_at, r.rowid AS __rowid
        FROM decave_reports r WHERE r.reporter_user_id=?`,
      binds: [me],
    },
    {
      name: "feedback",
      alias: "f",
      sql: `SELECT f.type, f.message, f.contact_email, f.created_at, f.rowid AS __rowid
        FROM decave_feedback f WHERE f.user_id=?`,
      binds: [me],
    },
  ];
}

const FAILED = "The export could not be completed. Retry the download.";

/** The export as JSON text chunks; the completion status is always the last member. */
export async function* accountExportChunks(
  db: D1Database,
  header: Row,
  sections: ExportSection[],
): AsyncGenerator<string> {
  const head = JSON.stringify(header);
  yield head.slice(0, -1);
  let separator = head === "{}" ? "" : ",";
  for (const section of sections) {
    yield `${separator}${JSON.stringify(section.name)}:[`;
    separator = ",";
    let first = true;
    let cursor = -1;
    try {
      while (true) {
        const page = await db
          .prepare(`${section.sql} AND ${section.alias}.rowid>? ORDER BY ${section.alias}.rowid LIMIT ?`)
          .bind(...section.binds, cursor, PAGE_SIZE)
          .all<Row>();
        for (const result of page.results) {
          cursor = Number(result.__rowid);
          const { __rowid: _cursor, ...raw } = result;
          yield `${first ? "" : ","}${JSON.stringify(section.transform ? section.transform(raw) : raw)}`;
          first = false;
        }
        if (page.results.length < PAGE_SIZE) break;
      }
    } catch (error) {
      // A table the Worker creates lazily may not exist yet: nothing to export.
      if (first && error instanceof Error && /no such table/i.test(error.message)) {
        yield "]";
        continue;
      }
      console.error(
        `Account export stopped while reading ${section.name}.`,
        error instanceof Error ? error.name : "UnknownError",
      );
      yield `],"complete":false,"error":${JSON.stringify(FAILED)}}`;
      return;
    }
    yield "]";
  }
  yield `${separator}"complete":true}`;
}

export function accountExportResponse(chunks: AsyncGenerator<string>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await chunks.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await chunks.return(undefined);
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
