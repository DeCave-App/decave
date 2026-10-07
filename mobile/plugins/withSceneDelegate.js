const fs = require("fs");
const path = require("path");
const { IOSConfig, withAppDelegate, withDangerousMod, withInfoPlist, withXcodeProject } = require("expo/config-plugins");

// DeCave iOS scene-lifecycle plugin.
// iOS 27 terminates apps that still create their window in
// application(_:didFinishLaunchingWithOptions:). This moves window creation
// into a UIWindowSceneDelegate and forwards deep links and universal links
// from the scene to React Native's linking manager.

const SCENE_DELEGATE = `import UIKit
import React

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory else { return }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window

    var launchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]
    if let url = connectionOptions.urlContexts.first?.url {
      launchOptions[.url] = url
    }
    if let activity = connectionOptions.userActivities.first(where: { $0.activityType == NSUserActivityTypeBrowsingWeb }) {
      launchOptions[.userActivityDictionary] = [
        "UIApplicationLaunchOptionsUserActivityTypeKey": activity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": activity,
      ]
    }

    factory.startReactNative(withModuleName: "main", in: window, launchOptions: launchOptions)

    if let shortcut = connectionOptions.shortcutItem {
      UIApplication.shared.delegate?.application?(UIApplication.shared, performActionFor: shortcut) { _ in }
    }
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let context = URLContexts.first else { return }
    var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
    if let source = context.options.sourceApplication { options[.sourceApplication] = source }
    _ = UIApplication.shared.delegate?.application?(UIApplication.shared, open: context.url, options: options)
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = UIApplication.shared.delegate?.application?(UIApplication.shared, continue: userActivity) { _ in }
  }

  func windowScene(
    _ windowScene: UIWindowScene,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    UIApplication.shared.delegate?.application?(UIApplication.shared, performActionFor: shortcutItem, completionHandler: completionHandler)
      ?? completionHandler(false)
  }
}
`;

function patchAppDelegate(source) {
  if (source.includes("// decave-scene-lifecycle")) return source;
  // The scene delegate creates the window and starts React Native.
  return source.replace(
    /#if os\(iOS\) \|\| os\(tvOS\)\s*\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\s*\n\s*factory\.startReactNative\([\s\S]*?\)\s*\n#endif/,
    "// decave-scene-lifecycle: SceneDelegate creates the window and starts React Native.",
  );
}

module.exports = function withSceneDelegate(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate",
          },
        ],
      },
    };
    return mod;
  });

  config = withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== "swift") throw new Error("withSceneDelegate expects a Swift AppDelegate.");
    const patched = patchAppDelegate(mod.modResults.contents);
    if (!patched.includes("decave-scene-lifecycle")) throw new Error("withSceneDelegate could not patch AppDelegate window setup.");
    mod.modResults.contents = patched;
    return mod;
  });

  config = withDangerousMod(config, [
    "ios",
    async (mod) => {
      const projectName = IOSConfig.XcodeUtils.getProjectName(mod.modRequest.projectRoot);
      const file = path.join(mod.modRequest.platformProjectRoot, projectName, "SceneDelegate.swift");
      fs.writeFileSync(file, SCENE_DELEGATE);
      return mod;
    },
  ]);

  config = withXcodeProject(config, (mod) => {
    const projectName = IOSConfig.XcodeUtils.getProjectName(mod.modRequest.projectRoot);
    const filePath = `${projectName}/SceneDelegate.swift`;
    if (!mod.modResults.hasFile(filePath)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath: filePath,
        groupName: projectName,
        project: mod.modResults,
      });
    }
    return mod;
  });

  return config;
};
