import * as Haptics from "expo-haptics";

// Fire-and-forget haptics; failures (simulator, older devices) are harmless.
export function tapHaptic() {
  void Haptics.selectionAsync().catch(() => undefined);
}

export function impactHaptic() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

export function successHaptic() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}

export function errorHaptic() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
}
