import AVFoundation
import Accelerate
import CoreMedia
import Foundation
import ScreenCaptureKit

final class AudioCaptureService: NSObject, SCStreamOutput, SCStreamDelegate {
  typealias MeterHandler = @Sendable (Float) -> Void
  typealias FailureHandler = @Sendable (Error) -> Void

  private var engine: AVAudioEngine?
  private var recordingMixer: AVAudioMixerNode?
  private var systemAudioPlayer: AVAudioPlayerNode?
  private let captureQueue = DispatchQueue(
    label: "jeremys.engram.capture",
    qos: .userInitiated
  )
  private let writerQueue = DispatchQueue(
    label: "jeremys.engram.audio-writer",
    qos: .utility
  )
  private let stateLock = NSLock()

  private var stream: SCStream?
  private var audioFile: AVAudioFile?
  private var systemAudioConverter: AVAudioConverter?
  private var isCapturing = false
  private var nodesAttached = false
  private var tapInstalled = false
  private var writerError: Error?
  private var writtenFrameCount: AVAudioFramePosition = 0
  private var lastMeterUpdate: TimeInterval = 0
  private var meterHandler: MeterHandler?
  private var failureHandler: FailureHandler?

  private static let mixFormat = AVAudioFormat(
    commonFormat: .pcmFormatFloat32,
    sampleRate: 48_000,
    channels: 2,
    interleaved: false
  )!

  func start(
    outputURL: URL,
    meterHandler: @escaping MeterHandler,
    failureHandler: @escaping FailureHandler
  ) async throws {
    guard await AVCaptureDevice.requestAccess(for: .audio) else {
      throw RecorderError.microphonePermissionDenied
    }

    let content: SCShareableContent
    do {
      content = try await SCShareableContent.excludingDesktopWindows(
        false,
        onScreenWindowsOnly: false
      )
    } catch {
      throw RecorderError.screenRecordingPermissionDenied
    }
    guard let display = content.displays.first else {
      throw RecorderError.noDisplayAvailable
    }

    let ownBundleID = Bundle.main.bundleIdentifier
    let ownApplications = content.applications.filter {
      $0.bundleIdentifier == ownBundleID
    }
    let filter = SCContentFilter(
      display: display,
      excludingApplications: ownApplications,
      exceptingWindows: []
    )
    let configuration = SCStreamConfiguration()
    configuration.capturesAudio = true
    configuration.excludesCurrentProcessAudio = true
    configuration.sampleRate = 48_000
    configuration.channelCount = 2
    configuration.width = 2
    configuration.height = 2
    configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
    configuration.showsCursor = false

    let stream = SCStream(
      filter: filter,
      configuration: configuration,
      delegate: self
    )
    try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: captureQueue)
    self.stream = stream

