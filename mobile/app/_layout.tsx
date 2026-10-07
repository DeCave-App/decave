import "react-native-gesture-handler";
// Before anything that encrypts: Hermes needs crypto.getRandomValues from expo-crypto.
import "@/src/lib/e2ee/polyfills";
import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "@/src/providers/SessionProvider";
import { RealtimeProvider } from "@/src/providers/RealtimeProvider";
import { DmE2eeProvider } from "@/src/providers/DmE2eeProvider";
import { VoiceProvider } from "@/src/providers/VoiceProvider";
import { DirectCallProvider } from "@/src/providers/DirectCallProvider";
import { NotificationProvider } from "@/src/providers/NotificationProvider";
import { NotificationSettingsProvider } from "@/src/providers/NotificationSettingsProvider";
import { MutedUsersProvider } from "@/src/providers/MutedUsersProvider";
import { UnreadProvider } from "@/src/providers/UnreadProvider";
import { VoiceSettingsProvider } from "@/src/providers/VoiceSettingsProvider";
import { QuickActionsBridge } from "@/src/components/QuickActionsBridge";
import { SystemSurfacesBridge } from "@/src/components/SystemSurfacesBridge";
import { VoiceCallKitBridge } from "@/src/components/VoiceCallKitBridge";
import { IosBroadcastPicker } from "@/src/components/IosBroadcastPicker";
import { SoundboardListener } from "@/src/components/Soundboard";
import { useSkin } from "@/src/skin";

export default function RootLayout() {
  const { palette } = useSkin();
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.bg }}>
      <SafeAreaProvider>
        <SessionProvider>
          <RealtimeProvider>
            <DmE2eeProvider>
            <MutedUsersProvider>
            <UnreadProvider>
            <NotificationSettingsProvider>
              <NotificationProvider>
                <VoiceSettingsProvider>
                  <VoiceProvider>
                    <DirectCallProvider>
              <SoundboardListener />
              <QuickActionsBridge />
              <VoiceCallKitBridge />
              <SystemSurfacesBridge />
              <IosBroadcastPicker />
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: palette.bg },
                  animation: "fade",
                }}
              />
                    </DirectCallProvider>
                  </VoiceProvider>
                </VoiceSettingsProvider>
              </NotificationProvider>
            </NotificationSettingsProvider>
            </UnreadProvider>
            </MutedUsersProvider>
            </DmE2eeProvider>
          </RealtimeProvider>
        </SessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
