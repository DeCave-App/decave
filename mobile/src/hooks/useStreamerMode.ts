import { useAccountPreferencesSnapshot } from "@/src/lib/account-preferences-store";
import { useVoice } from "@/src/providers/VoiceProvider";

/**
 * Streamer Mode hides personal account details (the email address) on screen.
 * On for the account (Privacy settings), and on by itself while this phone
 * shares its screen, like web's automatic mode while a capture app runs.
 */
export function useStreamerMode(): boolean {
  const prefs = useAccountPreferencesSnapshot();
  const { screenSharing } = useVoice();
  return prefs?.streamerMode === true || screenSharing;
}
