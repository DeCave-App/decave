import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createVoiceNoteSender, voiceAttachmentMeta, micButtonVisible } from "../../src/features/voice-notes/send.ts";
import {
  createWebPlayedQueue,
  loadPendingPlayed,
  savePendingPlayed,
} from "../../src/features/voice-notes/played-receipts.ts";
import { attachmentKeysIn, createDmE2eeSending } from "../../shared/dm-e2ee-sending.ts";
import { decryptAttachment } from "../../shared/dm-e2ee.ts";
import { encodeWave, VOICE_NOTE_PAD_STEP } from "../../shared/voice-note.ts";

const DM_PREFIX = "__DECAVE_DM_ATTACHMENT__";
const wave = encodeWave([0.1, 0.5, 0.9]);
const audio = new Uint8Array(200_000).map((_, i) => i % 251);
const draft = () => ({
  blob: new Blob([audio], { type: "audio/webm" }),
  mime: "audio/webm;codecs=opus",
  meta: { ms: 3000, wave },
});

function harness() {
  const calls = { uploads: [], dmTexts: [], room: [] };
  const sender = createVoiceNoteSender({
    baseUrl: "http://x",
    fetch: async (url, init) => {
      const body = new Uint8Array(await new Response(init.body).arrayBuffer());
      calls.uploads.push({ url, headers: init.headers, body });
      const id = "11111111-2222-3333-4444-555555555555";
      return new Response(
        JSON.stringify({
          attachment: {
            id,
            name: "encrypted",
            mimeType: "application/octet-stream",
            size: body.length,
            url: `/uploads/attachments/private/${id}`,
          },
        }),
        { status: 200 },
      );
    },
    sendDmText: async (peerId, text) => {
      calls.dmTexts.push({ peerId, text });
    },
    sendRoomAttachment: async (channelId, attachment) => {
      calls.room.push({ channelId, attachment });
    },
  });
  return { sender, calls };
}

test("encrypted DM: padded ciphertext upload, voice.bytes = real size, upload id kept", async () => {
  const { sender, calls } = harness();
  const d = draft();
  await sender.sendVoiceNote({ kind: "dm", id: "peer1", encrypted: true }, d);
  assert.equal(calls.uploads.length, 1);
  const up = calls.uploads[0];
  assert.match(up.url, /\/api\/dms\/peer1\/attachments$/);
  assert.equal(up.headers["X-File-Type"], "application/octet-stream");
  const text = calls.dmTexts[0].text;
  assert.ok(text.startsWith(DM_PREFIX));
  const att = JSON.parse(text.slice(DM_PREFIX.length));
  assert.equal(att.voice.bytes, d.blob.size);
  assert.equal(att.voice.ms, 3000);
  assert.equal(att.name, "Voice message.webm");
  const plain = decryptAttachment(up.body, att.fileKey);
  assert.equal(plain.length % VOICE_NOTE_PAD_STEP, 0);
  assert.deepEqual(plain.slice(0, audio.length), audio);
  assert.deepEqual(attachmentKeysIn(text), ["attachments/private/11111111-2222-3333-4444-555555555555"]);
});

test("room: X-Voice-Note header, unpadded body, no voice.bytes", async () => {
  const { sender, calls } = harness();
  await sender.sendVoiceNote({ kind: "room", id: "42", encrypted: false }, draft());
  const up = calls.uploads[0];
  assert.match(up.url, /\/api\/channels\/42\/attachments$/);
  assert.equal(up.headers["X-Voice-Note"], "1");
  assert.equal(up.body.length, audio.length);
  assert.deepEqual(up.body, audio);
  const { channelId, attachment } = calls.room[0];
  assert.equal(channelId, "42");
  assert.equal(attachment.voice.bytes, undefined);
  assert.equal(attachment.voice.ms, 3000);
});

test("plaintext DM: unpadded upload, no fileKey or bytes", async () => {
  const { sender, calls } = harness();
  await sender.sendVoiceNote({ kind: "dm", id: "peer1", encrypted: false }, draft());
  assert.equal(calls.uploads[0].body.length, audio.length);
  const att = JSON.parse(calls.dmTexts[0].text.slice(DM_PREFIX.length));
  assert.equal(att.fileKey, undefined);
  assert.equal(att.voice.bytes, undefined);
});

test("failed upload rejects and sends nothing", async () => {
  const sender = createVoiceNoteSender({
    baseUrl: "http://x",
    fetch: async () => new Response(JSON.stringify({ error: "nope" }), { status: 413 }),
    sendDmText: async () => assert.fail("should not send"),
    sendRoomAttachment: async () => assert.fail("should not send"),
  });
  await assert.rejects(sender.sendVoiceNote({ kind: "room", id: "1", encrypted: false }, draft()));
});

