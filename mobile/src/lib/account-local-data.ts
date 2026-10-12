import * as SecureStore from "expo-secure-store";
import { forgetStoredDrafts } from "./drafts";
import { forgetLastVoiceRoom } from "./last-voice-room";
import { notificationSettingsStorageKey } from "./notification-settings-store";

// Per-account data this phone keeps: unsent drafts, the last voice room and the
// notification privacy settings. It is deleted when the person chooses to sign
// out, and when a different account signs in (the previous account's data is
// found through the owner marker below). A session that ended elsewhere keeps
// it, the same way the DM encryption key is kept (dmE2ee.stop({ forget })).
// The DM encryption seed is owned by the encryption session, not by this file.

const OWNER_KEY = "decave.localDataOwner.v1";

/** Deletes everything this phone stores for `accountId`. */
export async function forgetAccountLocalData(accountId: string): Promise<void> {
  await Promise.all([
    forgetStoredDrafts(accountId),
    forgetLastVoiceRoom(accountId),
    SecureStore.deleteItemAsync(notificationSettingsStorageKey(accountId)),
  ]);
}

/** The person chose to sign out of `accountId` on this phone. */
export async function forgetSignedOutAccount(accountId: string): Promise<void> {
  await forgetAccountLocalData(accountId).catch(() => undefined);
  const owner = await SecureStore.getItemAsync(OWNER_KEY).catch(() => null);
  if (owner === accountId) await SecureStore.deleteItemAsync(OWNER_KEY).catch(() => undefined);
}

/** An account signed in: remove a different account's data left on this phone, then record the owner. */
export async function claimAccountLocalData(accountId: string): Promise<void> {
  const owner = await SecureStore.getItemAsync(OWNER_KEY).catch(() => null);
  if (owner === accountId) return;
  if (owner) await forgetAccountLocalData(owner).catch(() => undefined);
  await SecureStore.setItemAsync(OWNER_KEY, accountId).catch(() => undefined);
}
