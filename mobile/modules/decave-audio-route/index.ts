import { Platform } from "react-native";
import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";

export type AudioRoute = {
  /** Playback currently comes out of the loudspeaker. */
  speaker: boolean;
  /** Headphones, Bluetooth, AirPlay or a car are connected and take priority. */
  external: boolean;
  outputName: string;
  wantsSpeaker: boolean;
};

type NativeModule = {
  getRoute(): AudioRoute;
  setSpeaker(enabled: boolean): Promise<AudioRoute>;
  reapply(): Promise<AudioRoute>;
  addListener(event: "onRouteChange", listener: (route: AudioRoute) => void): EventSubscription;
};

const native = Platform.OS === "ios" ? requireOptionalNativeModule<NativeModule>("DecaveAudioRoute") : null;

/** Speaker / earpiece routing for voice rooms. iOS only; no-ops elsewhere. */
export const AudioRouting = {
  available: native != null,
  getRoute: (): AudioRoute | null => native?.getRoute() ?? null,
  setSpeaker: (enabled: boolean) => native?.setSpeaker(enabled) ?? Promise.resolve(null),
  reapply: () => native?.reapply() ?? Promise.resolve(null),
  addRouteListener: (listener: (route: AudioRoute) => void): { remove(): void } =>
    native?.addListener("onRouteChange", listener) ?? { remove() {} },
};
