import { useCallback, useEffect, useRef, type PropsWithChildren } from "react";
import { Keyboard, Platform, ScrollView, TextInput, type StyleProp, type ViewStyle } from "react-native";
import { KeyboardAware } from "@/src/components/KeyboardAware";

// Room left under the focused field so the button below it stays in view.
const BUTTON_ROOM = 180;

/**
 * Scrolling card for the signed-out screens (sign in, sign up, recovery, MFA).
 *
 * Shrinks above the keyboard and scrolls the focused field plus the button
 * under it into view. Android's edge-to-edge window no longer resizes for the
 * keyboard, and dragging can't dismiss it there, or the Sign in button could
 * only be reached by closing the keyboard first.
 */
export function AuthScroll({ contentContainerStyle, children }: PropsWithChildren<{ contentContainerStyle?: StyleProp<ViewStyle> }>) {
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const keyboardOpen = useRef(false);

  // Runs after every keyboard change and every resize of the scroll view, so
  // it sees the final layout even when the keyboard changes height between
  // fields (the email keyboard has no number row). KeyboardAware ends the
  // scroll view at the keyboard's top edge, so its bottom is the limit.
  const revealFocusedField = useCallback(() => {
    const input = TextInput.State.currentlyFocusedInput();
    const scroll = scrollRef.current?.getNativeScrollRef();
    if (!keyboardOpen.current || !input || !scroll) return;
    scroll.measureInWindow((_sx, scrollTop, _sw, scrollHeight) => {
      input.measureInWindow((_x, y, _width, height) => {
        const overflow = y + height + BUTTON_ROOM - (scrollTop + scrollHeight);
        if (overflow > 1) scrollRef.current?.scrollTo({ y: scrollY.current + overflow, animated: true });
      });
    });
  }, []);

  useEffect(() => {
    const subs = [
      Keyboard.addListener("keyboardDidShow", () => {
        keyboardOpen.current = true;
        requestAnimationFrame(revealFocusedField);
      }),
      Keyboard.addListener("keyboardDidHide", () => {
        keyboardOpen.current = false;
      }),
    ];
    return () => subs.forEach((sub) => sub.remove());
  }, [revealFocusedField]);

  return (
    <KeyboardAware>
      <ScrollView
        ref={scrollRef}
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "none"}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={contentContainerStyle}
        scrollEventThrottle={16}
        onScroll={(event) => {
          scrollY.current = event.nativeEvent.contentOffset.y;
        }}
        onLayout={() => requestAnimationFrame(revealFocusedField)}
      >
        {children}
      </ScrollView>
    </KeyboardAware>
  );
}
