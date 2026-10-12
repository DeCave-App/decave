// Sharer side of the screen-share SFU path: which transport a share uses,
// which peers still get a mesh video sender, the per-share stream key and its
// rotation, and the publish / fallback lifecycle. No WebRTC here: publishing
// and sealing are injected so this stays testable in node.
import { SCREEN_SHARE_PROFILES, screenBitratePerViewer } from "../../app/voice.ts";
import type { ScreenQuality } from "../../app/types.ts";
import type { SfuSignaller } from "./sfu-session.ts";

export const SFU_PUBLISH_TIMEOUT_MS = 10_000;

export type MeshPeer = { connectionId: string; sfuScreenCapable?: boolean };
export type KeyParticipant = { connectionId: string; userId: string; sfuScreenCapable?: boolean; channelId?: number };
export type SealedScreenKey = { envelopes: { envelope: unknown; sealedFor: string[] }[] };

/** Mesh video goes to a peer unless the SFU carries the share for them. */
export function shouldSendMeshScreen(
  peer: MeshPeer,
  state: { sfuActive: boolean; meshRequested: ReadonlySet<string> },
): boolean {
  if (!state.sfuActive) return true;
  if (peer.sfuScreenCapable !== true) return true;
  return state.meshRequested.has(peer.connectionId);
}

export function chooseShareTransport(env: {
  sfuOffered: boolean;
  e2eeReady: boolean;
  capableRuntime: boolean;
}): "sfu" | "mesh" {
  return env.sfuOffered && env.e2eeReady && env.capableRuntime ? "sfu" : "mesh";
}

/** The "f" simulcast layer for a quality preset ("p" is fixed by the publisher). */
export function fullEncodingFor(quality: ScreenQuality, viewers: number) {
  const profile = SCREEN_SHARE_PROFILES[quality];
  return {
    maxBitrate: screenBitratePerViewer(profile.maxBitrate, viewers),
    maxFramerate: profile.fps,
    scaleResolutionDownBy: 1,
  };
}

export type ScreenKeyManager = {
  start(): Promise<void>;
  participantsChanged(list: KeyParticipant[], left: string[]): Promise<void>;
  resend(toConnectionId: string): Promise<void>;
  currentIndex(): number;
};

/**
 * Stream key for one share. Index 0 at start, +1 (mod 256) with a fresh key on
 * every participant leave; joins get the current key. Keys go only to
 * SFU-capable connections, each receiving the envelope that wraps its user
 * (the sharer's other devices open the sharer's own wrap).
 */
export function createScreenKeyManager(deps: {
  sealKey(binding: string, key: Uint8Array, userIds: string[]): Promise<SealedScreenKey>;
  send(p: unknown): boolean;
  channelId: number;
  selfConnectionId: string;
  selfUserId?: string;
  onKey(index: number, key: Uint8Array): void;
}): ScreenKeyManager {
  let started = false;
  let index = 0;
  let key = new Uint8Array(0);
  let participants: KeyParticipant[] = [];
  // Connections that hold the current key, and the envelope per user for it.
  let delivered = new Set<string>();
  let envelopeByUser = new Map<string, unknown>();
  let ownEnvelope: unknown = null;
  let chain: Promise<void> = Promise.resolve();

  const enqueue = (op: () => Promise<void>) => {
    const next = chain.then(op);
    chain = next.catch(() => undefined);
    return next;
  };

  const targets = () =>
    participants.filter((p) => p.connectionId !== deps.selfConnectionId && p.sfuScreenCapable === true);

  const envelopeFor = (p: KeyParticipant) =>
    envelopeByUser.get(p.userId) ??
    (deps.selfUserId !== undefined && p.userId === deps.selfUserId ? ownEnvelope : undefined);

  const deliver = async (to: KeyParticipant[]) => {
    const needSeal = [
      ...new Set(to.filter((p) => envelopeFor(p) === undefined && p.userId !== deps.selfUserId).map((p) => p.userId)),
    ];
    if (needSeal.length > 0 || ownEnvelope === null) {
      const sealIndex = index;
      const sealed = await deps.sealKey(
        `screen:${deps.channelId}:${deps.selfConnectionId}:${sealIndex}`,
        key,
        needSeal,
      );
      if (sealIndex !== index) return;
      for (const { envelope, sealedFor } of sealed.envelopes) {
        for (const userId of sealedFor) envelopeByUser.set(userId, envelope);
      }
      if (ownEnvelope === null) ownEnvelope = sealed.envelopes[0]?.envelope ?? null;
    }
    for (const p of to) {
      const envelope = envelopeFor(p);
      if (envelope === undefined || envelope === null) continue; // keyless account
      deps.send({ type: "RTC_SCREEN_KEY", targetConnectionId: p.connectionId, keyIndex: index, envelope });
      delivered.add(p.connectionId);
    }
  };

  const newKey = (nextIndex: number) => {
    index = nextIndex & 0xff;
    key = crypto.getRandomValues(new Uint8Array(16));
    delivered = new Set();
    envelopeByUser = new Map();
    ownEnvelope = null;
    deps.onKey(index, key);
  };

  return {
    start: () =>
      enqueue(async () => {
        started = true;
        newKey(0);
        await deliver(targets());
      }),
    participantsChanged: (list, left) =>
      enqueue(async () => {
        participants = list;
        if (!started) return;
        if (left.length > 0) newKey(index + 1);
        const fresh = targets().filter((p) => !delivered.has(p.connectionId));
        if (fresh.length > 0) await deliver(fresh);
      }),
    resend: (toConnectionId) =>
      enqueue(async () => {
        if (!started) return;
        const target = targets().find((p) => p.connectionId === toConnectionId);
        if (target) await deliver([target]);
      }),
    currentIndex: () => index,
  };
}

