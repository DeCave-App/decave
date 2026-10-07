// Follows the operating system's dark mode and reduced-motion preferences.

import { useEffect, useState } from "react";

export function useSystemAppearance() {
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
    const onMotion = () => setSystemReducedMotion(motion.matches);
    dark.addEventListener?.("change", onDark);
    motion.addEventListener?.("change", onMotion);
    return () => {
      dark.removeEventListener?.("change", onDark);
      motion.removeEventListener?.("change", onMotion);
    };
  }, []);

  return { prefersDark, systemReducedMotion };
}
