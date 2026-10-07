import CoreImage
import ReplayKit

/// Encodes screen frames as JPEG and frames them the way react-native-webrtc's
/// ScreenCapturer expects: an HTTP message with Content-Length, Buffer-Width,
/// Buffer-Height and Buffer-Orientation headers. Frames that arrive while the
/// previous one is still being written are dropped, which keeps the extension
/// well inside its 50 MB memory limit.
final class BroadcastFrameUploader {
  /// Half resolution keeps a 1170x2532 screen at 585x1266: readable and light.
  private static let scale: CGFloat = 0.5
  private static let jpegQuality: CGFloat = 0.6
  private static let maxFramesPerSecond: Double = 15

  private let connection: BroadcastSocketConnection
  private let queue = DispatchQueue(label: "com.example.decave.broadcast.uploader")
  private let context = CIContext(options: [.cacheIntermediates: false])
  private var pending: Data?
  private var offset = 0
  private var lastFrameTime: CFTimeInterval = 0

  init(connection: BroadcastSocketConnection) {
    self.connection = connection
    connection.onSpaceAvailable = { [weak self] in
      self?.queue.async { self?.writePending() }
    }
  }

  func send(_ sampleBuffer: CMSampleBuffer) {
    guard connection.isOpen else { return }
    let now = CACurrentMediaTime()
    guard now - lastFrameTime >= 1 / Self.maxFramesPerSecond else { return }
    guard let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    let orientation =
      (CMGetAttachment(sampleBuffer, key: RPVideoSampleOrientationKey as CFString, attachmentModeOut: nil)
        as? NSNumber)?.uint32Value ?? CGImagePropertyOrientation.up.rawValue

    queue.sync {
      guard pending == nil else { return }
      lastFrameTime = now
      guard let message = makeMessage(imageBuffer: imageBuffer, orientation: orientation) else { return }
      pending = message
      offset = 0
      writePending()
    }
  }

  private func writePending() {
    guard let data = pending, connection.hasSpaceAvailable else { return }
    let written = data.withUnsafeBytes { raw -> Int in
      guard let base = raw.bindMemory(to: UInt8.self).baseAddress else { return -1 }
      return connection.write(base.advanced(by: offset), maxLength: data.count - offset)
    }
    if written < 0 {
      pending = nil
      return
    }
    offset += written
    if offset >= data.count {
      pending = nil
      offset = 0
    }
  }

  private func makeMessage(imageBuffer: CVImageBuffer, orientation: UInt32) -> Data? {
    let image = CIImage(cvPixelBuffer: imageBuffer)
      .transformed(by: CGAffineTransform(scaleX: Self.scale, y: Self.scale))
    let width = Int(image.extent.width.rounded())
    let height = Int(image.extent.height.rounded())
    guard
      let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
      let jpeg = context.jpegRepresentation(
        of: image, colorSpace: colorSpace,
        options: [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): Self.jpegQuality])
    else { return nil }

    let message = CFHTTPMessageCreateResponse(nil, 200, nil, kCFHTTPVersion1_1).takeRetainedValue()
    CFHTTPMessageSetHeaderFieldValue(message, "Content-Length" as CFString, String(jpeg.count) as CFString)
    CFHTTPMessageSetHeaderFieldValue(message, "Buffer-Width" as CFString, String(width) as CFString)
    CFHTTPMessageSetHeaderFieldValue(message, "Buffer-Height" as CFString, String(height) as CFString)
    CFHTTPMessageSetHeaderFieldValue(message, "Buffer-Orientation" as CFString, String(orientation) as CFString)
    CFHTTPMessageSetBody(message, jpeg as CFData)
    return CFHTTPMessageCopySerializedMessage(message)?.takeRetainedValue() as Data?
  }
}
