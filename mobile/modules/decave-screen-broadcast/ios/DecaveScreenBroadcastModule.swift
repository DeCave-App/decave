import ExpoModulesCore

/// Relays the broadcast extension's Darwin notifications (targets/broadcast)
/// to JS, so the app opens its frame socket only once the person has picked
/// DeCave in the system broadcast sheet, and notices when they stop it from
/// Control Center.
public class DecaveScreenBroadcastModule: Module {
  private static let startedNotification = "com.example.decave.broadcast.started"
  private static let stoppedNotification = "com.example.decave.broadcast.stopped"

  public func definition() -> ModuleDefinition {
    Name("DecaveScreenBroadcast")

    Events("onBroadcastStarted", "onBroadcastStopped")

    OnStartObserving {
      self.observe(Self.startedNotification)
      self.observe(Self.stoppedNotification)
    }

    OnStopObserving {
      CFNotificationCenterRemoveEveryObserver(
        CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(self).toOpaque())
    }
  }

  private func observe(_ name: String) {
    let center = CFNotificationCenterGetDarwinNotifyCenter()
    let observer = Unmanaged.passUnretained(self).toOpaque()
    CFNotificationCenterRemoveObserver(center, observer, CFNotificationName(name as CFString), nil)
    CFNotificationCenterAddObserver(
      center, observer,
      { _, observer, name, _, _ in
        guard let observer = observer, let name = name?.rawValue as String? else { return }
        let module = Unmanaged<DecaveScreenBroadcastModule>.fromOpaque(observer).takeUnretainedValue()
        module.didReceive(name)
      },
      name as CFString, nil, .deliverImmediately)
  }

  private func didReceive(_ name: String) {
    DispatchQueue.main.async {
      if name == Self.startedNotification {
        self.sendEvent("onBroadcastStarted", [:])
      } else if name == Self.stoppedNotification {
        self.sendEvent("onBroadcastStopped", [:])
      }
    }
  }
}
