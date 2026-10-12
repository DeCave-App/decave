// Viewer side of the screen-share SFU path: which sharers to pull, which
// simulcast layer ("p" preview, "f" when watching), stream keys, and the
// fallback to mesh. No WebRTC here: the SfuViewer is injected so this stays
// testable in node.
import type { SfuViewer } from "./sfu-session.ts";

/** Without a decrypt-ok for this long, ask the sharer for mesh and drop the pull. */
export const SFU_DECRYPT_GRACE_MS = 5_000;

type Rid = "f" | "p";

export type ViewerParticipant = {
  connectionId: string;
  channelId?: number;
  screenSharing?: boolean;
  screenSfu?: { sessionId: string; trackName: string } | null;
};

export type ScreenKeyFrame = {
  fromConnectionId?: unknown;
  fromUserId?: unknown;
  keyIndex?: unknown;
  envelope?: unknown;
};

type ControlledViewer = SfuViewer;

export type ViewerControllerDeps = {
  createViewer(): ControlledViewer;
  openKey(envelope: unknown, fromUserId: string, binding: string): Promise<Uint8Array | null>;
  send(p: unknown): boolean;
  setRemoteScreen(connectionId: string, stream: MediaStream | null): void;
  now(): number;
  channelId(): number | null;
  selfConnectionId(): string;
  /** True only when we advertised VOICE_SFU_CAPABLE (otherwise sharers send us mesh). */
  capable(): boolean;
  onSfuDisabled?(): void;
  log?(message: string, error?: unknown): void;
};

type Entry = {
  shareId: string;
  gen: number;
  state: "pulling" | "live" | "mesh";
  rid: Rid;
  pulledAt: number;
  stream: MediaStream | null;
  shown: boolean;
  everOk: boolean;
  failSince: number | null;
  keyRequested: boolean;
  retried: boolean;
};

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  return error instanceof Error ? error.message : String(error);
}

