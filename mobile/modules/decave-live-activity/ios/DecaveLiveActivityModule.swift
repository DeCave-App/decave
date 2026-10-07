import ActivityKit
import ExpoModulesCore

struct VoiceActivityStateRecord: Record {
  @Field var participants: Int = 1
  @Field var muted: Bool = false
  @Field var deafened: Bool = false

  var contentState: VoiceRoomAttributes.ContentState {
    VoiceRoomAttributes.ContentState(participants: participants, muted: muted, deafened: deafened)
  }
}

public class DecaveLiveActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DecaveLiveActivity")

    AsyncFunction("start") { (roomName: String, hubName: String, state: VoiceActivityStateRecord) -> Bool in
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return false }
      // One voice room at a time: replace any activity left from an earlier room.
      for activity in Activity<VoiceRoomAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
      let attributes = VoiceRoomAttributes(roomName: roomName, hubName: hubName)
      _ = try Activity.request(
        attributes: attributes,
        content: ActivityContent(state: state.contentState, staleDate: nil),
        pushType: nil
      )
      return true
    }

    AsyncFunction("update") { (state: VoiceActivityStateRecord) in
      for activity in Activity<VoiceRoomAttributes>.activities {
        await activity.update(ActivityContent(state: state.contentState, staleDate: nil))
      }
    }

    AsyncFunction("end") {
      for activity in Activity<VoiceRoomAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }
  }
}
