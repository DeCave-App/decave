// Browser side of the screen-share SFU path (Cloudflare Realtime):
// request/response signalling over the app WebSocket, the sharer's publisher
// PeerConnection (simulcast "f"/"p" + encrypt transform) and the viewer's single
// pull PeerConnection (decrypt transform per pulled sharer).
import { SCREEN_PREVIEW_BITRATE, SCREEN_PREVIEW_DOWNSCALE, SCREEN_PREVIEW_FPS } from "../../app/voice.ts";
import { hasUsableRelayIceServers } from "../../../shared/rtc-relay.ts";
import { isRelayIceCandidate, RELAY_UNAVAILABLE_MESSAGE } from "../relay-policy.ts";
import { attachScreenTransform, type ScreenTransformHandle } from "./attach-transform.ts";
import type { ScreenCodec } from "./frame-crypto.ts";

export const SFU_REQUEST_TIMEOUT_MS = 10_000;

export type SfuError = Error & { code: string };

export type SfuSignaller = {
  request<T>(type: string, body: object, timeoutMs?: number): Promise<T>;
  handleResult(frame: unknown): boolean;
  /** Fail every pending request now (e.g. the socket dropped). */
  rejectAll(code: string): void;
};

function sfuError(code: string): SfuError {
  const e = new Error(code) as SfuError;
  e.code = code;
  return e;
}

export function createSfuSignaller(sendSocket: (p: unknown) => boolean): SfuSignaller {
  let seq = 0;
  const prefix = Math.random().toString(36).slice(2, 10);
  const pending = new Map<
    string,
    { resolve(v: unknown): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }
  >();
  return {
    request<T>(type: string, body: object, timeoutMs = SFU_REQUEST_TIMEOUT_MS): Promise<T> {
      const requestId = `${prefix}-${++seq}`;
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(sfuError("timeout"));
        }, timeoutMs);
        pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject, timer });
        if (!sendSocket({ ...body, type, requestId })) {
          clearTimeout(timer);
          pending.delete(requestId);
          reject(sfuError("not-connected"));
        }
      });
    },
    rejectAll(code: string): void {
      for (const [id, entry] of pending) {
        pending.delete(id);
        clearTimeout(entry.timer);
        entry.reject(sfuError(code));
      }
    },
    handleResult(frame: unknown): boolean {
      if (!frame || typeof frame !== "object") return false;
      const f = frame as { type?: unknown; requestId?: unknown; ok?: unknown; error?: unknown };
      if (f.type !== "RTC_SFU_RESULT" || typeof f.requestId !== "string") return false;
      const entry = pending.get(f.requestId);
      if (!entry) return false;
      pending.delete(f.requestId);
      clearTimeout(entry.timer);
      if (f.ok === true) entry.resolve(frame);
      else entry.reject(sfuError(typeof f.error === "string" ? f.error : "error"));
      return true;
    },
  };
}

// ---- shared helpers ----

type Sdp = { type: "offer" | "answer"; sdp: string };

// Same relay-only policy as every other peer connection in the app (see relay-policy.ts):
// media to Cloudflare Realtime goes through TURN so the SFU path never exposes the user's IP,
// and without TURN servers we refuse rather than fall back to direct ICE.
function createRelayPc(iceServers: RTCIceServer[]): RTCPeerConnection {
  if (!hasUsableRelayIceServers(iceServers)) throw new Error(RELAY_UNAVAILABLE_MESSAGE);
  return new RTCPeerConnection({ iceServers, iceTransportPolicy: "relay", bundlePolicy: "max-bundle" });
}

/** Defense in depth: never send a non-relay local candidate to the server. */
export function stripNonRelayCandidates(sdp: string): string {
  return sdp
    .split("\r\n")
    .filter((line) => !line.startsWith("a=candidate:") || isRelayIceCandidate(line.slice(2)))
    .join("\r\n");
}

export function codecFromMime(mime: string | undefined, fallback: ScreenCodec): ScreenCodec {
  const m = (mime ?? "").toLowerCase();
  if (m.endsWith("/vp8")) return "vp8";
  if (m.endsWith("/vp9")) return "vp9";
  if (m.endsWith("/h264")) return "h264";
  if (m.endsWith("/av1")) return "av1";
  return fallback;
}

function negotiatedCodec(target: RTCRtpSender | RTCRtpReceiver, fallback: ScreenCodec): ScreenCodec {
  try {
    return codecFromMime(target.getParameters().codecs?.[0]?.mimeType, fallback);
  } catch {
    return fallback;
  }
}

