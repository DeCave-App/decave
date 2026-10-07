const { withMainActivity } = require("expo/config-plugins");

// DeCave Android WebRTC screen-share config plugin.
// This plugin intentionally patches Android MainActivity only.
// iOS ReplayKit screen sharing is configured separately, so this plugin
// remains safe to include in the shared Expo config for Android + iOS.

function patchKotlin(source) {
  if (!source.includes("com.oney.WebRTCModule.WebRTCModuleOptions")) {
    source = source.replace(
      /(^package\s+[^\n]+\n)/m,
      '$1\nimport com.oney.WebRTCModule.WebRTCModuleOptions\n',
    );
  }

  if (!source.includes("enableMediaProjectionService = true")) {
    source = source.replace(
      /(override\s+fun\s+onCreate\s*\([^)]*\)\s*\{)/,
      '$1\n    WebRTCModuleOptions.getInstance().enableMediaProjectionService = true',
    );
  }

  return source;
}

function patchJava(source) {
  if (!source.includes("com.oney.WebRTCModule.WebRTCModuleOptions")) {
    source = source.replace(
      /(^package\s+[^;]+;\s*)/m,
      '$1\nimport com.oney.WebRTCModule.WebRTCModuleOptions;\n',
    );
  }

  if (!source.includes("enableMediaProjectionService = true")) {
    source = source.replace(
      /(void\s+onCreate\s*\([^)]*\)\s*\{)/,
      '$1\n    WebRTCModuleOptions.getInstance().enableMediaProjectionService = true;',
    );
  }

  return source;
}

module.exports = function withWebRtcScreenShare(config) {
  return withMainActivity(config, (mod) => {
    const language = mod.modResults.language;
    const original = mod.modResults.contents;

    mod.modResults.contents =
      language === "java" ? patchJava(original) : patchKotlin(original);

    return mod;
  });
};