    do {
      try configureAudioEngine(
        outputURL: outputURL,
        meterHandler: meterHandler,
        failureHandler: failureHandler
      )
      guard let engine, let systemAudioPlayer else {
        throw RecorderError.invalidAudioFormat
      }
      engine.prepare()
      try engine.start()
      systemAudioPlayer.play()
      stateLock.withLock { isCapturing = true }
      try await stream.startCapture()
    } catch {
      await stopAfterFailedStart()
      throw error
    }
  }

  func stop() async throws {
    let activeStream = stateLock.withLock { () -> SCStream? in
      guard isCapturing || stream != nil else { return nil }
      isCapturing = false
      return stream
    }
    guard let activeStream else { throw RecorderError.noActiveRecording }

    await stopScreenCapture(activeStream)

    let result = finishAudioEngine()
    if let error = result.error {
      throw RecorderError.audioWriteFailed(error.localizedDescription)
    }
    if result.frameCount == 0 {
      throw RecorderError.noAudioCaptured
    }
  }

  func stream(
    _ stream: SCStream,
    didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
    of type: SCStreamOutputType
  ) {
    guard type == .audio,
      sampleBuffer.isValid,
      CMSampleBufferDataIsReady(sampleBuffer),
      stateLock.withLock({ isCapturing })
    else {
      return
    }

    do {
      let buffer = try sampleBuffer.audioBuffer()
      guard let converted = convertSystemAudio(buffer) else { return }
      systemAudioPlayer?.scheduleBuffer(converted)
    } catch {
      // A malformed individual system-audio buffer should not end the recording.
    }
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    stateLock.withLock { isCapturing = false }
    failureHandler?(error)
  }

  private func configureAudioEngine(
    outputURL: URL,
    meterHandler: @escaping MeterHandler,
    failureHandler: @escaping FailureHandler
  ) throws {
    let engine = AVAudioEngine()
    let recordingMixer = AVAudioMixerNode()
    let systemAudioPlayer = AVAudioPlayerNode()
    let input = engine.inputNode
    let inputFormat = input.inputFormat(forBus: 0)
    guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0 else {
      throw RecorderError.invalidAudioFormat
    }

    self.meterHandler = meterHandler
    self.failureHandler = failureHandler
    lastMeterUpdate = 0
    systemAudioConverter = nil
    writerError = nil
    writtenFrameCount = 0
    audioFile = try AVAudioFile(
      forWriting: outputURL,
      settings: [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: 48_000,
        AVNumberOfChannelsKey: 2,
        AVEncoderBitRateKey: 192_000,
      ],
      commonFormat: .pcmFormatFloat32,
      interleaved: false
    )

    engine.attach(recordingMixer)
    engine.attach(systemAudioPlayer)
    nodesAttached = true
    engine.connect(input, to: recordingMixer, format: inputFormat)
    engine.connect(systemAudioPlayer, to: recordingMixer, format: Self.mixFormat)
    engine.connect(recordingMixer, to: engine.mainMixerNode, format: Self.mixFormat)
    engine.mainMixerNode.outputVolume = 0

    recordingMixer.installTap(
      onBus: 0,
      bufferSize: 1_024,
      format: Self.mixFormat
    ) { [weak self] buffer, _ in
      self?.consumeMixedAudio(buffer)
    }
    tapInstalled = true

    self.engine = engine
    self.recordingMixer = recordingMixer
    self.systemAudioPlayer = systemAudioPlayer
  }

  private func consumeMixedAudio(_ buffer: AVAudioPCMBuffer) {
    guard let copiedBuffer = buffer.copied() else { return }
    writerQueue.async { [weak self] in
      do {
        try self?.audioFile?.write(from: copiedBuffer)
        self?.stateLock.withLock {
          self?.writtenFrameCount += AVAudioFramePosition(copiedBuffer.frameLength)
        }
      } catch {
        self?.stateLock.withLock {
          if self?.writerError == nil { self?.writerError = error }
        }
      }
    }

    let now = ProcessInfo.processInfo.systemUptime
    guard now - lastMeterUpdate >= 0.05 else { return }
    lastMeterUpdate = now
    meterHandler?(buffer.normalizedLevel)
  }

  private func convertSystemAudio(_ input: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
    if input.format == Self.mixFormat {
      return input
    }

    if systemAudioConverter?.inputFormat != input.format {
      systemAudioConverter = AVAudioConverter(from: input.format, to: Self.mixFormat)
    }
    guard let converter = systemAudioConverter else { return nil }

    let ratio = Self.mixFormat.sampleRate / input.format.sampleRate
    let capacity = AVAudioFrameCount(ceil(Double(input.frameLength) * ratio)) + 32
    guard
      let output = AVAudioPCMBuffer(
        pcmFormat: Self.mixFormat,
        frameCapacity: capacity
      )
    else {
      return nil
    }

    var suppliedInput = false
    var conversionError: NSError?
    let status = converter.convert(to: output, error: &conversionError) { _, status in
      if suppliedInput {
        status.pointee = .noDataNow
        return nil
      }
      suppliedInput = true
      status.pointee = .haveData
      return input
    }
    guard status == .haveData || status == .inputRanDry else { return nil }
    return output.frameLength > 0 ? output : nil
  }

  @discardableResult
  private func finishAudioEngine() -> AudioWriteResult {
    let engine = engine
    let recordingMixer = recordingMixer
    let systemAudioPlayer = systemAudioPlayer

    systemAudioPlayer?.stop()
    engine?.stop()
    if tapInstalled, let recordingMixer {
      recordingMixer.removeTap(onBus: 0)
    }
    tapInstalled = false
    writerQueue.sync {}
    audioFile = nil
    stream = nil
    systemAudioConverter = nil
    meterHandler = nil
    failureHandler = nil
    if nodesAttached, let engine, let recordingMixer, let systemAudioPlayer {
      engine.disconnectNodeOutput(engine.inputNode)
      engine.disconnectNodeInput(recordingMixer)
      engine.disconnectNodeOutput(recordingMixer)
      engine.disconnectNodeInput(systemAudioPlayer)
      engine.detach(systemAudioPlayer)
      engine.detach(recordingMixer)
      nodesAttached = false
    }
    if let engine {
      engine.inputNode.auAudioUnit.deallocateRenderResources()
      engine.outputNode.auAudioUnit.deallocateRenderResources()
      engine.reset()
    }
    self.systemAudioPlayer = nil
    self.recordingMixer = nil
    self.engine = nil
    return stateLock.withLock {
      AudioWriteResult(error: writerError, frameCount: writtenFrameCount)
    }
  }

  private func stopAfterFailedStart() async {
    if let stream {
      await stopScreenCapture(stream)
    }
    finishAudioEngine()
    stateLock.withLock { isCapturing = false }
  }

  private func stopScreenCapture(_ stream: SCStream) async {
    try? await stream.stopCapture()
    captureQueue.sync {}
    try? stream.removeStreamOutput(self, type: .audio)
  }
}