function sdpOf(d: RTCSessionDescription | RTCSessionDescriptionInit | null): Sdp {
  return { type: d?.type as Sdp["type"], sdp: stripNonRelayCandidates(d?.sdp ?? "") };
}

// ---- publisher ----

export type SfuPublisher = {
  pc: RTCPeerConnection;
  setKey(i: number, k: Uint8Array): void;
  updateFull(enc: RTCRtpEncodingParameters): Promise<void>;
  stop(): Promise<void>;
};

function preferVp8(transceiver: RTCRtpTransceiver): ScreenCodec | null {
  const caps = (globalThis as { RTCRtpSender?: typeof RTCRtpSender }).RTCRtpSender?.getCapabilities?.("video");
  if (!caps || typeof transceiver.setCodecPreferences !== "function") return null;
  const rank = (c: { mimeType: string }) => {
    const m = c.mimeType.toLowerCase();
    return m === "video/vp8" ? 0 : m === "video/vp9" ? 1 : 2;
  };
  const sorted = [...caps.codecs].sort((a, b) => rank(a) - rank(b));
  try {
    transceiver.setCodecPreferences(sorted);
  } catch {
    return null;
  }
  return codecFromMime(sorted[0]?.mimeType, "vp8");
}

export async function publishScreen(
  track: MediaStreamTrack,
  opts: {
    signaller: SfuSignaller;
    iceServers: RTCIceServer[];
    codec: ScreenCodec;
    fullEncoding: RTCRtpEncodingParameters;
  },
): Promise<SfuPublisher> {
  const pc = createRelayPc(opts.iceServers);
  const keys = new Map<number, Uint8Array>();
  let handle: ScreenTransformHandle | null = null;
  try {
    const transceiver = pc.addTransceiver(track, {
      direction: "sendonly",
      sendEncodings: [
        { ...opts.fullEncoding, rid: "f" },
        {
          rid: "p",
          scaleResolutionDownBy: SCREEN_PREVIEW_DOWNSCALE,
          maxFramerate: SCREEN_PREVIEW_FPS,
          maxBitrate: SCREEN_PREVIEW_BITRATE,
        },
      ],
    });
    const sender = transceiver.sender;
    let codec = preferVp8(transceiver) ?? opts.codec;
    // Attach before any media flows so no frame leaves unencrypted.
    handle = attachScreenTransform(sender, "encrypt", codec);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const mid = transceiver.mid;
    const res = await opts.signaller.request<{ answer: Sdp; sessionId?: string }>("RTC_SFU_PUBLISH", {
      offer: sdpOf(pc.localDescription),
      mid,
    });
    await pc.setRemoteDescription(res.answer);
    const actual = negotiatedCodec(sender, codec);
    if (actual !== codec) {
      // Negotiation landed on a different codec: re-attach so the clear-header rules match.
      // Only reachable when setCodecPreferences is unavailable. Frames sent in the short window
      // before this are still encrypted (never clear), just with the wrong clear-header length,
      // so viewers drop them as decrypt failures until the next frame.
      codec = actual;
      handle.dispose();
      handle = attachScreenTransform(sender, "encrypt", codec);
      for (const [i, k] of keys) handle.setKey(i, k);
    }
    let stopped = false;
    return {
      pc,
      setKey(i, k) {
        keys.set(i & 0xff, k);
        handle?.setKey(i, k);
      },
      async updateFull(enc) {
        const params = sender.getParameters();
        const full = params.encodings.find((e) => e.rid === "f");
        if (!full) return;
        Object.assign(full, enc, { rid: "f" });
        await sender.setParameters(params);
      },
      async stop() {
        if (stopped) return;
        stopped = true;
        try {
          // Scoped to this publish: a stale stop must not end a newer share.
          await opts.signaller.request("RTC_SFU_STOP", res.sessionId ? { sessionId: res.sessionId } : {});
        } catch {}
        handle?.dispose();
        handle = null;
        pc.close();
      },
    };
  } catch (e) {
    handle?.dispose();
    pc.close();
    throw e;
  }
}

// ---- viewer ----

export type SfuViewer = {
  pull(sharerConnectionId: string, rid: "f" | "p"): Promise<MediaStream>;
  setLayer(sharerConnectionId: string, rid: "f" | "p"): Promise<void>;
  setKey(sharerConnectionId: string, i: number, k: Uint8Array): void;
  drop(sharerConnectionId: string): void;
  onDecryptHealth(cb: (sharerConnectionId: string, ok: boolean) => void): void;
  /** The pull PC failed (ICE/DTLS); the caller decides whether to reconnect. */
  onFailed(cb: () => void): void;
  close(): void;
};