export function createViewerController(deps: ViewerControllerDeps) {
  const entries = new Map<string, Entry>();
  const watching = new Map<string, boolean>();
  // Opened keys per sharer, replayed into a recreated viewer.
  const keys = new Map<string, Map<number, Uint8Array>>();
  let viewer: ControlledViewer | null = null;
  let reconnectUsed = false;
  let lastList: ViewerParticipant[] = [];

  const log = (message: string, error?: unknown) => deps.log?.(message, error);
  const wantRid = (id: string): Rid => (watching.get(id) === true ? "f" : "p");

  const ensureViewer = (): ControlledViewer => {
    if (viewer) return viewer;
    const created = deps.createViewer();
    viewer = created;
    created.onDecryptHealth((id, ok) => {
      if (viewer === created) decryptHealth(id, ok);
    });
    created.onFailed(() => {
      if (viewer === created) viewerFailed();
    });
    return created;
  };

  const show = (id: string, entry: Entry) => {
    if (entry.shown || !entry.stream) return;
    entry.shown = true;
    deps.setRemoteScreen(id, entry.stream);
  };

  const hide = (id: string, entry: Entry) => {
    if (!entry.shown) return;
    entry.shown = false;
    deps.setRemoteScreen(id, null);
  };

  const meshFallback = (id: string, entry: Entry) => {
    entry.state = "mesh";
    entry.gen += 1;
    deps.send({ type: "RTC_SCREEN_MESH_REQUEST", targetConnectionId: id });
    viewer?.drop(id);
    hide(id, entry);
  };

  const startPull = (id: string, entry: Entry) => {
    const gen = ++entry.gen;
    entry.state = "pulling";
    entry.stream = null;
    hide(id, entry);
    entry.everOk = false;
    entry.failSince = null;
    entry.keyRequested = false;
    entry.rid = wantRid(id);
    let v: ControlledViewer;
    try {
      v = ensureViewer();
    } catch (error) {
      log("Could not open the SFU viewer; asking for a direct stream.", error);
      meshFallback(id, entry);
      return;
    }
    for (const [i, k] of keys.get(id) ?? []) v.setKey(id, i, k);
    v.pull(id, entry.rid).then(
      (stream) => {
        if (entry.gen !== gen || entries.get(id) !== entry) return;
        entry.state = "live";
        entry.pulledAt = deps.now();
        entry.stream = stream;
        // The tile appears on the first decrypt-ok, so a working mesh tile is
        // never replaced by a pull that cannot decrypt yet.
        if (entry.everOk) show(id, entry);
        const want = wantRid(id);
        if (want !== entry.rid) {
          entry.rid = want;
          v.setLayer(id, want).catch((error) => log("Could not switch screen layer:", error));
        }
      },
      (error) => {
        if (entry.gen !== gen || entries.get(id) !== entry) return;
        if (errorCode(error) === "sfu-disabled") {
          deps.onSfuDisabled?.();
          meshFallback(id, entry);
        } else if (!entry.retried) {
          entry.retried = true;
          startPull(id, entry);
        } else {
          log("Could not pull the screen share from the SFU; asking for a direct stream.", error);
          meshFallback(id, entry);
        }
      },
    );
  };

  const remove = (id: string) => {
    const entry = entries.get(id);
    if (!entry) return;
    entries.delete(id);
    keys.delete(id);
    entry.gen += 1;
    if (entry.state !== "mesh") {
      viewer?.drop(id);
      hide(id, entry);
    }
  };

  const viewerFailed = () => {
    const failed = viewer;
    viewer = null;
    failed?.close();
    const active = [...entries].filter(([, e]) => e.state !== "mesh");
    if (!reconnectUsed) {
      reconnectUsed = true;
      for (const [id, entry] of active) startPull(id, entry);
    } else {
      for (const [id, entry] of active) meshFallback(id, entry);
    }
  };

  function decryptHealth(id: string, ok: boolean) {
    const entry = entries.get(id);
    if (!entry || entry.state === "mesh") return;
    if (ok) {
      entry.everOk = true;
      entry.failSince = null;
      entry.keyRequested = false;
      // The (reconnected) viewer works again: a later PC failure may reconnect once more.
      reconnectUsed = false;
      show(id, entry);
      return;
    }
    if (entry.failSince === null) entry.failSince = deps.now();
    if (!entry.keyRequested) {
      entry.keyRequested = true;
      deps.send({ type: "RTC_SCREEN_KEY_REQUEST", targetConnectionId: id });
    }
  }

  const participantsChanged = (list: ViewerParticipant[]) => {
    lastList = list;
    const channelId = deps.channelId();
    const self = deps.selfConnectionId();
    const sharers = new Map<string, string>();
    if (channelId !== null && deps.capable()) {
      for (const p of list) {
        if (p.channelId !== channelId || p.connectionId === self || !p.screenSfu) continue;
        sharers.set(p.connectionId, `${p.screenSfu.sessionId}:${p.screenSfu.trackName}`);
      }
    }
    for (const [id, entry] of [...entries]) {
      if (sharers.get(id) !== entry.shareId) remove(id);
    }
    for (const [id, shareId] of sharers) {
      if (entries.has(id)) continue;
      const entry: Entry = {
        shareId,
        gen: 0,
        state: "pulling",
        rid: "p",
        pulledAt: 0,
        stream: null,
        shown: false,
        everOk: false,
        failSince: null,
        keyRequested: false,
        retried: false,
      };
      entries.set(id, entry);
      startPull(id, entry);
    }
  };

  const keyReceived = async (frame: ScreenKeyFrame) => {
    const { fromConnectionId: id, fromUserId, keyIndex, envelope } = frame;
    if (typeof id !== "string" || typeof fromUserId !== "string") return;
    if (typeof keyIndex !== "number" || !Number.isInteger(keyIndex) || keyIndex < 0 || keyIndex > 255) return;
    const channelId = deps.channelId();
    if (channelId === null) return;
    const key = await deps.openKey(envelope, fromUserId, `screen:${channelId}:${id}:${keyIndex}`);
    if (!key) return;
    let perSharer = keys.get(id);
    if (!perSharer) keys.set(id, (perSharer = new Map()));
    perSharer.set(keyIndex, key);
    const entry = entries.get(id);
    if (viewer && entry && entry.state !== "mesh") viewer.setKey(id, keyIndex, key);
  };

  return {
    participantsChanged,
    keyReceived,
    decryptHealth,

    watchChanged(id: string, isWatching: boolean) {
      watching.set(id, isWatching);
      const entry = entries.get(id);
      if (!entry || entry.state !== "live" || !viewer) return;
      const want = wantRid(id);
      if (want === entry.rid) return;
      entry.rid = want;
      viewer.setLayer(id, want).catch((error) => log("Could not switch screen layer:", error));
    },

    /** Driven by a 1 s interval: mesh fallback for pulls that never decrypt. */
    tick() {
      const now = deps.now();
      for (const [id, entry] of [...entries]) {
        if (entry.state !== "live") continue;
        const neverOk = !entry.everOk && now - entry.pulledAt >= SFU_DECRYPT_GRACE_MS;
        const failing = entry.failSince !== null && now - entry.failSince >= SFU_DECRYPT_GRACE_MS;
        if (neverOk || failing) meshFallback(id, entry);
      }
    },

    /** Realtime frames: consumes RTC_SCREEN_KEY, observes VOICE_STATE / VOICE_PEER_LEFT. */
    handleFrame(data: { type?: unknown; [key: string]: unknown }): boolean {
      if (data.type === "RTC_SCREEN_KEY") {
        void keyReceived(data as ScreenKeyFrame).catch((error) => log("Could not open a screen key:", error));
        return true;
      }
      if (data.type === "VOICE_STATE" && Array.isArray(data.participants)) {
        participantsChanged(data.participants as ViewerParticipant[]);
      } else if (data.type === "VOICE_PEER_LEFT" && typeof data.connectionId === "string") {
        participantsChanged(lastList.filter((p) => p.connectionId !== data.connectionId));
      }
      return false;
    },

    /** Voice session over: drop every pull and close the viewer PC. */
    close() {
      for (const id of [...entries.keys()]) remove(id);
      keys.clear();
      watching.clear();
      lastList = [];
      reconnectUsed = false;
      const current = viewer;
      viewer = null;
      current?.close();
    },
  };
}

export type ViewerController = ReturnType<typeof createViewerController>;
