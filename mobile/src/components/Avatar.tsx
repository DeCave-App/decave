import { Image, StyleSheet, Text, View } from "react-native";
import { absoluteMediaUrl } from "@/src/lib/api";
import { colors } from "@/src/theme";

export function Avatar({
  username,
  avatarUrl,
  size = 44,
  online,
}: {
  username: string;
  avatarUrl?: string | null;
  size?: number;
  online?: boolean;
}) {
  const uri = absoluteMediaUrl(avatarUrl);
  return (
    <View style={{ width: size, height: size }}>
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
        />
      ) : (
        <View
          style={[
            styles.fallback,
            { width: size, height: size, borderRadius: size / 2 },
          ]}
        >
          <Text style={[styles.initial, { fontSize: Math.max(13, size * 0.36) }]}>
            {username.slice(0, 1).toUpperCase()}
          </Text>
        </View>
      )}
      {online !== undefined && (
        <View
          style={[
            styles.dot,
            {
              backgroundColor: online ? colors.green : "#657086",
              width: Math.max(10, size * 0.24),
              height: Math.max(10, size * 0.24),
              borderRadius: size,
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.violetSoft,
    borderWidth: 1,
    borderColor: "rgba(124,92,255,.4)",
  },
  initial: { color: colors.lilac, fontWeight: "800" },
  dot: {
    position: "absolute",
    right: -1,
    bottom: -1,
    borderWidth: 2,
    borderColor: colors.bg,
  },
});
