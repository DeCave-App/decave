// Hermes has no Web Crypto. The DM encryption code (@noble) needs
// crypto.getRandomValues and the session needs crypto.randomUUID; expo-crypto
// provides both from the platform's secure random source. Import this first.
import * as ExpoCrypto from "expo-crypto";

type CryptoLike = {
  getRandomValues?: <T extends ArrayBufferView | null>(array: T) => T;
  randomUUID?: () => string;
};

const target = ((globalThis as { crypto?: CryptoLike }).crypto ??= {});
if (typeof target.getRandomValues !== "function") {
  target.getRandomValues = (<T extends ArrayBufferView | null>(array: T): T => {
    ExpoCrypto.getRandomValues(array as unknown as Uint8Array);
    return array;
  }) as CryptoLike["getRandomValues"];
}
if (typeof target.randomUUID !== "function") {
  target.randomUUID = () => ExpoCrypto.randomUUID();
}
