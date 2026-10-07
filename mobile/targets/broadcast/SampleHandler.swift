import ReplayKit

/// Names shared with the app (modules/decave-screen-broadcast).
enum BroadcastConfig {
  static let appGroup = "group.com.example.decave"
  /// react-native-webrtc's ScreenCaptureController listens on this socket file.
  static let socketName = "rtc_SSFD"
  static let startedNotification = "com.example.decave.broadcast.started"
  static let stoppedNotification = "com.example.decave.broadcast.stopped"
}

class SampleHandler: RPBroadcastSampleHandler {
  private var connection: BroadcastSocketConnection?
  private var uploader: BroadcastFrameUploader?
  private var retryTimer: Timer?

  override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
    postDarwinNotification(BroadcastConfig.startedNotification)
    guard
      let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: BroadcastConfig.appGroup)
    else {
      finish(message: "DeCave could not open its shared container.")
      return
    }
    let connection = BroadcastSocketConnection(path: container.appendingPathComponent(BroadcastConfig.socketName).path)
    connection.onClose = { [weak self] in
      // The app stopped sharing (or quit): end the system broadcast too.
      self?.finish(message: "Screen sharing stopped.")
    }
    self.connection = connection
    uploader = BroadcastFrameUploader(connection: connection)
    connectWithRetry()
  }

  /// The app opens its socket when it hears the started notification, which
  /// is just after this runs, so retry for a short while.
  private func connectWithRetry() {
    var attempts = 0
    DispatchQueue.main.async {
      self.retryTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] timer in
        guard let self = self, let connection = self.connection else {
          timer.invalidate()
          return
        }
        attempts += 1
        if connection.open() {
          timer.invalidate()
        } else if attempts >= 60 {
          timer.invalidate()
          self.finish(message: "Start screen sharing from a DeCave voice room.")
        }
      }
    }
  }

  override func broadcastFinished() {
    retryTimer?.invalidate()
    postDarwinNotification(BroadcastConfig.stoppedNotification)
    connection?.onClose = nil
    connection?.close()
    connection = nil
    uploader = nil
  }

  override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
    guard sampleBufferType == .video else { return }
    uploader?.send(sampleBuffer)
  }

  private func finish(message: String) {
    DispatchQueue.main.async {
      self.retryTimer?.invalidate()
      self.connection?.onClose = nil
      let error = NSError(
        domain: "com.example.decave.broadcast", code: 0, userInfo: [NSLocalizedDescriptionKey: message])
      self.finishBroadcastWithError(error)
    }
  }

  private func postDarwinNotification(_ name: String) {
    CFNotificationCenterPostNotification(
      CFNotificationCenterGetDarwinNotifyCenter(), CFNotificationName(name as CFString), nil, nil, true)
  }
}
