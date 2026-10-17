// The optional forum post extensions (type badge, poll, LFG, media), like
// web's src/features/forum/ForumPostExtras.tsx.

import { t as translate } from "i18next";
import { useTranslation } from "react-i18next";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ForumLfg, ForumMedia, ForumPoll } from "../../../../shared/forum";
import { FORUM_TYPE_ICONS, forumPollTallies, type ForumPostType } from "@/src/lib/forum-api";
import { MessageImage } from "@/src/components/MessageMedia";
import { absoluteMediaUrl } from "@/src/lib/api";
import { dateLocale } from "@/src/lib/date-locale";
import { hour12Preference } from "@/src/lib/account-preferences-store";
import { tapHaptic } from "@/src/lib/haptics";
import { colors } from "@/src/theme";

export function TypeBadge({ type }: { type: ForumPostType }) {
  const { t } = useTranslation(["forum"]);
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeIcon}>{FORUM_TYPE_ICONS[type]}</Text>
      <Text maxFontSizeMultiplier={1.3} style={styles.badgeText}>{t(`forum.type.${type}.label`)}</Text>
    </View>
  );
}

function remaining(endsAt: number, now: number) {
  const minutes = Math.round((endsAt - now) / 60000);
  if (minutes < 60) return translate("forum.poll.minutesLeft", { count: Math.max(1, minutes) });
  const hours = Math.round(minutes / 60);
  return hours < 48 ? translate("forum.poll.hoursLeft", { count: hours }) : translate("forum.poll.daysLeft", { count: Math.round(hours / 24) });
}

export function ForumPollBlock({
  poll,
  reactions,
  viewerId,
  onVote,
  compact,
}: {
  poll: ForumPoll;
  reactions?: Record<string, string[]>;
  viewerId: string;
  /** Omit for a read-only preview. */
  onVote?: (optionIndex: number) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation(["forum"]);
  const now = Date.now();
  const closed = poll.endsAt !== null && poll.endsAt <= now;
  const tally = forumPollTallies(reactions, poll.options.length, viewerId);
  const showResults = closed || tally.mine.some(Boolean) || !onVote;
  const options = compact ? poll.options.slice(0, 3) : poll.options;
  const canVote = !!onVote && !closed && !compact;

  return (
    <View style={styles.poll}>
      <View style={styles.pollMeta}>
        <Text style={styles.meta}>{poll.multi ? t("forum.poll.chooseAny") : t("forum.poll.chooseOne")}</Text>
        <Text style={styles.meta}>{t("forum.poll.voters", { count: tally.voters })}</Text>
        {poll.endsAt !== null && (
          <Text style={[styles.meta, closed && { color: colors.red }]}>
            {closed ? t("forum.poll.closed") : remaining(poll.endsAt, now)}
          </Text>
        )}
      </View>
      {options.map((option, index) => {
        const percent = tally.total ? Math.round(((tally.counts[index] ?? 0) / tally.total) * 100) : 0;
        const mine = tally.mine[index];
        return (
          <Pressable
            key={index}
            disabled={!canVote}
            accessibilityRole={canVote ? "button" : undefined}
            accessibilityState={{ selected: mine }}
            style={[styles.option, mine && styles.optionMine]}
            onPress={() => {
              tapHaptic();
              onVote?.(index);
            }}
          >
            <View style={[styles.bar, { width: showResults ? `${percent}%` : "0%" }]} />
            <Ionicons
              name={mine ? "checkmark-circle" : poll.multi ? "square-outline" : "ellipse-outline"}
              size={16}
              color={mine ? colors.cyan : colors.muted}
            />
            <Text style={styles.optionText} numberOfLines={2}>{option}</Text>
            {showResults && <Text style={styles.meta}>{tally.counts[index]} · {percent}%</Text>}
          </Pressable>
        );
      })}
      {compact && poll.options.length > options.length && (
        <Text style={styles.meta}>{t("forum.poll.more", { count: poll.options.length - options.length })}</Text>
      )}
    </View>
  );
}

function formatWhen(time: number): string {
  return new Date(time).toLocaleString(dateLocale(), {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: hour12Preference(),
  });
}

export function ForumLfgBlock({ lfg }: { lfg: ForumLfg }) {
  const { t } = useTranslation(["forum"]);
  const rows: [string, string][] = [
    [t("forum.lfg.game"), lfg.game],
    ...(lfg.platform ? ([[t("forum.lfg.platform"), lfg.platform]] as [string, string][]) : []),
    [t("forum.lfg.need"), t("forum.lfg.players", { count: lfg.slots })],
    ...(lfg.startAt ? ([[t("forum.lfg.starts"), formatWhen(lfg.startAt)]] as [string, string][]) : []),
  ];
  return (
    <View style={styles.lfg}>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.lfgRow}>
          <Text style={styles.lfgLabel}>{label}</Text>
          <Text style={styles.lfgValue} numberOfLines={1}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

const isImageUrl = (media: ForumMedia) =>
  (media.mime ?? "").startsWith("image/") || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(media.url);

export function ForumMediaBlock({ media, token }: { media: ForumMedia; token: string | null }) {
  const { t } = useTranslation(["forum"]);
  const uploaded = media.url.startsWith("/");
  const url = uploaded ? absoluteMediaUrl(media.url) : media.url;
  if (!url) return null;
  if (isImageUrl(media)) return <MessageImage url={media.url} title={t("forum.media.alt")} token={token} authenticated={uploaded} />;
  return (
    <Pressable accessibilityRole="link" style={styles.mediaLink} onPress={() => void Linking.openURL(url)}>
      <Ionicons name={(media.mime ?? "").startsWith("video/") || !uploaded ? "play-circle-outline" : "document-outline"} size={20} color={colors.cyan} />
      <Text style={styles.mediaText} numberOfLines={1}>{uploaded ? t("forum.media.file") : media.url}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  badgeIcon: { fontSize: 11 },
  badgeText: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  poll: { gap: 6, marginTop: 8 },
  pollMeta: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  meta: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  option: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel2 },
  optionMine: { borderColor: colors.cyan },
  bar: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: colors.violetSoft },
  optionText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: "700" },
  lfg: { marginTop: 8, padding: 10, gap: 6, borderRadius: 12, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  lfgRow: { flexDirection: "row", gap: 10 },
  lfgLabel: { width: 72, color: colors.muted, fontSize: 12, fontWeight: "800" },
  lfgValue: { flex: 1, color: colors.text, fontSize: 13, fontWeight: "700" },
  mediaLink: { marginTop: 8, flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 12, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  mediaText: { flex: 1, color: colors.cyan, fontSize: 13, fontWeight: "700" },
});
