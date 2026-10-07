import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

type VoiceActivityState = { participants: number; muted: boolean; deafened: boolean };

type NativeModule = {
  start(roomName: string, hubName: string, state: VoiceActivityState): Promise<boolean>;
  update(state: VoiceActivityState): Promise<void>;
  end(): Promise<void>;
};

const native = Platform.OS === "ios" ? requireOptionalNativeModule<NativeModule>("DecaveLiveActivity") : null;

/** Voice room Live Activity (lock screen and Dynamic Island). No-ops where unsupported. */
export const VoiceLiveActivity = {
  start: (roomName: string, hubName: string, state: VoiceActivityState) => native?.start(roomName, hubName, state) ?? Promise.resolve(false),
  update: (state: VoiceActivityState) => native?.update(state) ?? Promise.resolve(),
  end: () => native?.end() ?? Promise.resolve(),
};
