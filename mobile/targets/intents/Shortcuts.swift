import AppIntents
import Foundation

// Siri and Shortcuts entry points. Each one opens a DeCave deep link, which
// the app routes like any other link.

@available(iOS 18.0, *)
struct OpenMessagesIntent: AppIntent {
  static let title: LocalizedStringResource = "Open DeCave messages"
  static let description = IntentDescription("Opens your DeCave direct messages.")

  func perform() async throws -> some IntentResult & OpensIntent {
    .result(opensIntent: OpenURLIntent(URL(string: "decave://dms")!))
  }
}

@available(iOS 18.0, *)
struct FindSquadIntent: AppIntent {
  static let title: LocalizedStringResource = "Find a squad"
  static let description = IntentDescription("Opens DeCave's Squad Finder.")

  func perform() async throws -> some IntentResult & OpensIntent {
    .result(opensIntent: OpenURLIntent(URL(string: "decave://squad-finder")!))
  }
}

@available(iOS 18.0, *)
struct RejoinVoiceIntent: AppIntent {
  static let title: LocalizedStringResource = "Rejoin my voice room"
  static let description = IntentDescription("Opens the last DeCave voice room you were in.")

  func perform() async throws -> some IntentResult & OpensIntent {
    let link = UserDefaults(suiteName: "group.com.example.decave")?.string(forKey: "lastRoomLink") ?? "decave://home"
    return .result(opensIntent: OpenURLIntent(URL(string: link) ?? URL(string: "decave://home")!))
  }
}

@available(iOS 18.0, *)
struct DeCaveShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: RejoinVoiceIntent(),
      phrases: ["Rejoin my voice room in \(.applicationName)", "Join voice in \(.applicationName)"],
      shortTitle: "Rejoin voice",
      systemImageName: "headphones"
    )
    AppShortcut(
      intent: OpenMessagesIntent(),
      phrases: ["Open my \(.applicationName) messages", "Check \(.applicationName) messages"],
      shortTitle: "Messages",
      systemImageName: "bubble.left.and.bubble.right"
    )
    AppShortcut(
      intent: FindSquadIntent(),
      phrases: ["Find a squad in \(.applicationName)", "Find a squad on \(.applicationName)"],
      shortTitle: "Find a squad",
      systemImageName: "gamecontroller"
    )
  }
}

@main
struct DeCaveIntentsExtension: AppIntentsExtension {}
