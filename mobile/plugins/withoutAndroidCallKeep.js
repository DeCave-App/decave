const { withAndroidManifest } = require("expo/config-plugins");

// DeCave uses react-native-callkeep for CallKit on iOS only
// (src/components/VoiceCallKitBridge.tsx never loads it on Android), and
// react-native.config.js keeps its native code out of the Android build.
// @config-plugins/react-native-callkeep still adds Android phone permissions
// and a telecom ConnectionService, so this plugin strips them again.
//
// List it BEFORE "@config-plugins/react-native-callkeep" in app.json: Expo
// runs manifest mods from the last plugin to the first, so this cleanup then
// runs after CallKeep's own changes.

const CALLKEEP_SERVICES = new Set([
  "io.wazo.callkeep.RNCallKeepBackgroundMessagingService",
  "io.wazo.callkeep.VoiceConnectionService",
]);

const PHONE_PERMISSIONS = [
  "android.permission.BIND_TELECOM_CONNECTION_SERVICE",
  "android.permission.CALL_PHONE",
  "android.permission.MANAGE_OWN_CALLS",
  "android.permission.READ_PHONE_NUMBERS",
  "android.permission.READ_PHONE_STATE",
];

module.exports = function withoutAndroidCallKeep(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    manifest.$["xmlns:tools"] = manifest.$["xmlns:tools"] || "http://schemas.android.com/tools";

    for (const app of manifest.application || []) {
      if (Array.isArray(app.service)) {
        app.service = app.service.filter((service) => !CALLKEEP_SERVICES.has(service.$["android:name"]));
      }
    }

    // tools:node="remove" also drops the same permissions if any library
    // manifest merges them back in.
    const others = (manifest["uses-permission"] || []).filter(
      (permission) => !PHONE_PERMISSIONS.includes(permission.$["android:name"]),
    );
    manifest["uses-permission"] = [
      ...others,
      ...PHONE_PERMISSIONS.map((name) => ({ $: { "android:name": name, "tools:node": "remove" } })),
    ];
    return config;
  });
};
