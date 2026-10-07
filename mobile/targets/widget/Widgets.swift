import ActivityKit
import SwiftUI
import WidgetKit

private let appGroup = "group.com.example.decave"

struct DeCaveEntry: TimelineEntry {
  let date: Date
  let unread: Int
  let roomName: String?
  let roomLink: URL?
  let inVoice: Bool
}

struct DeCaveProvider: TimelineProvider {
  func placeholder(in context: Context) -> DeCaveEntry {
    DeCaveEntry(date: .now, unread: 3, roomName: "General Voice", roomLink: nil, inVoice: false)
  }

  func getSnapshot(in context: Context, completion: @escaping (DeCaveEntry) -> Void) {
    completion(read())
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<DeCaveEntry>) -> Void) {
    // The app reloads timelines when unread counts or voice state change.
    completion(Timeline(entries: [read()], policy: .after(.now.addingTimeInterval(30 * 60))))
  }

  private func read() -> DeCaveEntry {
    let defaults = UserDefaults(suiteName: appGroup)
    let link = defaults?.string(forKey: "lastRoomLink").flatMap(URL.init(string:))
    return DeCaveEntry(
      date: .now,
      unread: defaults?.integer(forKey: "unreadTotal") ?? 0,
      roomName: defaults?.string(forKey: "lastRoomName"),
      roomLink: link,
      inVoice: defaults?.bool(forKey: "inVoice") ?? false
    )
  }
}

struct DeCaveWidgetView: View {
  var entry: DeCaveEntry
  @Environment(\.widgetFamily) var family

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 6) {
        Image(systemName: "bubble.left.and.bubble.right.fill").foregroundStyle(Color("$accent"))
        Text("DeCave").font(.headline)
        Spacer()
        if entry.unread > 0 {
          Text(entry.unread > 99 ? "99+" : "\(entry.unread)")
            .font(.caption.bold())
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(Capsule().fill(Color.red))
            .foregroundStyle(.white)
        }
      }
      Text(entry.unread == 0 ? "You're all caught up" : "\(entry.unread) unread")
        .font(.subheadline)
        .foregroundStyle(.secondary)
      Spacer(minLength: 0)
      if let room = entry.roomName {
        Link(destination: entry.roomLink ?? URL(string: "decave://home")!) {
          HStack(spacing: 6) {
            Image(systemName: entry.inVoice ? "waveform" : "headphones")
            Text(entry.inVoice ? "In \(room)" : "Rejoin \(room)").lineLimit(1)
          }
          .font(.caption.bold())
          .padding(.horizontal, 10).padding(.vertical, 7)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(RoundedRectangle(cornerRadius: 12).fill(Color("$accent").opacity(0.18)))
        }
      }
    }
    .containerBackground(Color("$widgetBackground"), for: .widget)
    .widgetURL(URL(string: "decave://home"))
  }
}

struct DeCaveWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "DeCaveWidget", provider: DeCaveProvider()) { entry in
      DeCaveWidgetView(entry: entry)
    }
    .configurationDisplayName("DeCave")
    .description("Unread messages and your last voice room.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

struct VoiceRoomLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: VoiceRoomAttributes.self) { context in
      HStack(spacing: 12) {
        Image(systemName: "waveform").font(.title2).foregroundStyle(.green)
        VStack(alignment: .leading, spacing: 2) {
          Text(context.attributes.roomName).font(.headline).lineLimit(1)
          Text(statusLine(context.state, hub: context.attributes.hubName)).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
        }
        Spacer()
        Image(systemName: context.state.muted ? "mic.slash.fill" : "mic.fill")
          .foregroundStyle(context.state.muted ? .red : .primary)
      }
      .padding()
      .activityBackgroundTint(Color.black.opacity(0.75))
      .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Image(systemName: "waveform").foregroundStyle(.green)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Image(systemName: context.state.muted ? "mic.slash.fill" : "mic.fill")
            .foregroundStyle(context.state.muted ? .red : .white)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading) {
            Text(context.attributes.roomName).font(.headline).lineLimit(1)
            Text(statusLine(context.state, hub: context.attributes.hubName)).font(.caption).foregroundStyle(.secondary)
          }
        }
      } compactLeading: {
        Image(systemName: "waveform").foregroundStyle(.green)
      } compactTrailing: {
        Text("\(context.state.participants)").font(.caption.bold())
      } minimal: {
        Image(systemName: "waveform").foregroundStyle(.green)
      }
      .widgetURL(URL(string: "decave://home"))
    }
  }

  private func statusLine(_ state: VoiceRoomAttributes.ContentState, hub: String) -> String {
    let people = state.participants == 1 ? "1 person" : "\(state.participants) people"
    let me = state.deafened ? " · Deafened" : state.muted ? " · Muted" : ""
    return hub.isEmpty ? "\(people)\(me)" : "\(hub) · \(people)\(me)"
  }
}

@main
struct DeCaveWidgets: WidgetBundle {
  var body: some Widget {
    DeCaveWidget()
    VoiceRoomLiveActivity()
  }
}
