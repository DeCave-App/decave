import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { SyncedClientSettings } from "@/src/lib/account-preferences";
import { liveMutedHubs, mutedRoomIds, withHubMuted, withRoomLevel } from "@/src/lib/hub-mutes";
import { dateLocale } from "@/src/lib/date-locale";
import { hour12Preference } from "@/src/lib/account-preferences-store";
import type { Hub } from "@/src/types";
import { SectionHeading, SettingsCard } from "./SettingsParts";
import { colors } from "@/src/theme";

/** Settings → Notifications: every muted Hub and room with Unmute, like web's MutedPlacesList. */
export function MutedPlacesCard({
  hubs,
  settings,
  onPatch,
}: {
  hubs: readonly Hub[] | null;
  settings: SyncedClientSettings | null;
  onPatch: (patch: SyncedClientSettings) => void;
}) {
  const { t } = useTranslation(["settings"]);
  const muted = liveMutedHubs(settings);
  const mutedHubs = (hubs ?? []).filter((hub) => String(hub.id) in muted);
  const roomIds = new Set(mutedRoomIds(settings));
  const mutedRooms = (hubs ?? []).flatMap((hub) =>
    (hub.channels ?? []).filter((room) => room.type !== "voice" && roomIds.has(room.id)).map((room) => ({ hub, room })),
  );
  const count = mutedHubs.length + mutedRooms.length;

  return (
    <>
      <SectionHeading icon="notifications-off-outline" title={count ? t("settings.notifications.mutedCount", { count }) : t("settings.notifications.mutedTitle")} />
      <SettingsCard>
        <Text style={styles.help}>{t("settings.notifications.mutedHelp")}</Text>
        {count === 0 && <Text style={[styles.help, { marginTop: 10 }]}>{t("settings.mobile.muted.noneMuted")}</Text>}
        {mutedHubs.map((hub) => {
          const until = muted[String(hub.id)];
          return (
            <Row
              key={`hub:${hub.id}`}
              icon="grid-outline"
              title={hub.name}
              detail={
                until === -1
                  ? t("settings.notifications.mutedForever")
                  : t("settings.notifications.mutedUntil", {
                      when: new Date(until).toLocaleString(dateLocale(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: hour12Preference() }),
                    })
              }
              action={t("settings.notifications.unmute")}
              onPress={() => onPatch(withHubMuted(settings, hub.id, false))}
            />
          );
        })}
        {mutedRooms.map(({ hub, room }) => (
          <Row
            key={`room:${room.id}`}
            icon="chatbubble-ellipses-outline"
            title={`#${room.name}`}
            detail={t("settings.notifications.roomIn", { hub: hub.name })}
            action={t("settings.notifications.unmute")}
            onPress={() => onPatch(withRoomLevel(settings, room.id, null))}
          />
        ))}
      </SettingsCard>
    </>
  );
}

function Row({ icon, title, detail, action, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; detail: string; action: string; onPress: () => void }) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={18} color={colors.muted} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <Text style={styles.detail} numberOfLines={1}>{detail}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`${action}: ${title}`} style={styles.button} onPress={onPress}>
        <Text style={styles.buttonText}>{action}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  help: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 8 },
  title: { color: colors.text, fontSize: 14, fontWeight: "800" },
  detail: { color: colors.faint, fontSize: 12, marginTop: 2 },
  button: { paddingHorizontal: 12, height: 32, borderRadius: 10, justifyContent: "center", backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  buttonText: { color: colors.cyan, fontSize: 13, fontWeight: "800" },
});
