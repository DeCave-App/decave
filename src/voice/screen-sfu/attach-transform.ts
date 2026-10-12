import type { ScreenCodec } from "./frame-crypto.ts";

export type ScreenTransformHandle = {
  worker: Worker;
  setKey(index: number, key: Uint8Array): void;
  dispose(): void;
};

export function attachScreenTransform(
  target: RTCRtpSender | RTCRtpReceiver,
  role: "encrypt" | "decrypt",
  codec: ScreenCodec,
): ScreenTransformHandle {
  const worker = new Worker(new URL("./transform.worker.ts", import.meta.url), { type: "module" });
  const Ctor = (globalThis as unknown as { RTCRtpScriptTransform: new (w: Worker, o: unknown) => unknown }).RTCRtpScriptTransform;
  (target as unknown as { transform: unknown }).transform = new Ctor(worker, { role, codec });
  return {
    worker,
    setKey(index, key) {
      worker.postMessage({ type: "key", index: index & 0xff, key });
    },
    dispose() {
      try {
        (target as unknown as { transform: unknown }).transform = null;
      } catch {}
      worker.terminate();
    },
  };
}
