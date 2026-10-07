import assert from "node:assert/strict";
import test from "node:test";
import { createSessionKit, prepareSessionKitLaunch } from "../../shared/session-kit.ts";
import { createSessionKitRepository } from "../../src/session/session-kits.ts";
import {
  DEFAULT_QUIET_PRESENCE,
  effectiveQuietPresence,
  normalizeQuietPresenceSettings,
  presenceStatusForIntent,
  shouldInterruptQuietPresenceEvent,
  shouldInterruptQuietPresence,
  toLegacyPresencePatch,
} from "../../src/session/quiet-presence.ts";
import {
  buildLocalSessionRecap,
  createLocalRecapRepository,
  normalizeLocalRecapAction,
} from "../../src/session/local-recap.ts";
import {
  createDecisionCard,
  decisionCardIsClosed,
  normalizeDecisionCardMetadata,
  toExistingEventPayload,
  toExistingPollPayload,
} from "../../src/session/decision-cards.ts";
import { inspectVoiceReadiness } from "../../src/session/voice-readiness.ts";
import {
  createSquadPreset,
  createSquadPresetRepository,
  toSupportedSquadSearchRequest,
  unsupportedSquadPresetExtras,
} from "../../src/session/squad-presets.ts";

class MemoryStorage {
  values = new Map();
  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }
  setItem(key, value) {
    this.values.set(key, String(value));
  }
  removeItem(key) {
    this.values.delete(key);
  }
}

class FailingStorage extends MemoryStorage {
  setItem() {
    throw new Error("blocked");
  }
}

const at = Date.parse("2026-09-11T12:00:00.000Z");

test("Session Kit launch validates scoped references and requires explicit media actions", () => {
  const kit = createSessionKit(
    {
      name: "Ranked night",
      intent: "play",
      scope: { hubId: "hub-1", channelId: "voice-1", eventId: "event-1" },
      inviteUserIds: ["u-1", "u-2"],
      game: { name: "A game", platform: "PC" },
      voice: { inputDeviceId: "mic-1", outputDeviceId: "headphones-1", processingMode: "high-quality" },
      privacy: { presenceStatus: "online", notificationPreset: "mentions", allowUrgentMentions: true },
    },
    at,
  );
  const plan = prepareSessionKitLaunch(kit, {
    hubIds: ["hub-1"],
    channelIdsByHub: { "hub-1": ["voice-1"] },
    eventIds: ["event-1"],
    inviteUserIds: ["u-1"],
    inputDeviceIds: ["mic-1"],
    outputDeviceIds: [],
  });
  assert.equal(plan.canLaunch, true);
  assert.equal(plan.restored.channelId, "voice-1");
  assert.deepEqual(plan.restored.inviteUserIds, ["u-1"]);
  assert.equal(plan.restored.voice.outputDeviceId, null);
  assert.equal(plan.inviteActionRequired, true);
  assert.equal(
    plan.issues.some((item) => item.code === "invite-member-unavailable"),
    true,
  );
  assert.equal(
    plan.issues.some((item) => item.code === "output-device-unavailable"),
    true,
  );
  assert.deepEqual(plan.mediaActionRequired, ["microphone", "camera"]);
  assert.equal(
    plan.summary.some((line) => line.includes("unchanged until you choose")),
    true,
  );

  const unavailable = prepareSessionKitLaunch(kit, { hubIds: [], channelIdsByHub: {} });
  assert.equal(unavailable.canLaunch, false);
  assert.equal(unavailable.restored.hubId, null);
  assert.equal(unavailable.restored.channelId, null);
});

test("Session Kit storage is account scoped and ignores malformed persisted records", () => {
  const storage = new MemoryStorage();
  const first = createSessionKitRepository("account-a", { storage, now: () => at });
  const second = createSessionKitRepository("account-b", { storage, now: () => at });
  const kit = createSessionKit(
    {
      name: "Watch",
      intent: "watch",
      scope: { hubId: "hub-1", channelId: null, eventId: null },
      inviteUserIds: [],
      game: { name: "", platform: null },
      voice: { inputDeviceId: null, outputDeviceId: null, processingMode: "standard" },
      privacy: { presenceStatus: "online", notificationPreset: "all", allowUrgentMentions: true },
    },
    at,
  );
  assert.equal(first.upsert(kit).ok, true);
  assert.equal(first.load().length, 1);
  assert.equal(second.load().length, 0);
  storage.setItem(first.key, JSON.stringify({ kits: [{ id: "bad", scope: {} }, kit, kit] }));
  assert.equal(first.load().length, 1);
});

