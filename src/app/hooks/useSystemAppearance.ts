// Follows the operating system's dark mode, reduced-motion and reduced-transparency preferences.

import { useEffect, useState } from "react";
import { isLowPowerDevice } from "../../features/settings";

const REDUCE_TRANSPARENCY = "(prefers-reduced-transparency: reduce)";

export function useSystemAppearance() {
  const [systemReducedTransparency, setSystemReducedTransparency] = useState(
    () => typeof window !== "undefined" && Boolean(window.matchMedia?.(REDUCE_TRANSPARENCY).matches),
  );
  const [lowPowerDevice] = useState(
    () => typeof navigator !== "undefined" && isLowPowerDevice(navigator as Navigator & { deviceMemory?: number }),
  );
  const [prefersDark, setPrefersDark] = useState(
    () =>
      typeof window === "undefined" || !window.matchMedia || window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [systemReducedMotion, setSystemReducedMotion] = useState(
    () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches),
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onDark = () => setPrefersDark(dark.matches);
    const transparency = window.matchMedia(REDUCE_TRANSPARENCY);
    const onMotion = () => setSystemReducedMotion(motion.matches);
    const onTransparency = () => setSystemReducedTransparency(transparency.matches);
    dark.addEventListener?.("change", onDark);
    motion.addEventListener?.("change", onMotion);
    transparency.addEventListener?.("change", onTransparency);
    return () => {
      dark.removeEventListener?.("change", onDark);
      motion.removeEventListener?.("change", onMotion);
      transparency.removeEventListener?.("change", onTransparency);
    };
  }, []);

  return { prefersDark, systemReducedMotion, systemReducedTransparency, lowPowerDevice };
}
