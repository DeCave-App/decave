// Voice mini player: dragging it around the window and saving where it was left.

import type { PointerEvent as ReactPointerEvent } from "react";
import type { AccountPreferences, AccountUser, VoiceMiniPlayerPosition } from "../types";
import { HTTP_URL } from "../env";
import { authorizedFetch } from "../http";
import { clampVoiceMiniPosition, voiceMiniDragState } from "../voice";
import type { PreferencesState } from "../state/preferences";

export type VoiceMiniPlayerActionsDeps = {
  currentUser: AccountUser | null;
  preferences: PreferencesState;
};

/** Called once per render with that render's values. */
export function createVoiceMiniPlayerActions(deps: VoiceMiniPlayerActionsDeps) {
  const { currentUser, preferences } = deps;
  const { setAccountPreferences } = preferences;

  const saveVoiceMiniPlayerPosition = async (position: VoiceMiniPlayerPosition) => {
    if (!currentUser) return;
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/account/preferences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceMiniPlayerPosition: position }),
      });
      if (response.ok) {
        const data = (await response.json()) as Partial<AccountPreferences>;
        setAccountPreferences((current) => ({ ...current, ...data, voiceMiniPlayerPosition: position }));
      }
    } catch {
      // The local position remains usable; the next drag can retry the sync.
    }
  };

  const handleVoiceMiniPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest("button, a, input, select, textarea"))
    )
      return;
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    const position = clampVoiceMiniPosition({ x: rect.left, y: rect.top }, rect.width, rect.height);
    setAccountPreferences((current) => ({ ...current, voiceMiniPlayerPosition: position }));
    voiceMiniDragState.set(element, {
      pointerId: event.pointerId,
      offsetX: event.clientX - position.x,
      offsetY: event.clientY - position.y,
      moved: false,
    });
    element.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const handleVoiceMiniPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = voiceMiniDragState.get(event.currentTarget);
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const next = clampVoiceMiniPosition(
      { x: event.clientX - drag.offsetX, y: event.clientY - drag.offsetY },
      rect.width,
      rect.height,
    );
    if (Math.abs(next.x - rect.left) > 1 || Math.abs(next.y - rect.top) > 1) drag.moved = true;
    setAccountPreferences((current) => ({ ...current, voiceMiniPlayerPosition: next }));
    event.preventDefault();
  };
  const handleVoiceMiniPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = voiceMiniDragState.get(event.currentTarget);
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const next = clampVoiceMiniPosition({ x: rect.left, y: rect.top }, rect.width, rect.height);
    voiceMiniDragState.delete(event.currentTarget);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.moved) void saveVoiceMiniPlayerPosition(next);
  };

  return {
    handleVoiceMiniPointerDown,
    handleVoiceMiniPointerMove,
    handleVoiceMiniPointerUp,
  };
}

export type VoiceMiniPlayerActions = ReturnType<typeof createVoiceMiniPlayerActions>;