test("account storage keys do not collide when account identifiers share a long prefix", () => {
  const storage = new MemoryStorage();
  const prefix = "a".repeat(220);
  const first = createSessionKitRepository(`${prefix}-one`, { storage, now: () => at });
  const second = createSessionKitRepository(`${prefix}-two`, { storage, now: () => at });
  const kit = createSessionKit(
    {
      name: "Isolated",
      intent: "chat",
      scope: { hubId: "hub-1", channelId: null, eventId: null },
      inviteUserIds: [],
      game: { name: "", platform: null },
      voice: { inputDeviceId: null, outputDeviceId: null, processingMode: "standard" },
      privacy: { presenceStatus: "online", notificationPreset: "all", allowUrgentMentions: true },
    },
    at,
  );
  first.upsert(kit);
  assert.equal(second.load().length, 0);
  assert.notEqual(first.key, second.key);
});

test("local repositories fail closed when browser storage is unavailable", () => {
  const storage = new FailingStorage();
  const repository = createSessionKitRepository("account-a", { storage, now: () => at });
  const kit = createSessionKit(
    {
      name: "Local only",
      intent: "chat",
      scope: { hubId: "hub-1", channelId: null, eventId: null },
      inviteUserIds: [],
      game: { name: "", platform: null },
      voice: { inputDeviceId: null, outputDeviceId: null, processingMode: "standard" },
      privacy: { presenceStatus: "online", notificationPreset: "all", allowUrgentMentions: true },
    },
    at,
  );
  assert.equal(repository.upsert(kit).ok, false);
  assert.match(repository.lastError(), /storage|saved/i);
});

test("quiet presence maps to existing status semantics and expires safely", () => {
  assert.equal(presenceStatusForIntent("quiet"), "dnd");
  const settings = normalizeQuietPresenceSettings(
    { intent: "quiet", expiresAt: new Date(at + 60_000).toISOString() },
    at,
  );
  assert.deepEqual(toLegacyPresencePatch(settings, at), { status: "dnd", notificationPreset: "quiet" });
  assert.equal(shouldInterruptQuietPresence(settings, "urgent-mention", at), true);
  assert.equal(shouldInterruptQuietPresence(settings, "ordinary-join", at), false);
  const expired = effectiveQuietPresence(settings, at + 61_000);
  assert.equal(expired.intent, DEFAULT_QUIET_PRESENCE.intent);
  assert.equal(expired.presenceStatus, "online");
  assert.equal(expired.notificationPreset, "all");
  assert.equal(shouldInterruptQuietPresenceEvent(settings, "mention", { urgent: false, now: at }), false);
  assert.equal(shouldInterruptQuietPresenceEvent(settings, "mention", { urgent: true, now: at }), true);
  assert.equal(shouldInterruptQuietPresenceEvent(settings, "join", { now: at }), false);
});

test("local recap accepts explicit actions only and omits private/audio content", () => {
  const start = normalizeLocalRecapAction(
    { kind: "session-started", sessionId: "s-1", hubId: "h-1", hubName: "Hub", audio: "secret" },
    at,
  );
  const channel = normalizeLocalRecapAction(
    {
      kind: "channel-visited",
      sessionId: "s-1",
      hubId: "h-1",
      channelId: "c-1",
      channelName: "Lounge",
      messageText: "private",
    },
    at + 1,
  );
  const link = normalizeLocalRecapAction(
    { kind: "shared-link", sessionId: "s-1", url: "https://example.test/watch", label: "Watch", transcript: "secret" },
    at + 2,
  );
  const invalid = normalizeLocalRecapAction({ kind: "message-received", sessionId: "s-1", text: "private" }, at);
  const invalidEvent = normalizeLocalRecapAction(
    { kind: "event-scheduled", sessionId: "s-1", eventId: "e-1", title: "Broken", startAt: "not-a-date" },
    at,
  );
  const invalidFollowUp = normalizeLocalRecapAction(
    { kind: "follow-up-scheduled", sessionId: "s-1", followUpId: "f-1", title: "Broken", dueAt: "not-a-date" },
    at,
  );
  assert.ok(start && channel && link);
  assert.equal(invalid, null);
  assert.equal(invalidEvent, null);
  assert.equal(invalidFollowUp, null);
  const recap = buildLocalSessionRecap("s-1", [start, channel, link], at);
  assert.equal(recap.participants.length, 0);
  assert.equal(recap.channels.length, 1);
  assert.equal(recap.sharedLinks.length, 1);
  assert.equal(JSON.stringify(recap).includes("secret"), false);
  assert.equal(JSON.stringify(recap).includes("private"), false);
  const storage = new MemoryStorage();
  const repository = createLocalRecapRepository("account-a", { storage, now: () => at });
  assert.equal(
    repository.append({ kind: "shared-link", sessionId: "s-1", url: "http://insecure.test", label: "No" }).ok,
    false,
  );
});

