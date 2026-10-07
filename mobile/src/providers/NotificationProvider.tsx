import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";
import { router, usePathname } from "expo-router";
import * as Notifications from "expo-notifications";
import { useNotificationSettings } from "@/src/providers/NotificationSettingsProvider";
import { useMutedUsers } from "@/src/providers/MutedUsersProvider";
import { useRealtime } from "@/src/providers/RealtimeProvider";
import { useSession } from "@/src/providers/SessionProvider";
import { apiJson } from "@/src/lib/api";
import { registerForPush, unregisterPush } from "@/src/lib/push";
import { primePermission } from "@/src/lib/permission-primer";
import { onSquadSearchChanged } from "@/src/lib/squad-search-events";

export type NotificationPermissionState =
  | "checking"
  | "granted"
  | "denied";

type NotificationContextValue = {
  permissionState: NotificationPermissionState;
  requestPermission: () => Promise<boolean>;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

let shouldPlayNotificationSounds = true;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: shouldPlayNotificationSounds,
    shouldSetBadge: false,
  }),
});

function privacyText(
  preview: "full" | "sender" | "hidden",
  sender: string,
  text: string,
  kind: "dm" | "group" | "hub" | "mention",
  context?: string,
): { title: string; body: string } {
  if (preview === "hidden") {
    return {
      title: "DeCave",
      body:
        kind === "mention"
          ? "You were mentioned in DeCave."
          : "You received a new message.",
    };
  }

  if (preview === "sender") {
    if (kind === "group") {
      return {
        title: context || "Group chat",
        body: `${sender} sent a message.`,
      };
    }
    if (kind === "hub") {
      return {
        title: context || "Hub message",
        body: `${sender} sent a message.`,
      };
    }
    if (kind === "mention") {
      return {
        title: sender,
        body: context ? `Mentioned you in ${context}.` : "Mentioned you.",
      };
    }
    return { title: sender, body: "Sent you a private message." };
  }

  if (kind === "group") {
    return {
      title: context || "Group chat",
      body: `${sender}: ${text.slice(0, 140)}`,
    };
  }
  if (kind === "hub") {
    return {
      title: context || "Hub message",
      body: `${sender}: ${text.slice(0, 140)}`,
    };
  }
  if (kind === "mention") {
    return {
      title: sender,
      body: text
        ? text.slice(0, 140)
        : context
          ? `Mentioned you in ${context}.`
          : "Mentioned you.",
    };
  }
  return { title: sender, body: text.slice(0, 140) };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function NotificationProvider({ children }: PropsWithChildren) {
  const { user, token } = useSession();
  const { mutedRef } = useMutedUsers();
  const { lastEvent } = useRealtime();
  const { settings } = useNotificationSettings();
  const pathname = usePathname();
  const [permissionState, setPermissionState] =
    useState<NotificationPermissionState>("checking");
  const settingsRef = useRef(settings);
  const pathnameRef = useRef(pathname);
  const lastHandledRef = useRef("");
  const permissionPromptedRef = useRef(false);
  const lastSquadMatchRef = useRef("");

  useLayoutEffect(() => {
    settingsRef.current = settings;
    shouldPlayNotificationSounds = settings.sound;
  }, [settings]);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const ensureChannels = async () => {
    if (Platform.OS !== "android") return;

    // Do not pass sound: "default" here. Expo SDK 57's Android sound
    // resolver can interpret that value as a bundled custom sound filename.
    // A HIGH-importance channel without a custom sound uses Android's
    // normal notification behavior and the user can still customize it
    // from the system notification settings.
    await Notifications.setNotificationChannelAsync("messages-v2", {
      name: "Messages",
      description: "Direct messages, group chats and Hub message alerts",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 180, 120, 180],
      lightColor: "#7c5cff",
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });

    // Android notification-channel sound cannot be changed after creation,
    // so keep a separate silent channel for DeCave's Sound toggle.
    await Notifications.setNotificationChannelAsync("messages-silent-v2", {
      name: "Messages (silent)",
      description: "Silent DeCave message alerts",
      importance: Notifications.AndroidImportance.HIGH,
      sound: null,
      vibrationPattern: [0, 180, 120, 180],
      lightColor: "#7c5cff",
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
  };

  const refreshPermission = async (): Promise<boolean> => {
    try {
      await ensureChannels();
      const current = await Notifications.getPermissionsAsync();
      const granted = current.granted === true;
      setPermissionState(granted ? "granted" : "denied");
      return granted;
    } catch {
      setPermissionState("denied");
      return false;
    }
  };

  const requestPermission = async (): Promise<boolean> => {
    try {
      await ensureChannels();
      const current = await Notifications.getPermissionsAsync();
      if (current.granted) {
        setPermissionState("granted");
        return true;
      }
      const result = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
        },
      });
      const granted = result.granted === true;
      setPermissionState(granted ? "granted" : "denied");
      return granted;
    } catch {
      setPermissionState("denied");
      return false;
    }
  };

  useEffect(() => {
    void refreshPermission();
  }, []);

  useEffect(() => {
    if (!user || !settings.enabled || permissionPromptedRef.current) return;
    permissionPromptedRef.current = true;
    void (async () => {
      // Ask only once iOS hasn't decided yet, and explain first so the answer is informed.
      const current = await Notifications.getPermissionsAsync().catch(() => null);
      if (current?.granted) {
        setPermissionState("granted");
        return;
      }
      if (current && current.status !== "undetermined") return;
      const go = await primePermission(
        "Stay in the loop",
        "Get notified about DMs, mentions, friend requests and when a squad is ready for you. You can fine-tune this in Settings.",
        "Turn on",
      );
      if (go) await requestPermission();
    })();
  }, [user?.id, settings.enabled]);

  // The master Notifications switch is per phone: off unlinks this device from
  // push (other devices keep theirs); on links it again.
  useEffect(() => {
    if (!token) return;
    if (!settings.enabled) { void unregisterPush(token); return; }
    if (permissionState !== "granted") return;
    void registerForPush(token);
  }, [token, permissionState, settings.enabled]);

  // A push tapped while the app was closed: open its route once signed in.
  useEffect(() => {
    if (!user) return;
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      const route = response?.notification.request.content.data?.route;
      if (typeof route === "string" && route.startsWith("/")) {
        void Notifications.clearLastNotificationResponseAsync?.();
        router.push(route as never);
      }
    });
  }, [user?.id]);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const route = response.notification.request.content.data?.route;
        if (typeof route === "string" && route.startsWith("/")) {
          router.push(route as never);
        }
      },
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!user || !token || !settings.enabled) return;
    let stopped=false;
    const check=async()=>{
      try {
        const data=await apiJson<{current?:unknown;matches?:Array<{id:string;groupId?:string|null;game:string;memberCount:number}>}>("/api/squad-finder",{},token);
        if(stopped)return;
        searching=!!data.current;
        const match=data.matches?.[0];
        const key=match?(match.groupId||match.id):"";
        if(!match){lastSquadMatchRef.current="";return;}
        if(key===lastSquadMatchRef.current)return;
        lastSquadMatchRef.current=key;
        if(permissionState!=="granted"||pathnameRef.current==="/squad-finder")return;
        await Notifications.scheduleNotificationAsync({content:{title:"Squad available",body:`${match.memberCount}/4 players are ready for ${match.game}.`,sound:Platform.OS==="ios"&&settingsRef.current.sound?"default":undefined,data:{route:"/squad-finder"}},trigger:Platform.OS==="android"?{channelId:settingsRef.current.sound?"messages-v2":"messages-silent-v2"}:null});
      }catch{}
    };
    // Poll fast only while a search is running; otherwise just notice new searches (e.g. from desktop).
    let searching=false;
    let timer:ReturnType<typeof setTimeout>|null=null;
    let run=0;
    const loop=async()=>{const mine=++run;await check();if(!stopped&&mine===run)timer=setTimeout(()=>void loop(),searching?8000:60000);};
    void loop();
    const unsubscribe=onSquadSearchChanged(()=>{if(timer)clearTimeout(timer);timer=null;void loop();});
    return()=>{stopped=true;unsubscribe();if(timer)clearTimeout(timer);};
  },[user?.id,token,settings.enabled,permissionState]);

  useEffect(() => {
    if (!lastEvent || !user || !settingsRef.current.enabled) return;
    if (permissionState !== "granted") return;

    const type = stringValue(lastEvent.type);
    if (!type) return;

    const message =
      lastEvent.message && typeof lastEvent.message === "object"
        ? (lastEvent.message as Record<string, unknown>)
        : null;
    const eventId =
      stringValue(message?.id) ||
      stringValue(lastEvent.messageId) ||
      stringValue(lastEvent.id) ||
      `${type}:${stringValue(lastEvent.groupId)}:${stringValue(lastEvent.channelId)}:${stringValue(lastEvent.userId)}:${stringValue(lastEvent.timestamp)}`;
    if (eventId && lastHandledRef.current === eventId) return;
    if (eventId) lastHandledRef.current = eventId;

    const notify = async (
      title: string,
      body: string,
      route: string,
    ) => {
      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title,
            body,
            // Android 8+ gets sound from the notification channel. Keep
            // "default" only on iOS, where it is a system-sound sentinel.
            sound:
              Platform.OS === "ios"
                ? settingsRef.current.sound
                  ? "default"
                  : false
                : undefined,
            data: { route },
          },
          trigger:
            Platform.OS === "android"
              ? {
                  channelId: settingsRef.current.sound
                    ? "messages-v2"
                    : "messages-silent-v2",
                }
              : null,
        });
      } catch {}
    };

    if (type === "DM_MESSAGE" && message) {
      const fromUserId = stringValue(message.fromUserId);
      if (!fromUserId || fromUserId === user.id || !settingsRef.current.dms || mutedRef.current.has(fromUserId)) return;
      const route = `/dm/${encodeURIComponent(fromUserId)}`;
      if (pathnameRef.current === route) return;
      const sender =
        lastEvent.sender && typeof lastEvent.sender === "object"
          ? (lastEvent.sender as Record<string, unknown>)
          : null;
      const senderName = stringValue(sender?.username) || "DeCave user";
      const preview = privacyText(
        settingsRef.current.notificationPreview,
        senderName,
        stringValue(message.text),
        "dm",
      );
      void notify(preview.title, preview.body, route);
      return;
    }

    if (type === "GROUP_MESSAGE" && message) {
      const fromUserId = stringValue(message.fromUserId);
      const groupId = stringValue(lastEvent.groupId) || stringValue(message.groupId);
      if (
        !groupId ||
        !fromUserId ||
        fromUserId === user.id ||
        mutedRef.current.has(fromUserId) ||
        !settingsRef.current.groups
      ) {
        return;
      }
      const route = `/group/${encodeURIComponent(groupId)}`;
      if (pathnameRef.current === route) return;
      const senderName = stringValue(message.username) || "DeCave user";
      const preview = privacyText(
        settingsRef.current.notificationPreview,
        senderName,
        stringValue(message.text),
        "group",
        "Group chat",
      );
      void notify(preview.title, preview.body, route);
      return;
    }

    if (type === "ROOM_ACTIVITY") {
      const fromUserId = stringValue(lastEvent.userId);
      const channelId = Number(lastEvent.channelId);
      if (!channelId || !fromUserId || fromUserId === user.id || mutedRef.current.has(fromUserId)) return;

      const route = `/channel/${channelId}`;
      if (pathnameRef.current === route) return;

      const mentioned = lastEvent.mentioned === true;
      const senderName = stringValue(lastEvent.username) || "DeCave user";
      const channelName = stringValue(lastEvent.channelName) || "Hub room";
      const text = stringValue(lastEvent.text);

      if (mentioned) {
        if (!settingsRef.current.mentions) return;
        const preview = privacyText(
          settingsRef.current.notificationPreview,
          senderName,
          text,
          "mention",
          `#${channelName}`,
        );
        void notify(preview.title, preview.body, route);
        return;
      }

      if (!settingsRef.current.hubMessages) return;
      const preview = privacyText(
        settingsRef.current.notificationPreview,
        senderName,
        text,
        "hub",
        `#${channelName}`,
      );
      void notify(preview.title, preview.body, route);
    }
  }, [lastEvent, permissionState, user?.id]);

  const value = useMemo<NotificationContextValue>(
    () => ({ permissionState, requestPermission }),
    [permissionState],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications(): NotificationContextValue {
  const value = useContext(NotificationContext);
  if (!value) {
    throw new Error("useNotifications must be used inside NotificationProvider");
  }
  return value;
}
