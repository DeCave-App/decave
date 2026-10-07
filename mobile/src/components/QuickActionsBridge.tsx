import { useEffect } from "react";
import { router } from "expo-router";
import * as QuickActions from "expo-quick-actions";
import { useQuickActionCallback } from "expo-quick-actions/hooks";
import { loadLastVoiceRoom, voiceRoomHref } from "@/src/lib/last-voice-room";
import { useSession } from "@/src/providers/SessionProvider";

/** Long-press app icon shortcuts: DMs, Find a Squad, and rejoining the last voice room. */
export function QuickActionsBridge() {
  const { user, token } = useSession();

  useEffect(() => {
    let active = true;
    if (!user) {
      void QuickActions.setItems([]).catch(() => undefined);
      return () => { active = false; };
    }
    void loadLastVoiceRoom().then((room) => {
      if (!active) return;
      void QuickActions.setItems([
        { id: "dms", title: "Messages", icon: "symbol:bubble.left.and.bubble.right", params: { href: "/dms" } },
        { id: "squad", title: "Find a Squad", icon: "symbol:gamecontroller", params: { href: "/squad-finder" } },
        ...(room
          ? [{ id: "voice", title: "Rejoin voice", subtitle: room.name, icon: "symbol:headphones", params: { href: voiceRoomHref(room) } }]
          : []),
      ]).catch(() => undefined);
    });
    return () => { active = false; };
  }, [user?.id, token]);

  useQuickActionCallback((action) => {
    const href = action.params?.href;
    if (typeof href === "string" && href.startsWith("/")) router.push(href as never);
  });

  return null;
}
