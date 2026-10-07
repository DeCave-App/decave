/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: "widget",
  name: "DeCaveWidget",
  displayName: "DeCave",
  icon: "../../assets/icon.png",
  colors: {
    $accent: { color: "#7C3AED", darkColor: "#A78BFA" },
    $widgetBackground: { color: "#F5F4F9", darkColor: "#09080D" },
  },
  frameworks: ["SwiftUI", "WidgetKit", "ActivityKit"],
  deploymentTarget: "17.0",
  entitlements: { "com.apple.security.application-groups": ["group.com.example.decave"] },
};
