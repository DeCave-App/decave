import { Platform } from "react-native";
import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";

type BroadcastEvent = "onBroadcastStarted" | "onBroadcastStopped";

type NativeModule = {
  addListener(event: BroadcastEvent, listener: () => void): EventSubscription;
};

const native = Platform.OS === "ios" ? requireOptionalNativeModule<NativeModule>("DecaveScreenBroadcast") : null;

/** iOS ReplayKit broadcast extension state. No-ops elsewhere. */
export const ScreenBroadcast = {
  available: native != null,
  onStarted: (listener: () => void): { remove(): void } =>
    native?.addListener("onBroadcastStarted", listener) ?? { remove() {} },
  onStopped: (listener: () => void): { remove(): void } =>
    native?.addListener("onBroadcastStopped", listener) ?? { remove() {} },
};
