import { useRef, type ReactNode } from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { colors } from "@/src/theme";

/** Swipe a message right to reply, like iMessage. */
/**
 * `maxWidth` caps the bubble relative to the message row. Put it here, not on
 * the bubble: a percentage on the bubble resolves against this shrink-to-fit
 * container and collapses short messages to a sliver ("He / llo").
 */
export function SwipeToReply({ onReply, children, maxWidth }: { onReply: () => void; children: ReactNode; maxWidth?: `${number}%` }) {
  const ref = useRef<SwipeableMethods>(null);
  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2}
      leftThreshold={56}
      overshootLeft={false}
      containerStyle={{ flexShrink: 1, maxWidth }}
      renderLeftActions={() => (
        <View style={{ width: 56, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="arrow-undo" size={20} color={colors.cyan} />
        </View>
      )}
      onSwipeableWillOpen={() => {
        onReply();
        ref.current?.close();
      }}
    >
      {children}
    </ReanimatedSwipeable>
  );
}
