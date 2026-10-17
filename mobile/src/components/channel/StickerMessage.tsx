import { Image, StyleSheet, Text, View } from "react-native";
import { assetUrl } from "@/src/components/hub/hubShared";
import type { HubAsset } from "@/src/lib/hub-assets";
import { colors } from "@/src/theme";

/** A Hub sticker sent in chat: the image with its name underneath, like web. */
export function StickerMessage({ sticker }: { sticker: HubAsset }) {
  const uri = assetUrl(sticker.url);
  return (
    <View style={styles.wrap}>
      {uri ? (
        <Image source={{ uri }} style={styles.image} resizeMode="contain" accessibilityLabel={sticker.name} />
      ) : null}
      {!!sticker.name && <Text style={styles.name}>{sticker.name}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: "flex-start", marginTop: 4 },
  image: { width: 132, height: 132 },
  name: { color: colors.faint, fontSize: 11, fontWeight: "700", marginTop: 2 },
});
