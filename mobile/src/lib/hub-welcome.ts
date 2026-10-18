import * as SecureStore from "expo-secure-store";

// The first-run welcome (app/welcome.tsx) shows once per account on this phone.

function storageKey(userId: string): string {
  // SecureStore keys allow only letters, digits, ".", "-" and "_".
  const encodedId = Array.from(userId, (character) => character.codePointAt(0)!.toString(16)).join(".");
  return `decave.hubWelcomeSeen.v1.${encodedId}`;
}

export async function hubWelcomeSeen(userId: string): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(storageKey(userId))) === "1";
  } catch {
    // Unreadable storage: don't risk showing it on every launch.
    return true;
  }
}

export async function markHubWelcomeSeen(userId: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(storageKey(userId), "1");
  } catch {}
}