private struct AudioWriteResult {
  let error: Error?
  let frameCount: AVAudioFramePosition
}

extension CMSampleBuffer {
  fileprivate func audioBuffer() throws -> AVAudioPCMBuffer {
    guard let description = formatDescription else {
      throw RecorderError.invalidAudioFormat
    }
    let format = AVAudioFormat(cmAudioFormatDescription: description)

    let frameCount = AVAudioFrameCount(numSamples)
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else {
      throw RecorderError.invalidAudioFormat
    }
    buffer.frameLength = frameCount
    try copyPCMData(fromRange: 0..<Int(frameCount), into: buffer.mutableAudioBufferList)
    return buffer
  }
}

extension AVAudioPCMBuffer {
  fileprivate func copied() -> AVAudioPCMBuffer? {
    guard
      let copy = AVAudioPCMBuffer(
        pcmFormat: format,
        frameCapacity: frameLength
      )
    else {
      return nil
    }
    copy.frameLength = frameLength

    let source = UnsafeMutableAudioBufferListPointer(mutableAudioBufferList)
    let destination = UnsafeMutableAudioBufferListPointer(copy.mutableAudioBufferList)
    guard source.count == destination.count else { return nil }
    for index in source.indices {
      guard let sourceData = source[index].mData,
        let destinationData = destination[index].mData
      else {
        continue
      }
      let byteCount = Int(source[index].mDataByteSize)
      memcpy(destinationData, sourceData, byteCount)
      destination[index].mDataByteSize = source[index].mDataByteSize
    }
    return copy
  }

  fileprivate var normalizedLevel: Float {
    guard let channels = floatChannelData, frameLength > 0 else { return 0 }
    let frames = Int(frameLength)
    var sum: Float = 0
    for channel in 0..<Int(format.channelCount) {
      var channelSum: Float = 0
      vDSP_svesq(channels[channel], 1, &channelSum, vDSP_Length(frames))
      sum += channelSum
    }
    let mean = sum / Float(frames * Int(format.channelCount))
    let rms = sqrt(max(mean, 0))
    return min(max(pow(rms, 0.45) * 1.8, 0.03), 1)
  }
}

extension NSLock {
  fileprivate func withLock<T>(_ body: () throws -> T) rethrows -> T {
    lock()
    defer { unlock() }
    return try body()
  }
}
