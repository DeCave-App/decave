import ActivityKit
import Foundation

// Keep in sync with modules/decave-live-activity/ios/VoiceRoomAttributes.swift.
struct VoiceRoomAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    var participants: Int
    var muted: Bool
    var deafened: Bool
  }

  var roomName: String
  var hubName: String
}
