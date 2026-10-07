// The desktop app's fit scale: shrinks the interface on small windows and
// mirrors it to --dc-fit for signed-out screens.

import { useEffect, useState } from "react";
import { desktopFitScale } from "../desktop";

export function useDesktopFitScale(): number {
  const [fitScale, setFitScale] = useState<number>(desktopFitScale);
  useEffect(() => {
    if (!window.decaveDesktop?.isDesktop) return;
    const update = () => {
      const next = desktopFitScale();
      // Signed-out screens render outside .app, so they read the fit from the root.
      document.documentElement.style.setProperty("--dc-fit", String(next));
      setFitScale(next);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return fitScale;
}
