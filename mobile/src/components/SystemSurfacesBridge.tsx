import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { ExtensionStorage } from "@bacons/apple-targets";
import { VoiceLiveActivity } from "../../modules/decave-live-activity";
import { loadLastVoiceRoom, roomNameFor } from "@/src/lib/last-voice-room";
import { useUnread } from "@/src/providers/UnreadProvider";
import { useVoice } from "@/src/providers/VoiceProvider";
import { useSession } from "@/src/providers/SessionProvider";

const storage = Platform.OS === "ios" ? new ExtensionStorage("group.com.example.decave") : null;

function roomLink(room: { channelId: number; hubId: number; name: string; squad?: boolean }): string {
  return `decave://voice/${room.channelId}?hubId=${room.hubId}&name=${encodeURIComponent(room.name)}${room.squad ? "&squad=1" : ""}`;
}

/**
 * Feeds iOS system surfaces: the Home Screen widget (unread + last voice room),
 * Siri's "Rejoin my voice room", and the voice Live Activity.
 */
export function SystemSurfacesBridge() {
  const { user } = useSession();
  const { dmTotal, rooms } = useUnread();
  const { voiceChannelId, voiceOwnerGeneration, sessionGeneration, voiceStatus, participants, muted, deafened } = useVoice();
  const activityRoomRef = useRef<number | null>(null);
  const activityAccountRef = useRef<string | null>(null);
  const activityGenerationRef = useRef(0);
  const activityQueueRef = useRef<Promise<void>>(Promise.resolve());

  const unreadTotal = dmTotal + Object.values(rooms).reduce((sum, count) => sum + count, 0);
  const connected = voiceOwnerGeneration === sessionGeneration && voiceChannelId != null && voiceStatus === "connected";

  useEffect(() => {
    if (!storage) return;
    storage.set("unreadTotal", user ? unreadTotal : 0);
    ExtensionStorage.reloadWidget("DeCaveWidget");
  }, [user?.id, sessionGeneration, unreadTotal]);

  useEffect(() => {
    if (!storage) return;
    let active = true;
    storage.set("inVoice", 0);
    storage.remove("lastRoomName");
    storage.remove("lastRoomLink");
    ExtensionStorage.reloadWidget("DeCaveWidget");
    if (!user) {
      storage.set("unreadTotal", 0);
      storage.set("inVoice", 0);
      storage.remove("lastRoomName");
      storage.remove("lastRoomLink");
      ExtensionStorage.reloadWidget("DeCaveWidget");
      return;
    }
    void loadLastVoiceRoom().then((room) => {
      if (!active) return;
      storage.set("inVoice", connected ? 1 : 0);
      if (room) {
        storage.set("lastRoomName", room.name);
        storage.set("lastRoomLink", roomLink(room));
      } else {
        storage.remove("lastRoomName");
        storage.remove("lastRoomLink");
      }
      ExtensionStorage.reloadWidget("DeCaveWidget");
    });
    return () => { active = false; };
  }, [user?.id, sessionGeneration, connected, voiceChannelId]);

  // Live Activity follows the connected voice room.
  useEffect(() => {
    const generation = ++activityGenerationRef.current;
    const queueActivity = (operation: () => Promise<void>) => {
      activityQueueRef.current = activityQueueRef.current.then(operation, operation);
    };
    if (Platform.OS !== "ios") return;
    const accountChanged = activityAccountRef.current !== (user?.id ?? null);
    if (accountChanged) {
      activityAccountRef.current = user?.id ?? null;
      activityRoomRef.current = null;
      queueActivity(() => VoiceLiveActivity.end().then(() => undefined).catch(() => undefined));
    }
    if (!user || !connected) {
      if (activityRoomRef.current != null) {
        activityRoomRef.current = null;
        queueActivity(() => VoiceLiveActivity.end().then(() => undefined).catch(() => undefined));
      }
      // A cold start has no JS activity reference, but the OS can still retain
      // a Live Activity from the previous process or signed-in account.
      if (!user && !accountChanged) {
        queueActivity(() => VoiceLiveActivity.end().then(() => undefined).catch(() => undefined));
      }
      return;
    }
    if (activityRoomRef.current !== voiceChannelId) {
      activityRoomRef.current = voiceChannelId;
      const channelId = voiceChannelId;
      void roomNameFor(channelId).then((name) => {
        queueActivity(async () => {
          if (generation !== activityGenerationRef.current || !user || !connected) return;
          await VoiceLiveActivity.start(name, "", { participants: Math.max(1, participants.length), muted, deafened });
        });
      }).catch((error) => console.warn("[live-activity] could not start", error));
    }
  }, [user?.id, sessionGeneration, connected, voiceChannelId]);

  useEffect(() => {
    if (Platform.OS !== "ios" || !user || !connected || activityRoomRef.current == null) return;
    const generation = activityGenerationRef.current;
    activityQueueRef.current = activityQueueRef.current.then(async () => {
      if (generation !== activityGenerationRef.current) return;
      await VoiceLiveActivity.update({ participants: Math.max(1, participants.length), muted, deafened });
    }).catch(() => undefined);
  }, [user?.id, sessionGeneration, connected, participants.length, muted, deafened]);

  return null;
}