test("decision cards produce typed existing poll payloads and close at their deadline", () => {
  const card = createDecisionCard({
    kind: "choose-game",
    question: "What should we play?",
    options: ["A", "B"],
    deadlineAt: new Date(at + 10_000).toISOString(),
    sourceMessageId: "message-1",
    eventId: null,
  });
  assert.ok(card);
  assert.deepEqual(toExistingPollPayload(card), { question: "What should we play?", options: ["A", "B"] });
  assert.equal(decisionCardIsClosed(card, at), false);
  assert.equal(decisionCardIsClosed(card, at + 11_000), true);
  assert.equal(Object.hasOwn(toExistingPollPayload(card), "text"), false);
});

test("decision card metadata preserves deadlines and event links without implicit invites", () => {
  const deadline = new Date(at + 10_000).toISOString();
  const metadata = normalizeDecisionCardMetadata({
    cardId: "card-1",
    kind: "choose-game",
    deadlineAt: deadline,
    eventId: "event-1",
  });
  assert.deepEqual(metadata, { cardId: "card-1", kind: "choose-game", deadlineAt: deadline, eventId: "event-1" });
  const payload = toExistingEventPayload({ question: "Choose", deadlineAt: deadline });
  assert.equal(payload?.startAt, deadline);
  assert.equal(payload?.inviteMode, "selected");
  assert.deepEqual(payload?.invitedUserIds, []);
});

test("voice readiness reports actual device and output capability without capturing", async () => {
  const readiness = await inspectVoiceReadiness({
    mediaDevices: {
      enumerateDevices: async () => [
        { kind: "audioinput", deviceId: "mic-1", label: "Mic", groupId: "" },
        { kind: "audiooutput", deviceId: "out-1", label: "Headphones", groupId: "" },
      ],
    },
    microphonePermission: "granted",
    outputSelectionSupported: true,
    audioContextSupported: true,
    expectedLatencyMs: 17,
    availableProcessingModes: ["high-quality", "low-cpu"],
    selectedProcessingMode: "low-cpu",
    now: at,
  });
  assert.equal(readiness.inputSupported, true);
  assert.equal(readiness.outputSupported, true);
  assert.equal(readiness.selectedInput?.id, "mic-1");
  assert.equal(readiness.selectedOutput?.id, "out-1");
  assert.equal(readiness.expectedLatencyMs, 17);
  assert.equal(readiness.processingMode, "low-cpu");
  assert.equal(readiness.noiseEnvironment, "not-measured");
});

test("Squad presets send only the existing supported filters and disclose saved-only extras", () => {
  const preset = createSquadPreset(
    {
      name: "Evening ranked",
      filters: { game: "Game", platform: "PC", language: "English", region: "EU", microphoneRequired: true },
      extras: { playStyle: "competitive", timeWindow: "evenings", partySize: { min: 3, max: 4 } },
    },
    at,
  );
  const request = toSupportedSquadSearchRequest(preset.filters);
  assert.deepEqual(request, preset.filters);
  assert.deepEqual(Object.keys(request).sort(), ["game", "language", "microphoneRequired", "platform", "region"]);
  assert.equal(unsupportedSquadPresetExtras(preset).length, 3);
  const storage = new MemoryStorage();
  const repository = createSquadPresetRepository("account-a", { storage, now: () => at });
  assert.equal(repository.upsert(preset).ok, true);
  assert.equal(repository.load()[0].extras.playStyle, "competitive");
});
