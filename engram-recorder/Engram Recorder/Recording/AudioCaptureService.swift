import AVFoundation
import Accelerate
import Foundation

final class AudioCaptureService {
  typealias MeterHandler = @Sendable (Float) -> Void
  typealias FailureHandler = @Sendable (Error) -> Void

  private var engine: AVAudioEngine?
  private var recordingMixer: AVAudioMixerNode?
  private var systemAudioPlayer: AVAudioPlayerNode?
  private let systemAudioTap = CoreAudioTapCapture()
  private let writerQueue = DispatchQueue(
    label: "jeremys.engram.audio-writer",
    qos: .utility
  )
  private let reconfigurationQueue = DispatchQueue(
    label: "jeremys.engram.audio-reconfiguration",
    qos: .userInitiated
  )
  private let audioEngineLock = NSLock()
  private let stateLock = NSLock()

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
  private var configurationObserver: NSObjectProtocol?
  private var recordingActivity: NSObjectProtocol?

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

    do {
      beginRecordingActivity()
      try configureAudioEngine(
        outputURL: outputURL,
        meterHandler: meterHandler,
        failureHandler: failureHandler
      )
      try systemAudioTap.prepare(
        bufferHandler: { [weak self] buffer in
          guard let self, self.stateLock.withLock({ self.isCapturing }) else {
            return
          }
          self.consumeSystemAudio(buffer)
        },
        failureHandler: { [weak self] error in
          self?.failureHandler?(error)
        }
      )
      guard let engine, let systemAudioPlayer else {
        throw RecorderError.invalidAudioFormat
      }
      try audioEngineLock.withLock {
        engine.prepare()
        try engine.start()
        systemAudioPlayer.play()
        stateLock.withLock { isCapturing = true }
      }
      try systemAudioTap.start()
    } catch {
      stopAfterFailedStart()
      throw error
    }
  }

  func stop() async throws {
    let hadActiveRecording = stateLock.withLock { () -> Bool in
      guard isCapturing || systemAudioTap.isPrepared else { return false }
      isCapturing = false
      return true
    }
    guard hadActiveRecording else { throw RecorderError.noActiveRecording }

    systemAudioTap.stop()

    let result = finishAudioEngine()
    if let error = result.error {
      throw RecorderError.audioWriteFailed(error.localizedDescription)
    }
    if result.frameCount == 0 {
      throw RecorderError.noAudioCaptured
    }
  }

  private func consumeSystemAudio(_ buffer: AVAudioPCMBuffer) {
    guard let converted = convertSystemAudio(buffer) else { return }
    systemAudioPlayer?.scheduleBuffer(converted)
  }

  private func configureAudioEngine(
    outputURL: URL,
    meterHandler: @escaping MeterHandler,
    failureHandler: @escaping FailureHandler
  ) throws {
    let engine = AVAudioEngine()
    let recordingMixer = AVAudioMixerNode()
    let systemAudioPlayer = AVAudioPlayerNode()
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
        AVEncoderBitRateKey: 96_000,
      ],
      commonFormat: .pcmFormatFloat32,
      interleaved: false
    )

    engine.attach(recordingMixer)
    engine.attach(systemAudioPlayer)
    nodesAttached = true
    try connectAudioGraph(
      engine: engine,
      recordingMixer: recordingMixer,
      systemAudioPlayer: systemAudioPlayer
    )

    self.engine = engine
    self.recordingMixer = recordingMixer
    self.systemAudioPlayer = systemAudioPlayer
    configurationObserver = NotificationCenter.default.addObserver(
      forName: .AVAudioEngineConfigurationChange,
      object: engine,
      queue: nil
    ) { [weak self, weak engine] _ in
      guard let self, let engine else { return }
      self.reconfigurationQueue.async { [weak self, weak engine] in
        guard let self, let engine else { return }
        self.recoverAudioEngineAfterConfigurationChange(engine)
      }
    }
  }

  private func connectAudioGraph(
    engine: AVAudioEngine,
    recordingMixer: AVAudioMixerNode,
    systemAudioPlayer: AVAudioPlayerNode
  ) throws {
    let input = engine.inputNode
    let inputFormat = input.inputFormat(forBus: 0)
    guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0 else {
      throw RecorderError.invalidAudioFormat
    }

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
  }

  private func recoverAudioEngineAfterConfigurationChange(
    _ expectedEngine: AVAudioEngine
  ) {
    let recoveryError: Error? = audioEngineLock.withLock {
      guard stateLock.withLock({ isCapturing }),
        engine === expectedEngine,
        !expectedEngine.isRunning,
        let recordingMixer,
        let systemAudioPlayer
      else {
        return nil
      }

      do {
        systemAudioPlayer.stop()
        expectedEngine.stop()
        if tapInstalled {
          recordingMixer.removeTap(onBus: 0)
          tapInstalled = false
        }
        expectedEngine.disconnectNodeOutput(expectedEngine.inputNode)
        expectedEngine.disconnectNodeInput(recordingMixer)
        expectedEngine.disconnectNodeOutput(recordingMixer)
        expectedEngine.disconnectNodeInput(systemAudioPlayer)
        try connectAudioGraph(
          engine: expectedEngine,
          recordingMixer: recordingMixer,
          systemAudioPlayer: systemAudioPlayer
        )
        expectedEngine.prepare()
        try expectedEngine.start()
        systemAudioPlayer.play()
        return nil
      } catch {
        return error
      }
    }

    if let recoveryError {
      failureHandler?(recoveryError)
    }
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
    audioEngineLock.withLock {
      let engine = engine
      let recordingMixer = recordingMixer
      let systemAudioPlayer = systemAudioPlayer

      if let configurationObserver {
        NotificationCenter.default.removeObserver(configurationObserver)
        self.configurationObserver = nil
      }
      systemAudioPlayer?.stop()
      engine?.stop()
      if tapInstalled, let recordingMixer {
        recordingMixer.removeTap(onBus: 0)
      }
      tapInstalled = false
      writerQueue.sync {}
      audioFile = nil
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
      endRecordingActivity()
      return stateLock.withLock {
        AudioWriteResult(error: writerError, frameCount: writtenFrameCount)
      }
    }
  }

  private func stopAfterFailedStart() {
    systemAudioTap.stop()
    finishAudioEngine()
    stateLock.withLock { isCapturing = false }
  }

  private func beginRecordingActivity() {
    guard recordingActivity == nil else { return }
    recordingActivity = ProcessInfo.processInfo.beginActivity(
      options: [.userInitiated, .idleSystemSleepDisabled],
      reason: "Engram is recording audio"
    )
  }

  private func endRecordingActivity() {
    guard let recordingActivity else { return }
    ProcessInfo.processInfo.endActivity(recordingActivity)
    self.recordingActivity = nil
  }
}

private struct AudioWriteResult {
  let error: Error?
  let frameCount: AVAudioFramePosition
}

extension AVAudioPCMBuffer {
  func copied() -> AVAudioPCMBuffer? {
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
