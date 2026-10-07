import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { colors } from "@/src/theme";

/**
 * Pulsing placeholder rows shown until a screen's first load finishes, so the
 * layout appears immediately instead of a spinner or a misleading empty state.
 */
export function SkeletonRows({ rows = 6, variant = "list" }: { rows?: number; variant?: "list" | "chat" }) {
  const pulse = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.45, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View style={{ opacity: pulse }} accessibilityLabel="Loading" accessibilityRole="progressbar">
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={[styles.row, variant === "chat" && styles.chatRow]}>
          <View style={[styles.avatar, variant === "chat" && styles.chatAvatar]} />
          <View style={styles.lines}>
            <View style={[styles.line, { width: variant === "chat" ? "30%" : "45%" }]} />
            <View style={[styles.line, styles.lineSoft, { width: `${55 + ((index * 17) % 35)}%` }]} />
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, paddingHorizontal: 4 },
  chatRow: { alignItems: "flex-start", paddingVertical: 9 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.panel2 },
  chatAvatar: { width: 34, height: 34, borderRadius: 17 },
  lines: { flex: 1, gap: 8 },
  line: { height: 12, borderRadius: 6, backgroundColor: colors.panel2 },
  lineSoft: { opacity: 0.6 },
});
