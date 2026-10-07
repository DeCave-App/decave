import { Linking, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/src/theme";

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** First http(s) link in `text`, if any. */
export function firstLink(text: string): string | undefined {
  return text.match(URL_PATTERN)?.[0];
}

export function openLink(url: string): void {
  void Linking.openURL(url).catch(() => undefined);
}

/** Small "domain" chip under a message that contains a link. */
export function LinkChip({ url }: { url: string }) {
  return (
    <View style={styles.chip}>
      <Ionicons name="link" size={12} color={colors.muted} />
      <Text style={styles.chipText} numberOfLines={1} accessibilityRole="link" onPress={() => openLink(url)}>
        {hostOf(url)}
      </Text>
    </View>
  );
}

export const linkStyle = { color: colors.cyan, textDecorationLine: "underline" } as const;

/** Message text with tappable http(s) links, plus a small domain chip for the first link. */
export function LinkifiedText({ text, style, showChip = true }: { text: string; style?: StyleProp<TextStyle>; showChip?: boolean }) {
  const parts: Array<{ text: string; url?: string }> = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ text: text.slice(last, index) });
    parts.push({ text: match[0], url: match[0] });
    last = index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  const firstUrl = parts.find((part) => part.url)?.url;

  return (
    <>
      <Text style={style}>
        {parts.map((part, index) =>
          part.url ? (
            <Text
              key={index}
              style={styles.link}
              accessibilityRole="link"
              onPress={() => void Linking.openURL(part.url!).catch(() => undefined)}
            >
              {part.text}
            </Text>
          ) : (
            part.text
          ),
        )}
      </Text>
      {showChip && firstUrl ? <LinkChip url={firstUrl} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  link: { color: colors.cyan, textDecorationLine: "underline" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 4,
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: colors.panel2,
  },
  chipText: { color: colors.muted, fontSize: 12, fontWeight: "700" },
});
