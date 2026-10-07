import AVFoundation
import ExpoModulesCore

/// Moves voice playback between the earpiece and the loudspeaker.
///
/// CallKit configures the session as PlayAndRecord without DefaultToSpeaker,
/// so iOS starts every room on the earpiece. An output override is dropped
/// whenever iOS rebuilds the route (CallKit activation, category changes), so
/// the wanted state is kept here and applied again after each route change.
/// Headphones and Bluetooth always win over the loudspeaker.
public class DecaveAudioRouteModule: Module {
  private var wantsSpeaker = false
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("DecaveAudioRoute")

    Events("onRouteChange")

    OnCreate {
      self.observer = NotificationCenter.default.addObserver(
        forName: AVAudioSession.routeChangeNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.routeDidChange()
      }
    }

    OnDestroy {
      if let observer = self.observer { NotificationCenter.default.removeObserver(observer) }
      self.observer = nil
    }

    Function("getRoute") { () -> [String: Any] in
      self.routeInfo()
    }

    AsyncFunction("setSpeaker") { (enabled: Bool) -> [String: Any] in
      self.wantsSpeaker = enabled
      self.applyOverride()
      return self.routeInfo()
    }.runOnQueue(.main)

    // Called after CallKit (re)activates the audio session, which resets any override.
    AsyncFunction("reapply") { () -> [String: Any] in
      self.applyOverride()
      return self.routeInfo()
    }.runOnQueue(.main)
  }

  private func routeDidChange() {
    let session = AVAudioSession.sharedInstance()
    let onSpeaker = session.currentRoute.outputs.contains { $0.portType == .builtInSpeaker }
    if wantsSpeaker && !onSpeaker && !hasExternalOutput() {
      applyOverride()
    }
    sendEvent("onRouteChange", routeInfo())
  }

  private func applyOverride() {
    let session = AVAudioSession.sharedInstance()
    guard session.category == .playAndRecord else { return }
    let port: AVAudioSession.PortOverride = wantsSpeaker && !hasExternalOutput() ? .speaker : .none
    do {
      try session.overrideOutputAudioPort(port)
    } catch {
      NSLog("[DecaveAudioRoute] overrideOutputAudioPort failed: \(error)")
    }
  }

  private func hasExternalOutput() -> Bool {
    let external: Set<AVAudioSession.Port> = [
      .headphones, .bluetoothA2DP, .bluetoothHFP, .bluetoothLE, .airPlay, .carAudio, .usbAudio, .lineOut, .HDMI,
    ]
    return AVAudioSession.sharedInstance().currentRoute.outputs.contains { external.contains($0.portType) }
  }

  private func routeInfo() -> [String: Any] {
    let outputs = AVAudioSession.sharedInstance().currentRoute.outputs
    return [
      "speaker": outputs.contains { $0.portType == .builtInSpeaker },
      "external": hasExternalOutput(),
      "outputName": outputs.first?.portName ?? "",
      "wantsSpeaker": wantsSpeaker,
    ]
  }
}
