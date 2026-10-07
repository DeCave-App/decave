import { Platform } from "react-native";
import { Directory, File, Paths } from "expo-file-system";

const INSTALL_MARKER = "decave-install.marker";

/**
 * iOS keeps Keychain items after the app is deleted, so a reinstall would come back signed in.
 * The app's Documents folder is wiped on uninstall, so an absent marker there means a fresh install.
 * An app update keeps Documents, so a non-empty folder without the marker is an upgrade, not a reinstall.
 */
export async function clearKeychainLeftoversAfterReinstall(clear: () => Promise<void>): Promise<void> {
  if (Platform.OS !== "ios") return;
  try {
    const marker = new File(Paths.document, INSTALL_MARKER);
    if (marker.exists) return;
    const freshInstall = new Directory(Paths.document).list().length === 0;
    if (freshInstall) await clear();
    marker.create();
  } catch {
    // Never block sign-in restore on this check.
  }
}