type Pulled = { mid: string; handle: ScreenTransformHandle | null; keys: Map<number, Uint8Array> };

export function createSfuViewer(opts: { signaller: SfuSignaller; iceServers: RTCIceServer[] }): SfuViewer {
  const pc = createRelayPc(opts.iceServers);
  const pulls = new Map<string, Pulled>();
  const healthCbs: Array<(id: string, ok: boolean) => void> = [];
  const failedCbs: Array<() => void> = [];
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed") for (const cb of failedCbs) cb();
  };
  // Serialise negotiations: one pull session, one offer/answer at a time.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };

  const findTransceiver = (mid: string) => pc.getTransceivers().find((t) => t.mid === mid) ?? null;

  const disposePull = (p: Pulled) => {
    p.handle?.dispose();
    p.handle = null;
  };

  return {
    pull(sharerConnectionId, rid) {
      return serial(async () => {
        const res = await opts.signaller.request<{
          offer: Sdp | null;
          mid: string;
          requiresImmediateRenegotiation?: boolean;
        }>("RTC_SFU_PULL", { sharerConnectionId, rid });
        const prev = pulls.get(sharerConnectionId);
        const keys = prev?.keys ?? new Map<number, Uint8Array>();
        if (prev) disposePull(prev);
        const attach = (receiver: RTCRtpReceiver, codec: ScreenCodec): ScreenTransformHandle => {
          const handle = attachScreenTransform(receiver, "decrypt", codec);
          for (const [i, k] of keys) handle.setKey(i, k);
          handle.worker.addEventListener("message", (ev: MessageEvent) => {
            const t = (ev.data as { type?: string } | null)?.type;
            if (t !== "decrypt-failed" && t !== "decrypt-ok") return;
            if (pulls.get(sharerConnectionId)?.handle !== handle) return;
            for (const cb of healthCbs) cb(sharerConnectionId, t === "decrypt-ok");
          });
          return handle;
        };
        // The decrypt transform must be in place BEFORE the answer reaches the SFU: on an
        // already-connected pull PC the new mid starts flowing as soon as the SFU has the answer,
        // and any frame reaching the decoder without the transform would be raw ciphertext.
        if (res.offer) await pc.setRemoteDescription(res.offer);
        const transceiver = findTransceiver(res.mid);
        if (!transceiver) {
          // Keep the keys but not the disposed pull's stale mid.
          pulls.set(sharerConnectionId, { mid: "", handle: null, keys });
          throw sfuError("no-track");
        }
        const receiver = transceiver.receiver;
        // The SFU publisher prefers VP8, so start with it and correct after negotiation.
        let codec: ScreenCodec = "vp8";
        const entry: Pulled = { mid: res.mid, handle: attach(receiver, codec), keys };
        pulls.set(sharerConnectionId, entry);
        try {
          if (res.offer) {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            const actual = negotiatedCodec(receiver, codec);
            if (actual !== codec) {
              codec = actual;
              entry.handle?.dispose();
              entry.handle = attach(receiver, codec);
            }
            await opts.signaller.request("RTC_SFU_RENEGOTIATE", { answer: sdpOf(pc.localDescription) });
          }
        } catch (e) {
          if (pulls.get(sharerConnectionId) === entry) {
            disposePull(entry);
            pulls.set(sharerConnectionId, { mid: "", handle: null, keys });
          }
          throw e;
        }
        return new MediaStream([receiver.track]);
      });
    },
    async setLayer(sharerConnectionId, rid) {
      const p = pulls.get(sharerConnectionId);
      if (!p || !p.mid) throw sfuError("not-pulled");
      await opts.signaller.request("RTC_SFU_LAYER", { sharerConnectionId, mid: p.mid, rid });
    },
    setKey(sharerConnectionId, i, k) {
      let p = pulls.get(sharerConnectionId);
      if (!p) {
        // Keys may arrive before the pull completes; keep them for attach time.
        p = { mid: "", handle: null, keys: new Map() };
        pulls.set(sharerConnectionId, p);
      }
      p.keys.set(i & 0xff, k);
      p.handle?.setKey(i, k);
    },
    drop(sharerConnectionId) {
      const p = pulls.get(sharerConnectionId);
      if (!p) return;
      disposePull(p);
      pulls.delete(sharerConnectionId);
    },
    onDecryptHealth(cb) {
      healthCbs.push(cb);
    },
    onFailed(cb) {
      failedCbs.push(cb);
    },
    close() {
      for (const p of pulls.values()) disposePull(p);
      pulls.clear();
      healthCbs.length = 0;
      failedCbs.length = 0;
      pc.close();
    },
  };
}
