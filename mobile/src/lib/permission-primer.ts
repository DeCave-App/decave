import { Alert } from "react-native";

/**
 * Explains why DeCave wants a permission before iOS shows its one-time
 * system prompt. Resolves true if the user wants to continue to that prompt.
 */
export function primePermission(title: string, message: string, allowLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: "Not now", style: "cancel", onPress: () => resolve(false) },
        { text: allowLabel, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
