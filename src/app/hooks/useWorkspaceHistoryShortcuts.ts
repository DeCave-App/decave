// Back/forward through the workspace history with the keyboard and mouse buttons.

import { type MutableRefObject, useEffect } from "react";
import type { WorkspaceHistoryEntry } from "../types";

export type WorkspaceHistoryShortcutsDeps = {
  workspaceBackRef: MutableRefObject<WorkspaceHistoryEntry[]>;
  workspaceForwardRef: MutableRefObject<WorkspaceHistoryEntry[]>;
  sideMouseHeldRef: MutableRefObject<number | null>;
  sideMouseLastRef: MutableRefObject<{ button: number; at: number } | null>;
  workspaceSnapshot: () => WorkspaceHistoryEntry;
  restoreWorkspaceEntry: (entry: WorkspaceHistoryEntry) => void;
};

export function useWorkspaceHistoryShortcuts(deps: WorkspaceHistoryShortcutsDeps): void {
  const {
    workspaceBackRef,
    workspaceForwardRef,
    sideMouseHeldRef,
    sideMouseLastRef,
    workspaceSnapshot,
    restoreWorkspaceEntry,
  } = deps;

  useEffect(() => {
    const navigateWorkspaceHistory = (direction: "back" | "forward") => {
      const source = direction === "back" ? workspaceBackRef.current : workspaceForwardRef.current;
      if (source.length === 0) return;
      const current = workspaceSnapshot();
      const target = source[source.length - 1];
      if (direction === "back") {
        workspaceBackRef.current = [];
        workspaceForwardRef.current = [current];
      } else {
        workspaceForwardRef.current = [];
        workspaceBackRef.current = [current];
      }
      restoreWorkspaceEntry(target);
    };

    const handleSideMouseDown = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      event.stopPropagation();

      if (sideMouseHeldRef.current === event.button) return;
      const now = performance.now();
      const last = sideMouseLastRef.current;
      if (last && last.button === event.button && now - last.at < 220) return;

      sideMouseHeldRef.current = event.button;
      sideMouseLastRef.current = { button: event.button, at: now };
      navigateWorkspaceHistory(event.button === 3 ? "back" : "forward");
    };
    const handleSideMouseUp = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      event.stopPropagation();
      if (sideMouseHeldRef.current === event.button) sideMouseHeldRef.current = null;
    };
    const blockAuxClick = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("mousedown", handleSideMouseDown, true);
    window.addEventListener("mouseup", handleSideMouseUp, true);
    window.addEventListener("auxclick", blockAuxClick, true);
    return () => {
      window.removeEventListener("mousedown", handleSideMouseDown, true);
      window.removeEventListener("mouseup", handleSideMouseUp, true);
      window.removeEventListener("auxclick", blockAuxClick, true);
    };
  });
}
