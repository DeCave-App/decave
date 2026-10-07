// Adds an app-wide stylesheet to <head> while the app is mounted, after the
// bundled CSS, so it wins cascade ties against it.

import { useEffect } from "react";

export function useInjectedStyle(styleId: string, css: string): void {
  useEffect(() => {
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
    return () => style.remove();
  }, [styleId, css]);
}