export type ScreenSfuPublisher = {
  setKey(index: number, key: Uint8Array): void;
  updateFull(enc: RTCRtpEncodingParameters): Promise<void>;
  stop(): Promise<void>;
};

export type ScreenSfuSharerDeps = {
  sendSocket(p: unknown): boolean;
  signaller: SfuSignaller;
  publish(track: MediaStreamTrack, fullEncoding: RTCRtpEncodingParameters): Promise<ScreenSfuPublisher>;
  canSeal(): boolean;
  sealKey(binding: string, key: Uint8Array, userIds: string[]): Promise<SealedScreenKey>;
  capableRuntime(): boolean;
  channelId(): number | null;
  selfConnectionId(): string;
  selfUserId(): string;
  participants(): KeyParticipant[];
  quality(): ScreenQuality;
  /** Re-run the mesh sender policy for every peer (adds missing senders). */
  refreshMeshSenders(): void;
  log(message: string, error?: unknown): void;
};

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "timeout" })), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** One per voice engine: the sharer's SFU state for the current voice session. */
export function createScreenSfuSharer(deps: ScreenSfuSharerDeps) {
  // Set per voice session from VOICE_JOINED.screenSfu (absent = off); also
  // cleared if the server answers "sfu-disabled".
  let sfuOffered = false;
  let sfuActive = false;
  let meshRequested = new Set<string>();
  let generation = 0;
  let publisher: ScreenSfuPublisher | null = null;
  let keys: ScreenKeyManager | null = null;
  let known: KeyParticipant[] = [];
  let advertised: boolean | null = null;

  const capable = () => sfuOffered && deps.canSeal() && deps.capableRuntime();
  const roomParticipants = (list: KeyParticipant[]) => {
    const channelId = deps.channelId();
    // VOICE_STATE lists every room in the hub: only our room may get keys.
    return channelId === null ? [] : list.filter((p) => p.channelId === channelId);
  };

  const advertise = () => {
    const value = capable();
    if (value === advertised) return;
    advertised = value;
    deps.sendSocket({ type: "VOICE_SFU_CAPABLE", capable: value });
  };

  const markSfuDisabled = () => {
    if (!sfuOffered) return;
    sfuOffered = false;
    advertise();
  };

  const fallBackToMesh = (gen: number, error: unknown) => {
    if (gen !== generation) return;
    const code = errorCode(error);
    if (code === "sfu-disabled") markSfuDisabled();
    else deps.log("Screen share could not use the SFU; using direct connections.", error);
    sfuActive = false;
    keys = null;
    const failed = publisher;
    publisher = null;
    if (failed) void failed.stop().catch(() => undefined);
    else void deps.signaller.request("RTC_SFU_STOP", {}).catch(() => undefined);
    deps.refreshMeshSenders();
  };

  const participantsChanged = (list: KeyParticipant[]) => {
    const next = roomParticipants(list);
    const present = new Set(next.map((p) => p.connectionId));
    const left = known.filter((p) => !present.has(p.connectionId)).map((p) => p.connectionId);
    known = next;
    for (const id of left) meshRequested.delete(id);
    if (keys) {
      const gen = generation;
      // A share whose current key cannot reach viewers leaves them black: use mesh.
      void keys.participantsChanged(next, left).catch((error) => fallBackToMesh(gen, error));
    }
  };

  const endShare = () => {
    generation += 1;
    const wasActive = sfuActive;
    sfuActive = false;
    keys = null;
    meshRequested = new Set();
    const current = publisher;
    publisher = null;
    // publisher.stop() sends RTC_SFU_STOP itself.
    if (current) void current.stop().catch(() => undefined);
    else if (wasActive) void deps.signaller.request("RTC_SFU_STOP", {}).catch(() => undefined);
  };

  return {
    offered: () => sfuOffered,
    isActive: () => sfuActive,
    meshFor: (peer: MeshPeer) => shouldSendMeshScreen(peer, { sfuActive, meshRequested }),
    markSfuDisabled,
    /** We told the room we can view SFU shares (so sharers do not send us mesh video). */
    advertisedCapable: () => advertised === true,

    /**
     * New voice session: the server says whether the SFU is offered (its kill
     * switch); advertise what this client can do.
     */
    onVoiceJoined(offered = false) {
      sfuOffered = offered;
      meshRequested = new Set();
      known = roomParticipants(deps.participants());
      advertised = null;
      advertise();
    },

    /** E2EE or runtime state may have changed mid-call: re-advertise if so. */
    refreshCapability() {
      if (deps.channelId() !== null && advertised !== null) advertise();
    },

    /**
     * Share started. Decides the transport synchronously (so mesh senders added
     * right after follow it), then publishes; any failure means mesh for all.
     */
    async begin(track: MediaStreamTrack) {
      const gen = ++generation;
      meshRequested = new Set();
      const transport = chooseShareTransport({
        sfuOffered,
        e2eeReady: deps.canSeal(),
        capableRuntime: deps.capableRuntime(),
      });
      sfuActive = transport === "sfu";
      if (!sfuActive) return;
      const channelId = deps.channelId();
      if (channelId === null) {
        sfuActive = false;
        return;
      }
      const pending = deps.publish(track, fullEncodingFor(deps.quality(), 1));
      try {
        const published = await withTimeout(pending, SFU_PUBLISH_TIMEOUT_MS);
        if (gen !== generation) {
          void published.stop().catch(() => undefined);
          return;
        }
        publisher = published;
        const manager = createScreenKeyManager({
          sealKey: deps.sealKey,
          send: deps.sendSocket,
          channelId,
          selfConnectionId: deps.selfConnectionId(),
          selfUserId: deps.selfUserId(),
          onKey: (index, key) => published.setKey(index, key),
        });
        keys = manager;
        known = roomParticipants(deps.participants());
        await manager.participantsChanged(known, []);
        await manager.start();
      } catch (error) {
        fallBackToMesh(gen, error);
        // A publish that answers after the timeout must not stay up uploading.
        void pending.then(
          (late) => {
            if (late !== publisher) void late.stop().catch(() => undefined);
          },
          () => undefined,
        );
      }
    },

    /** Share stopped (or voice left). */
    end: endShare,

    /** Voice session torn down locally (leave, kick, socket closed). */
    reset() {
      endShare();
      deps.signaller.rejectAll("not-connected");
      known = [];
      advertised = null;
    },

    async updateQuality() {
      if (publisher) await publisher.updateFull(fullEncodingFor(deps.quality(), 1));
    },

    /** Observes realtime frames; returns true only for frames it owns. */
    handleFrame(data: { type?: unknown; [key: string]: unknown }): boolean {
      if (data.type === "RTC_SFU_RESULT") {
        deps.signaller.handleResult(data);
        return true;
      }
      if (data.type === "RTC_SCREEN_KEY_REQUEST") {
        if (keys && typeof data.fromConnectionId === "string") {
          void keys.resend(data.fromConnectionId).catch((error) => deps.log("Screen key resend failed:", error));
        }
        return true;
      }
      if (data.type === "RTC_SCREEN_MESH_REQUEST") {
        if (sfuActive && typeof data.fromConnectionId === "string" && !meshRequested.has(data.fromConnectionId)) {
          meshRequested.add(data.fromConnectionId);
          deps.refreshMeshSenders();
        }
        return true;
      }
      if (data.type === "VOICE_STATE" && Array.isArray(data.participants)) {
        participantsChanged(data.participants as KeyParticipant[]);
      } else if (data.type === "VOICE_PEER_LEFT" && typeof data.connectionId === "string") {
        participantsChanged(known.filter((p) => p.connectionId !== data.connectionId));
      }
      return false;
    },
  };
}

export type ScreenSfuSharer = ReturnType<typeof createScreenSfuSharer>;
