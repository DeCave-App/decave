import { useEffect, useRef } from "react";
import { findNodeHandle, NativeModules, Platform, StyleSheet, View } from "react-native";
import { ScreenCapturePickerView } from "react-native-webrtc";
import { ScreenBroadcast } from "../../modules/decave-screen-broadcast";

// iOS only lets an app share the whole screen through a ReplayKit broadcast
// extension (targets/broadcast). The person starts it from the system sheet
// that RPSystemBroadcastPickerView opens; this keeps one hidden picker mounted
// so VoiceProvider can open that sheet from its "Share screen" action.

let pickerTag: number | null = null;

/** Mounted once in the root layout. Renders nothing visible. */
export function IosBroadcastPicker() {
  const ref = useRef(null);
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    pickerTag = findNodeHandle(ref.current);
    return () => {
      pickerTag = null;
    };
  }, []);
  if (Platform.OS !== "ios") return null;
  return (
    <View pointerEvents="none" style={styles.hidden}>
      <ScreenCapturePickerView ref={ref} />
    </View>
  );
}

const START_TIMEOUT_MS = 60_000;

/**
 * Opens the system broadcast sheet and resolves true once the extension has
 * started, false if the person closes the sheet without starting (we only
 * learn that by timing out) or the picker is not mounted.
 */
export function requestIosBroadcast(): Promise<boolean> {
  const tag = pickerTag;
  const manager = NativeModules.ScreenCapturePickerViewManager as { show?: (tag: number) => void } | undefined;
  if (Platform.OS !== "ios" || tag == null || !manager?.show || !ScreenBroadcast.available) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const started = ScreenBroadcast.onStarted(() => finish(true));
    const timer = setTimeout(() => finish(false), START_TIMEOUT_MS);
    function finish(ok: boolean) {
      clearTimeout(timer);
      started.remove();
      resolve(ok);
    }
    manager.show!(tag);
  });
}

const styles = StyleSheet.create({
  hidden: { position: "absolute", width: 1, height: 1, opacity: 0, left: -10, top: -10 },
});
