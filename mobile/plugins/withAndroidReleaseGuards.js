const { withAppBuildGradle } = require("expo/config-plugins");

// `expo prebuild` regenerates mobile/android from scratch, so these two
// edits to android/app/build.gradle have to come from a plugin:
//
// 1. The version can be set per build with
//    `-PdecaveVersionCode=... -PdecaveVersionName=...`, falling back to
//    android.versionCode / version from app.json.
// 2. The release build type stays unsigned. The template signs release with
//    the debug key; the production key lives only in EAS.
//
// Each patch is skipped when it is already applied, and throws when the
// template no longer contains the text it expects, so a template change
// breaks prebuild instead of silently shipping a debug-signed release.

const UNSIGNED_COMMENT = [
  "// Deliberately unsigned in local Gradle builds. EAS injects its",
  "// separately stored production signing configuration during an",
  "// approved build; never make a release artifact with the debug key.",
];

function fail(what) {
  throw new Error(
    `withAndroidReleaseGuards: could not find ${what} in android/app/build.gradle. ` +
      "The Expo template changed; update mobile/plugins/withAndroidReleaseGuards.js.",
  );
}

function groovyString(value) {
  return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function withOperatorVersion(gradle, versionCode, versionName) {
  if (gradle.includes("project.findProperty('decaveVersionCode')")) return gradle;

  const androidBlock = /^android \{$/m;
  const codeLine = /^([ \t]*)versionCode .*$/m;
  const nameLine = /^([ \t]*)versionName .*$/m;
  if (!androidBlock.test(gradle)) fail("the top-level `android {` block");
  if (!codeLine.test(gradle)) fail("the defaultConfig `versionCode` line");
  if (!nameLine.test(gradle)) fail("the defaultConfig `versionName` line");

  return gradle
    .replace(
      androidBlock,
      "def operatorVersionCode = project.findProperty('decaveVersionCode')\n" +
        "def operatorVersionName = project.findProperty('decaveVersionName')\n\n" +
        "android {",
    )
    .replace(
      codeLine,
      (_, indent) =>
        `${indent}versionCode (operatorVersionCode == null ? ${versionCode} : operatorVersionCode.toString().toInteger())`,
    )
    .replace(
      nameLine,
      (_, indent) =>
        `${indent}versionName (operatorVersionName == null ? ${groovyString(versionName)} : operatorVersionName.toString())`,
    );
}

function withUnsignedRelease(gradle) {
  // Template: `release {`, its "Caution!" comment lines, then the debug signing line.
  const releaseSigning = /^([ \t]*)release \{\n(?:[ \t]*\/\/.*\n)*[ \t]*signingConfig signingConfigs\.debug\n/m;
  if (releaseSigning.test(gradle)) {
    gradle = gradle.replace(releaseSigning, (_, indent) => {
      const inner = `${indent}    `;
      return `${indent}release {\n${UNSIGNED_COMMENT.map((line) => inner + line).join("\n")}\n`;
    });
  } else if (!gradle.includes(UNSIGNED_COMMENT[0])) {
    fail("`signingConfig signingConfigs.debug` in the release build type");
  }

  const release = gradle.match(/^[ \t]*release \{\n[\s\S]*?^[ \t]*\}$/m);
  if (!release) fail("the release build type");
  if (release[0].includes("signingConfig")) {
    throw new Error("withAndroidReleaseGuards: the release build type still sets a signingConfig.");
  }
  return gradle;
}

module.exports = function withAndroidReleaseGuards(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== "groovy") {
      throw new Error("withAndroidReleaseGuards: expected a Groovy android/app/build.gradle.");
    }
    const versionCode = config.android?.versionCode ?? 1;
    const versionName = config.version ?? "1.0.0";
    let gradle = config.modResults.contents;
    gradle = withOperatorVersion(gradle, versionCode, versionName);
    gradle = withUnsignedRelease(gradle);
    config.modResults.contents = gradle;
    return config;
  });
};