test("voiceAttachmentMeta: valid voice only", () => {
  assert.deepEqual(voiceAttachmentMeta({ voice: { ms: 1000, wave } }), { ms: 1000, wave });
  assert.equal(voiceAttachmentMeta({ voice: { ms: 0, wave } }), null);
  assert.equal(voiceAttachmentMeta({ voice: { ms: 1000, wave: "x" } }), null);
  assert.equal(voiceAttachmentMeta({}), null);
  assert.equal(voiceAttachmentMeta(null), null);
});

test("renderers use the voice bubble when voice is valid, else the normal attachment", () => {
  const dm = fs.readFileSync("src/app/actions/message-rendering.tsx", "utf8");
  const hub = fs.readFileSync("src/app/views/HubMessageList.tsx", "utf8");
  for (const src of [dm, hub]) {
    assert.match(src, /voiceAttachmentMeta\(/);
  }
  assert.match(dm, /<DmVoiceNote/);
  assert.match(hub, /<HubVoiceNote/);
  // Hub normal attachment cards are skipped only for a valid voice note.
  assert.match(hub, /!voiceMeta &&/);
});

test("mic button only when the composer text is empty, in the DM and Hub composers", () => {
  assert.equal(micButtonVisible(""), true);
  assert.equal(micButtonVisible("   "), true);
  assert.equal(micButtonVisible("hi"), false);
  assert.equal(micButtonVisible("", true), false);
  assert.match(fs.readFileSync("src/app/views/HubComposer.tsx", "utf8"), /<VoiceComposer\b/);
  assert.match(fs.readFileSync("src/app/views/SocialPage.tsx", "utf8"), /<VoiceComposer\b/);
});

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test("a failed web Played mark stays pending in storage and is sent again on retry (real sending glue)", async () => {
  const storage = memoryStorage();
  const seals = [];
  const session = {
    ownReactions: (id) => (id === "m1" ? ["👍"] : undefined),
    hasPlayed: () => false,
    sealReactions: async (peerId, messageId, emojis, options) => {
      seals.push({ peerId, messageId, emojis: [...emojis], played: options?.played });
      return { id: messageId };
    },
  };
  const { sendPlayed } = createDmE2eeSending(session);
  const calls = [];
  let status = 500;
  const local = [];
  const queue = createWebPlayedQueue({
    sendPlayed,
    request: async (path, init) => (calls.push({ path, ...init }), { ok: status === 200, data: {} }),
    markLocal: (account, id) => local.push(`${account}:${id}`),
    loadPending: (account) => loadPendingPlayed(account, storage),
    savePending: (account, list) => savePendingPlayed(account, list, storage),
  });
  queue.report("me", { id: "m1", fromUserId: "peer", envelope: {} });
  queue.report("me", { id: "m1", fromUserId: "peer" }); // in flight: not sent twice
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(local, ["me:m1", "me:m1"], "the dot clears right away");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/dms/messages/m1/reactions");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(seals[0], { peerId: "peer", messageId: "m1", emojis: ["👍"], played: true });
  assert.deepEqual(loadPendingPlayed("me", storage), [{ id: "m1", fromUserId: "peer" }], "pending after the failure");
  assert.deepEqual(loadPendingPlayed("other", storage), [], "kept per account");

  status = 200;
  queue.retry("me");
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls.length, 2);
  assert.deepEqual(loadPendingPlayed("me", storage), [], "accepted: no longer pending");
  assert.equal(storage.map.size, 0);
  queue.retry("me");
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls.length, 2, "nothing left to resend");
  queue.report("me", { id: "m2", fromUserId: "me" });
  assert.equal(calls.length, 2, "own notes are never marked");
});

test("pending Played storage survives broken storage", () => {
  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  assert.deepEqual(loadPendingPlayed("me", broken), []);
  assert.doesNotThrow(() => savePendingPlayed("me", [{ id: "m1", fromUserId: "p" }], broken));
  assert.deepEqual(loadPendingPlayed("me", { getItem: () => "not json" }), []);
});

test("web DM glue retries pending Played marks on mount, DM open and reconnect", () => {
  const note = fs.readFileSync("src/features/voice-notes/DmVoiceNote.tsx", "utf8");
  assert.match(note, /dmPlayedQueue\.retry\(selfId\)/);
  assert.match(note, /dmPlayedQueue\.report\(selfId, message\)/);
  assert.match(
    fs.readFileSync("src/app/views/SocialPage.tsx", "utf8"),
    /usePendingPlayedRetry\(currentUser\.id, connectionStatus === "Connected", activeDmUser\?\.id\)/,
  );
});
