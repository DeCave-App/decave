/** @type {import('@bacons/apple-targets/app.plugin').Config} */
// ReplayKit broadcast upload extension: captures the whole iPhone screen and
// streams frames to the app over a socket in the shared App Group, where
// react-native-webrtc's ScreenCapturer turns them into the screen-share track.
// The app's Info.plist names this bundle id in RTCScreenSharingExtension.
module.exports = {
  type: "broadcast-upload",
  name: "DeCaveBroadcast",
  displayName: "DeCave",
  bundleIdentifier: ".broadcast",
  frameworks: ["ReplayKit", "CoreImage"],
  deploymentTarget: "16.2",
  entitlements: { "com.apple.security.application-groups": ["group.com.example.decave"] },
};
