import { useEffect, useRef, useState, type PropsWithChildren } from "react";
import { Keyboard, LayoutAnimation, Platform, View, type KeyboardEvent, type StyleProp, type ViewStyle } from "react-native";

/**
 * Keeps the bottom of its content (the composer) above the keyboard.
 *
 * Measures where this view actually ends on screen and pads by exactly the
 * part the keyboard covers, so it works under safe areas, tab bars and the
 * iPad split pane, where KeyboardAvoidingView's offsets came out wrong.
 */
export function KeyboardAware({ style, children }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const ref = useRef<View>(null);
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const animate = (event?: KeyboardEvent) => {
      if (Platform.OS !== "ios") return;
      LayoutAnimation.configureNext({
        duration: event?.duration || 250,
        update: { type: LayoutAnimation.Types.keyboard },
      });
    };

    const onShow = (event: KeyboardEvent) => {
      const keyboardTop = event.endCoordinates.screenY;
      ref.current?.measureInWindow((_x, y, _width, height) => {
        // Measure without our own padding, which is part of the measured height.
        setInset((current) => {
          const bottom = y + height - current;
          const next = Math.max(0, Math.round(bottom - keyboardTop));
          if (next !== current) animate(event);
          return next;
        });
      });
    };
    const onHide = (event: KeyboardEvent) => {
      animate(event);
      setInset(0);
    };

    const subs = [Keyboard.addListener(showEvent, onShow), Keyboard.addListener(hideEvent, onHide)];
    return () => subs.forEach((sub) => sub.remove());
  }, []);

  return (
    <View ref={ref} style={[{ flex: 1 }, style, { paddingBottom: inset }]}>
      {children}
    </View>
  );
}
