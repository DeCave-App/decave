import { useEffect, useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { fetch as expoFetch } from "expo/fetch";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { API_BASE } from "@/src/lib/api";
import { loadAuthenticatedAttachmentImage } from "@/src/lib/legacy-attachment-download";
import { colors } from "@/src/theme";

type LoadedImage = { url: string; token: string; uri: string };

/**
 * Inline image (GIF or image attachment) that opens a full-screen,
 * pinch-to-zoom viewer. `onSave` hands off to the share sheet.
 */
export function MessageImage({
  url,
  token,
  title,
  authenticated,
  onSave,
}: {
  url: string;
  token: string | null;
  title?: string;
  authenticated: boolean;
  onSave?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [ratio, setRatio] = useState(4 / 3);
  const [loadedImage, setLoadedImage] = useState<LoadedImage | null>(null);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!authenticated || !token) {
      setLoadedImage(null);
      return;
    }
    if (isGiphyProxyUrl(url)) {
      setLoadedImage(null);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setLoadedImage(null);
    void loadAuthenticatedAttachmentImage({
      url,
      token,
      baseUrl: API_BASE,
      apiFetch: async (path, init, sessionToken) => {
        const headers = new Headers(init?.headers);
        if (sessionToken) headers.set("Authorization", `Bearer ${sessionToken}`);
        return expoFetch(`${API_BASE}${path}`, { ...init, headers });
      },
      signal: controller.signal,
    })
      .then((uri) => {
        if (active) setLoadedImage({ url, token, uri });
      })
      .catch(() => {
        if (active) setLoadedImage(null);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [authenticated, token, url]);

  const authenticatedUri =
    authenticated && token && loadedImage?.url === url && loadedImage.token === token ? loadedImage.uri : null;
  const isGiphyProxy = isGiphyProxyUrl(url);
  const source = isGiphyProxy && token
    ? { uri: url.startsWith("/") ? `${API_BASE}${url}` : url, headers: { Authorization: `Bearer ${token}` } }
    : { uri: authenticated ? authenticatedUri ?? "" : url };

  return (
    <>
      <Pressable accessibilityRole="imagebutton" accessibilityLabel={title || "Image"} onPress={() => setOpen(true)}>
        <Image
          source={source}
          onLoad={(event) => {
            const { width: w, height: h } = event.nativeEvent.source;
            if (w && h) setRatio(Math.max(0.5, Math.min(2, w / h)));
          }}
          style={[styles.inline, { aspectRatio: ratio }]}
          resizeMode="cover"
        />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.viewer}>
          <ScrollView keyboardDismissMode="on-drag"
            maximumZoomScale={4}
            minimumZoomScale={1}
            centerContent
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ width, height, alignItems: "center", justifyContent: "center" }}
          >
            <Image source={source} style={{ width, height: height * 0.8 }} resizeMode="contain" />
          </ScrollView>
          <View style={[styles.bar, { top: insets.top + 8 }]}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} style={styles.barButton} onPress={() => setOpen(false)}>
              <Ionicons name="close" size={22} color="#FFFFFF" />
            </Pressable>
            {!!title && <Text style={styles.barTitle} numberOfLines={1}>{title}</Text>}
            {onSave && (
              <Pressable accessibilityRole="button" accessibilityLabel="Save or share" hitSlop={10} style={styles.barButton} onPress={onSave}>
                <Ionicons name="share-outline" size={21} color="#FFFFFF" />
              </Pressable>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

function isGiphyProxyUrl(value: string): boolean {
  try {
    const parsed = new URL(value, `${API_BASE}/`);
    return parsed.origin === API_BASE && parsed.pathname === "/api/giphy/media";
  } catch {
    return false;
  }
}

const styles = StyleSheet.create({
  inline: { width: 230, maxWidth: "100%", marginTop: 6, borderRadius: 14, backgroundColor: colors.panel2 },
  viewer: { flex: 1, backgroundColor: "rgba(0,0,0,0.96)" },
  bar: { position: "absolute", left: 12, right: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  barButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)" },
  barTitle: { flex: 1, color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
});
