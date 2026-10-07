import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { createAudioPlayer } from "expo-audio";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { API_BASE, apiJson } from "@/src/lib/api";
import { useRealtime } from "@/src/providers/RealtimeProvider";
import { useSession } from "@/src/providers/SessionProvider";
import { useVoice } from "@/src/providers/VoiceProvider";
import { colors } from "@/src/theme";

type SoundboardSound = { id: string; name: string; uploaderUserId: string; url: string };

/**
 * Plays soundboard sounds that others trigger in the voice room you are in.
 * Mounted once at the root, inside the voice provider; silent while deafened.
 */
export function SoundboardListener() {
  const { token } = useSession();
  const { subscribe } = useRealtime();
  const { voiceChannelId, deafened, serverDeafened } = useVoice();

  useEffect(() => {
    if (!token || voiceChannelId == null || deafened || serverDeafened) return;
    return subscribe((event) => {
      if (event.type !== "VOICE_SOUNDBOARD_PLAY") return;
      const url = typeof event.url === "string" ? event.url : "";
      if (!url) return;
      try {
        const player = createAudioPlayer({
          uri: url.startsWith("http") ? url : `${API_BASE}${url}`,
          headers: { Authorization: `Bearer ${token}` },
        });
        player.volume = 0.82;
        const sub = player.addListener("playbackStatusUpdate", (status) => {
          if (status.didJustFinish) {
            sub.remove();
            player.remove();
          }
        });
        player.play();
      } catch (error) {
        console.warn("[soundboard] could not play sound", error);
      }
    });
  }, [subscribe, token, voiceChannelId, deafened, serverDeafened]);

  return null;
}

/** Bottom sheet listing the Hub's sounds; tapping one plays it for the room. */
export function SoundboardSheet({ visible, hubId, onClose }: { visible: boolean; hubId: number; onClose: () => void }) {
  const { token } = useSession();
  const { send } = useRealtime();
  const [sounds, setSounds] = useState<SoundboardSound[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const upload = async () => {
    if (!token) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: "audio/*", copyToCacheDirectory: true });
      if (picked.canceled || !picked.assets?.[0]) return;
      const file = picked.assets[0];
      if (file.size && file.size > 1536 * 1024) throw new Error("Sounds must be 1.5 MB or smaller.");
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const mime =
        ext === "mp3" ? "audio/mpeg" : ext === "wav" ? "audio/wav" : ext === "ogg" ? "audio/ogg" : ext === "m4a" || ext === "mp4" ? "audio/mp4" : ext === "webm" ? "audio/webm" : "";
      if (!mime) throw new Error("Choose an MP3, WAV, OGG, M4A or WebM file.");
      setUploading(true);
      const base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
      const name = file.name.replace(/\.[^.]+$/, "").slice(0, 32) || "Sound";
      await apiJson("/api/soundboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hubId, name, dataUrl: `data:${mime};base64,${base64}` }),
      }, token);
      setNotice(`Added ${name}.`);
      setReloadKey((value) => value + 1);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn't upload that sound.");
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    if (!visible || !token || !hubId) return;
    let cancelled = false;
    setLoading(true);
    setNotice("");
    apiJson<{ sounds: SoundboardSound[] }>(`/api/soundboard?hubId=${hubId}`, {}, token)
      .then((data) => {
        if (!cancelled) setSounds(data.sounds);
      })
      .catch((error) => {
        if (!cancelled) setNotice(error instanceof Error ? error.message : "Could not load sounds.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, token, hubId, reloadKey]);

  const play = (sound: SoundboardSound) => {
    if (send({ type: "VOICE_SOUNDBOARD_PLAY", soundId: sound.id })) setNotice(`Played ${sound.name}.`);
    else setNotice("Realtime is reconnecting. Try again in a moment.");
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />
          <View style={styles.head}>
            <Ionicons name="musical-notes" size={18} color={colors.cyan} />
            <Text style={styles.title}>Soundboard</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Add a sound" hitSlop={8} disabled={uploading} onPress={() => void upload()} style={styles.add}>
              {uploading ? <ActivityIndicator size="small" color={colors.cyan} /> : <Ionicons name="add" size={18} color={colors.cyan} />}
              <Text style={styles.addText}>Add</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={onClose}>
              <Ionicons name="close" size={22} color={colors.muted} />
            </Pressable>
          </View>
          {!!notice && <Text style={styles.notice}>{notice}</Text>}
          {loading ? (
            <ActivityIndicator color={colors.cyan} style={{ marginVertical: 30 }} />
          ) : sounds.length === 0 ? (
            <Text style={styles.empty}>This Hub has no sounds yet. Tap Add to upload an MP3, WAV or M4A up to 1.5 MB.</Text>
          ) : (
            <ScrollView keyboardDismissMode="on-drag" contentContainerStyle={styles.grid}>
              {sounds.map((sound) => (
                <Pressable
                  key={sound.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Play ${sound.name}`}
                  onPress={() => play(sound)}
                  style={({ pressed }) => [styles.sound, pressed && styles.soundPressed]}
                >
                  <Ionicons name="play" size={14} color={colors.cyan} />
                  <Text style={styles.soundName} numberOfLines={1}>
                    {sound.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(2,5,12,.72)" },
  sheet: {
    maxHeight: "70%",
    padding: 16,
    paddingBottom: 32,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  grabber: { alignSelf: "center", width: 42, height: 4, borderRadius: 99, backgroundColor: colors.border, marginBottom: 13 },
  head: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  title: { flex: 1, color: colors.text, fontSize: 16, fontWeight: "900" },
  add: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 10, height: 32, borderRadius: 10, backgroundColor: colors.cyanSoft, marginRight: 6 },
  addText: { color: colors.cyan, fontSize: 13, fontWeight: "900" },
  notice: { color: colors.muted, fontSize: 13, marginBottom: 10 },
  empty: { color: colors.muted, fontSize: 14, textAlign: "center", paddingVertical: 28, lineHeight: 20 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sound: {
    width: "48.5%",
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 13,
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  soundPressed: { backgroundColor: colors.cyanSoft, borderColor: "rgba(34,211,238,0.4)" },
  soundName: { flex: 1, color: colors.text, fontSize: 14, fontWeight: "700" },
});
