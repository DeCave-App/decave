// electron-builder afterAllArtifactBuild hook: notarizes and staples each signed
// macOS DMG. electron-builder notarizes the .app but never the disk image itself,
// so without this Gatekeeper rejects the downloaded DMG before the app is checked.
const { execFileSync } = require("node:child_process");
const path = require("node:path");

module.exports = async function notarizeDmgs(buildResult) {
  const dmgs = buildResult.artifactPaths.filter((file) => file.endsWith(".dmg"));
  if (!dmgs.length) return [];

  const { APPLE_KEYCHAIN_PROFILE } = process.env;
  if (!APPLE_KEYCHAIN_PROFILE) {
    console.warn("  • skipped DMG notarization  reason=APPLE_KEYCHAIN_PROFILE is not set");
    return [];
  }

  for (const dmg of dmgs) {
    console.log(`  • notarizing DMG  file=${path.basename(dmg)}`);
    const output = execFileSync(
      "xcrun",
      ["notarytool", "submit", dmg, "--keychain-profile", APPLE_KEYCHAIN_PROFILE, "--wait"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    );
    if (!/status:\s*Accepted/.test(output)) {
      throw new Error(`Notarization of ${path.basename(dmg)} was not accepted:\n${output}`);
    }
    execFileSync("xcrun", ["stapler", "staple", dmg], { stdio: "inherit" });
  }
  return [];
};
