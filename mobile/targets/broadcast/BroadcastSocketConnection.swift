import Foundation

/// Client side of the Unix socket that react-native-webrtc's ScreenCapturer
/// listens on inside the App Group container.
final class BroadcastSocketConnection: NSObject, StreamDelegate {
  var onClose: (() -> Void)?
  var onSpaceAvailable: (() -> Void)?

  private let path: String
  private var inputStream: InputStream?
  private var outputStream: OutputStream?
  private var thread: Thread?
  private(set) var isOpen = false

  init(path: String) {
    self.path = path
  }

  /// Returns true once connected. Safe to call again after a failure.
  func open() -> Bool {
    if isOpen { return true }
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { return false }

    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    let pathBytes = Array(path.utf8CString)
    guard pathBytes.count <= MemoryLayout.size(ofValue: address.sun_path) else {
      Darwin.close(fd)
      return false
    }
    withUnsafeMutableBytes(of: &address.sun_path) { raw in
      for (index, byte) in pathBytes.enumerated() { raw[index] = UInt8(bitPattern: byte) }
    }
    let result = withUnsafePointer(to: &address) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
      }
    }
    guard result == 0 else {
      Darwin.close(fd)
      return false
    }

    var readStream: Unmanaged<CFReadStream>?
    var writeStream: Unmanaged<CFWriteStream>?
    CFStreamCreatePairWithSocket(kCFAllocatorDefault, fd, &readStream, &writeStream)
    guard let input = readStream?.takeRetainedValue(), let output = writeStream?.takeRetainedValue() else {
      Darwin.close(fd)
      return false
    }
    let inputStream = input as InputStream
    let outputStream = output as OutputStream
    let closeSocket = Stream.PropertyKey(kCFStreamPropertyShouldCloseNativeSocket as String)
    inputStream.setProperty(kCFBooleanTrue, forKey: closeSocket)
    outputStream.setProperty(kCFBooleanTrue, forKey: closeSocket)
    inputStream.delegate = self
    outputStream.delegate = self
    self.inputStream = inputStream
    self.outputStream = outputStream

    // Stream events need a run loop; give the socket its own thread.
    let ready = DispatchSemaphore(value: 0)
    let thread = Thread {
      inputStream.schedule(in: .current, forMode: .default)
      outputStream.schedule(in: .current, forMode: .default)
      inputStream.open()
      outputStream.open()
      ready.signal()
      while !Thread.current.isCancelled {
        _ = RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.25))
      }
    }
    thread.name = "DeCaveBroadcastSocket"
    thread.qualityOfService = .userInitiated
    self.thread = thread
    thread.start()
    ready.wait()
    isOpen = true
    return true
  }

  func close() {
    guard isOpen else { return }
    isOpen = false
    inputStream?.delegate = nil
    outputStream?.delegate = nil
    inputStream?.close()
    outputStream?.close()
    inputStream = nil
    outputStream = nil
    thread?.cancel()
    thread = nil
  }

  var hasSpaceAvailable: Bool { outputStream?.hasSpaceAvailable ?? false }

  /// Writes as much as the socket accepts; returns the number of bytes written or -1.
  func write(_ bytes: UnsafePointer<UInt8>, maxLength: Int) -> Int {
    guard let outputStream = outputStream else { return -1 }
    return outputStream.write(bytes, maxLength: maxLength)
  }

  func stream(_ aStream: Stream, handle eventCode: Stream.Event) {
    switch eventCode {
    case .hasSpaceAvailable:
      if aStream === outputStream { onSpaceAvailable?() }
    case .endEncountered, .errorOccurred:
      let wasOpen = isOpen
      close()
      if wasOpen { onClose?() }
    default:
      break
    }
  }
}
