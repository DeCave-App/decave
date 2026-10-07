/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: "app-intent",
  name: "DeCaveIntents",
  frameworks: ["AppIntents"],
  deploymentTarget: "18.0",
  entitlements: { "com.apple.security.application-groups": ["group.com.example.decave"] },
};
