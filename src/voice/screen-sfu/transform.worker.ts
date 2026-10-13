// RTCRtpScriptTransform worker: encrypts (sharer) / decrypts (viewer) every encoded video frame.
// A frame that cannot be encrypted or authenticated is dropped, never passed through.
import { DecryptHealth } from "./capability.ts";
import { ScreenFrameKeyring, encryptFrame, decryptFrame, type ScreenCodec } from "./frame-crypto.ts";

type EncodedFrame = { type?: string; data: ArrayBuffer };
type TransformEvent = { transformer: { options: Options; readable: ReadableStream; writable: WritableStream } };
type WorkerScope = {
  onmessage: ((e: MessageEvent) => void) | null;
  onrtctransform: ((e: TransformEvent) => void) | null;
  postMessage(m: unknown): void;
};
const scope = self as unknown as WorkerScope;
type Options = { role: "encrypt" | "decrypt"; codec: ScreenCodec };

const keyring = new ScreenFrameKeyring();
const health = new DecryptHealth();
// Serialise key installs so frames queued behind a new key see it.
let keyReady: Promise<void> = Promise.resolve();

scope.onmessage = (event: MessageEvent) => {
  const msg = event.data as { type?: string; index?: number; key?: Uint8Array };
  if (msg?.type === "key" && typeof msg.index === "number" && msg.key instanceof Uint8Array) {
    const { index, key } = msg;
    keyReady = keyReady.then(() => keyring.setKey(index & 0xff, key)).catch(() => {});
  }
};

scope.onrtctransform = (event) => {
  const { role, codec } = event.transformer.options as Options;
  const stream = new TransformStream({
    async transform(frame: EncodedFrame, controller: TransformStreamDefaultController) {
      await keyReady;
      const opts = { codec, keyFrame: frame.type === "key" };
      try {
        if (role === "encrypt") {
          frame.data = await encryptFrame(frame.data, opts, keyring);
          controller.enqueue(frame);
          return;
        }
        const plain = await decryptFrame(frame.data, opts, keyring);
        if (!plain) {
          if (health.onFailure(Date.now())) scope.postMessage({ type: "decrypt-failed" });
          return;
        }
        frame.data = plain;
        controller.enqueue(frame);
        if (health.onSuccess()) scope.postMessage({ type: "decrypt-ok" });
      } catch {
        if (role === "decrypt" && health.onFailure(Date.now())) scope.postMessage({ type: "decrypt-failed" });
        // drop the frame
      }
    },
  });
  event.transformer.readable
    .pipeThrough(stream)
    .pipeTo(event.transformer.writable)
    .catch(() => {});
};
