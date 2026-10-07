import { useEffect, useState } from "react";
import { Keyboard, Platform, useWindowDimensions } from "react-native";

/** Width at which iPad gets split views and desktop-style input. */
export const WIDE_MIN_WIDTH = 700;

export function useIsWide(): boolean {
  return useWindowDimensions().width >= WIDE_MIN_WIDTH;
}

/**
 * True while a hardware keyboard is in use. iOS doesn't expose this, but with
 * one attached the on-screen keyboard shrinks to the shortcut bar (< ~120pt).
 */
export function useHardwareKeyboard(): boolean {
  const [hardware, setHardware] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const sub = Keyboard.addListener("keyboardWillChangeFrame", (event) => {
      const height = event.endCoordinates.height;
      if (height > 0) setHardware(height < 120);
    });
    return () => sub.remove();
  }, []);
  return hardware;
}
