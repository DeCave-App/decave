import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { apiJson } from "@/src/lib/api";
import { giphyImageSource, type GiphyGif } from "@/src/lib/chat-media";
import type { HubAsset } from "@/src/lib/hub-assets";
import { assetUrl } from "@/src/components/hub/hubShared";
import { colors } from "@/src/theme";

/**
 * The composer's "+" sheet: photo library, camera, a poll, the Hub's custom
 * emotes and stickers (in Hub rooms), and a GIF search grid.
 */
export function ComposerMediaSheet({
  visible,
  token,
  onClose,
  onPickLibrary,
  onPickCamera,
  onGif,
  hubAssets = [],
  onHubAsset,
  onPoll,
}: {
  visible: boolean;
  token: string | null;
  onClose: () => void;
  onPickLibrary?: () => void;
  onPickCamera?: () => void;
  onGif: (gif: GiphyGif) => void;
  /** Hub emotes go into the message; stickers send at once. */
  hubAssets?: readonly HubAsset[];
  onHubAsset?: (asset: HubAsset) => void;
  /** Opens the poll composer. */
  onPoll?: () => void;
}) {
  const { t } = useTranslation(["chat"]);
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState<GiphyGif[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!visible || !token) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const q = query.trim();
        const data = await apiJson<{ gifs: GiphyGif[] }>(`/api/giphy${q ? `?q=${encodeURIComponent(q)}` : ""}`, {}, token);
        if (!cancelled) {
          setGifs(data.gifs);
          setError("");
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t("chat.mobile.media.gifLoadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [visible, token, query]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />
          {((onPickLibrary && onPickCamera) || onPoll) && <View style={styles.actions}>
            {onPickLibrary && onPickCamera && <>
              <Pressable accessibilityRole="button" style={({ pressed }) => [styles.action, pressed && styles.pressed]} onPress={onPickLibrary}>
                <Ionicons name="images-outline" size={22} color={colors.cyan} />
                <Text style={styles.actionText}>{t("chat.mobile.media.photos")}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" style={({ pressed }) => [styles.action, pressed && styles.pressed]} onPress={onPickCamera}>
                <Ionicons name="camera-outline" size={22} color={colors.cyan} />
                <Text style={styles.actionText}>{t("chat.mobile.media.camera")}</Text>
              </Pressable>
            </>}
            {onPoll && (
              <Pressable accessibilityRole="button" style={({ pressed }) => [styles.action, pressed && styles.pressed]} onPress={onPoll}>
                <Ionicons name="stats-chart-outline" size={22} color={colors.cyan} />
                <Text style={styles.actionText}>{t("chat.mobile.media.poll")}</Text>
              </Pressable>
            )}
          </View>}

          {onHubAsset && hubAssets.length > 0 && (
            <View style={styles.assets}>
              <Text maxFontSizeMultiplier={1.3} style={styles.assetsTitle}>{t("chat.actions.emoji.hubAssets")}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.assetsRow}>
                {hubAssets.map((asset) => {
                  const uri = assetUrl(asset.url);
                  return (
                    <Pressable
                      key={asset.id}
                      accessibilityRole="button"
                      accessibilityLabel={asset.kind === "emote" ? t("chat.actions.emoji.emoteTitle", { name: asset.name }) : t("chat.actions.emoji.stickerTitle", { name: asset.name })}
                      style={({ pressed }) => [styles.asset, asset.kind === "sticker" && styles.stickerAsset, pressed && styles.pressed]}
                      onPress={() => onHubAsset(asset)}
                    >
                      {uri ? <Image source={{ uri }} style={styles.assetImage} resizeMode="contain" /> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}

          <View style={styles.search}>
            <Text maxFontSizeMultiplier={1.3} style={styles.gifTag}>{t("chat.composer.gif")}</Text>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t("chat.mobile.media.searchGiphy")}
              placeholderTextColor={colors.faint}
              style={styles.searchInput}
              autoCorrect={false}
              returnKeyType="search"
            />
            {loading && <ActivityIndicator size="small" color={colors.cyan} />}
          </View>
          {!!error && <Text style={styles.error}>{error}</Text>}

          <FlatList
            data={gifs}
            keyExtractor={(item) => item.id}
            numColumns={3}
            keyboardShouldPersistTaps="handled"
            columnWrapperStyle={{ gap: 6 }}
            contentContainerStyle={{ gap: 6, paddingBottom: 8 }}
            style={{ flexGrow: 0, maxHeight: 320 }}
            renderItem={({ item }) => (
              <Pressable accessibilityRole="button" accessibilityLabel={item.title || t("chat.composer.gif")} style={styles.gif} onPress={() => onGif(item)}>
                {(() => {
                  const source = giphyImageSource(item.previewUrl, token) ?? giphyImageSource(item.url, token);
                  return source ? <Image source={source} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null;
                })()}
              </Pressable>
            )}
          />
          <Text style={styles.powered}>{t("chat.mobile.media.poweredByGiphy")}</Text>
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(2,5,12,.72)" },
  sheet: { padding: 16, paddingBottom: 30, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  grabber: { alignSelf: "center", width: 42, height: 4, borderRadius: 99, backgroundColor: colors.border, marginBottom: 14 },
  actions: { flexDirection: "row", gap: 10, marginBottom: 14 },
  assets: { marginBottom: 14 },
  assetsTitle: { color: colors.muted, fontSize: 12, fontWeight: "900", marginBottom: 8, textTransform: "uppercase" },
  assetsRow: { gap: 8, paddingRight: 8 },
  asset: { width: 48, height: 48, borderRadius: 12, overflow: "hidden", backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border, padding: 6 },
  stickerAsset: { width: 72, height: 72 },
  assetImage: { width: "100%", height: "100%" },
  action: { flex: 1, height: 64, borderRadius: 16, alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  actionText: { color: colors.text, fontSize: 13, fontWeight: "800" },
  pressed: { opacity: 0.7 },
  search: { height: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, marginBottom: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel2 },
  gifTag: { color: colors.bg, backgroundColor: colors.lilac, fontSize: 11, fontWeight: "900", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: "hidden" },
  searchInput: { flex: 1, color: colors.text, fontSize: 15 },
  error: { color: colors.red, fontSize: 13, marginBottom: 8 },
  gif: { flex: 1, aspectRatio: 1, borderRadius: 10, overflow: "hidden", backgroundColor: colors.panel2 },
  powered: { color: colors.faint, fontSize: 13, textAlign: "center", marginTop: 6 },
});
