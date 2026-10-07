import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Image, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { API_BASE, apiJson } from "@/src/lib/api";
import type { GiphyGif } from "@/src/lib/chat-media";
import { colors } from "@/src/theme";

/**
 * The composer's "+" sheet: photo library, camera, and a GIF search grid.
 */
export function ComposerMediaSheet({
  visible,
  token,
  onClose,
  onPickLibrary,
  onPickCamera,
  onGif,
}: {
  visible: boolean;
  token: string | null;
  onClose: () => void;
  onPickLibrary?: () => void;
  onPickCamera?: () => void;
  onGif: (gif: GiphyGif) => void;
}) {
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
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load GIFs.");
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
          {onPickLibrary && onPickCamera && <View style={styles.actions}>
            <Pressable accessibilityRole="button" style={({ pressed }) => [styles.action, pressed && styles.pressed]} onPress={onPickLibrary}>
              <Ionicons name="images-outline" size={22} color={colors.cyan} />
              <Text style={styles.actionText}>Photos</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={({ pressed }) => [styles.action, pressed && styles.pressed]} onPress={onPickCamera}>
              <Ionicons name="camera-outline" size={22} color={colors.cyan} />
              <Text style={styles.actionText}>Camera</Text>
            </Pressable>
          </View>}

          <View style={styles.search}>
            <Text maxFontSizeMultiplier={1.3} style={styles.gifTag}>GIF</Text>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search GIPHY"
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
              <Pressable accessibilityRole="button" accessibilityLabel={item.title || "GIF"} style={styles.gif} onPress={() => onGif(item)}>
                <Image source={{ uri: item.previewUrl.startsWith("/") ? `${API_BASE}${item.previewUrl}` : item.previewUrl, headers: token ? { Authorization: `Bearer ${token}` } : undefined }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              </Pressable>
            )}
          />
          <Text style={styles.powered}>Powered by GIPHY</Text>
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
