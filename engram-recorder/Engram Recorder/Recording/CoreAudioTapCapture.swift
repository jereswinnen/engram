import AVFoundation
import CoreAudio
import Foundation

/// Captures the system-wide stereo mix without tying recording to a display.
///
/// Core Audio exposes process taps as input streams on an aggregate device. The
/// aggregate device and tap are private and exist only for the lifetime of a
/// recording.
final class CoreAudioTapCapture {
  typealias BufferHandler = (AVAudioPCMBuffer) -> Void
  typealias FailureHandler = (Error) -> Void

  private let audioQueue = DispatchQueue(
    label: "jeremys.engram.system-audio-tap",
    qos: .userInitiated
  )

  private var tapID = AudioObjectID(kAudioObjectUnknown)
  private var aggregateDeviceID = AudioObjectID(kAudioObjectUnknown)
  private var ioProcID: AudioDeviceIOProcID?
  private var audioFormat: AVAudioFormat?
  private var bufferHandler: BufferHandler?
  private var failureHandler: FailureHandler?
  private var formatListener: AudioObjectPropertyListenerBlock?
  private var deviceAliveListener: AudioObjectPropertyListenerBlock?
  private var isRunning = false

  var isPrepared: Bool {
    tapID != kAudioObjectUnknown || aggregateDeviceID != kAudioObjectUnknown
  }

  func prepare(
    bufferHandler: @escaping BufferHandler,
    failureHandler: @escaping FailureHandler
  ) throws {
    guard !isPrepared else {
      throw RecorderError.systemAudioCaptureFailed(
        "A system-audio tap is already active."
      )
    }

    self.bufferHandler = bufferHandler
    self.failureHandler = failureHandler

    do {
      let ownProcessID = try currentAudioProcessObjectID()
      let description = CATapDescription()
      description.name = "Engram System Audio"
      description.processes = [ownProcessID]
      description.isPrivate = true
      description.muteBehavior = .unmuted
      description.isMixdown = true
      description.isMono = false
      description.isExclusive = true

      var newTapID = AudioObjectID(kAudioObjectUnknown)
      try check(
        AudioHardwareCreateProcessTap(description, &newTapID),
        operation: "create the system-audio tap"
      )
      tapID = newTapID

      audioFormat = try readTapFormat(tapID: newTapID)
      let tapUID = try readTapUID(tapID: newTapID)

      let aggregateDescription: [String: Any] = [
        kAudioAggregateDeviceNameKey: "Engram System Audio",
        kAudioAggregateDeviceUIDKey: "jeremys.engram.system-audio.\(UUID().uuidString)",
        kAudioAggregateDeviceIsPrivateKey: true,
      ]
      var newAggregateDeviceID = AudioObjectID(kAudioObjectUnknown)
      try check(
        AudioHardwareCreateAggregateDevice(
          aggregateDescription as CFDictionary,
          &newAggregateDeviceID
        ),
        operation: "create the system-audio input device"
      )
      aggregateDeviceID = newAggregateDeviceID

      try addTap(tapUID, to: newAggregateDeviceID)
      try installFormatListener(on: newTapID)
      try installDeviceAliveListener(on: newAggregateDeviceID)

      var newIOProcID: AudioDeviceIOProcID?
      try check(
        AudioDeviceCreateIOProcIDWithBlock(
          &newIOProcID,
          newAggregateDeviceID,
          audioQueue
        ) { [weak self] _, inputData, _, _, _ in
          self?.consume(inputData)
        },
        operation: "prepare system-audio capture"
      )
      guard let newIOProcID else {
        throw RecorderError.systemAudioCaptureFailed(
          "Core Audio did not create an audio callback."
        )
      }
      ioProcID = newIOProcID
    } catch {
      stop()
      throw error
    }
  }

  func start() throws {
    guard aggregateDeviceID != kAudioObjectUnknown, let ioProcID else {
      throw RecorderError.systemAudioCaptureFailed(
        "The system-audio tap was not prepared."
      )
    }
    try check(
      AudioDeviceStart(aggregateDeviceID, ioProcID),
      operation: "start system-audio capture"
    )
    isRunning = true
  }

  func stop() {
    let deviceID = aggregateDeviceID
    let activeIOProcID = ioProcID

    if isRunning, deviceID != kAudioObjectUnknown {
      _ = AudioDeviceStop(deviceID, activeIOProcID)
    }
    isRunning = false

    removeDeviceAliveListener()
    removeFormatListener()
    audioQueue.sync {}

    if deviceID != kAudioObjectUnknown, let activeIOProcID {
      _ = AudioDeviceDestroyIOProcID(deviceID, activeIOProcID)
    }
    ioProcID = nil

    if deviceID != kAudioObjectUnknown {
      _ = AudioHardwareDestroyAggregateDevice(deviceID)
    }
    aggregateDeviceID = AudioObjectID(kAudioObjectUnknown)

    if tapID != kAudioObjectUnknown {
      _ = AudioHardwareDestroyProcessTap(tapID)
    }
    tapID = AudioObjectID(kAudioObjectUnknown)
    audioFormat = nil
    bufferHandler = nil
    failureHandler = nil
  }

  deinit {
    stop()
  }

  private func consume(_ inputData: UnsafePointer<AudioBufferList>) {
    guard let audioFormat,
      let borrowedBuffer = AVAudioPCMBuffer(
        pcmFormat: audioFormat,
        bufferListNoCopy: inputData,
        deallocator: nil
      ),
      let copiedBuffer = borrowedBuffer.copied()
    else {
      return
    }
    bufferHandler?(copiedBuffer)
  }

  private func currentAudioProcessObjectID() throws -> AudioObjectID {
    var address = Self.propertyAddress(
      selector: kAudioHardwarePropertyTranslatePIDToProcessObject
    )
    var processID = getpid()
    var objectID = AudioObjectID(kAudioObjectUnknown)
    var propertySize = UInt32(MemoryLayout<AudioObjectID>.stride)
    let status = withUnsafePointer(to: &processID) { processIDPointer in
      AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject),
        &address,
        UInt32(MemoryLayout<pid_t>.stride),
        processIDPointer,
        &propertySize,
        &objectID
      )
    }
    try check(status, operation: "identify Engram's audio process")
    guard objectID != kAudioObjectUnknown else {
      throw RecorderError.systemAudioCaptureFailed(
        "Core Audio could not identify Engram's audio process."
      )
    }
    return objectID
  }

  private func readTapUID(tapID: AudioObjectID) throws -> String {
    var address = Self.propertyAddress(selector: kAudioTapPropertyUID)
    var propertySize = UInt32(MemoryLayout<CFString>.stride)
    var tapUID: CFString = "" as CFString
    let status = withUnsafeMutablePointer(to: &tapUID) { tapUIDPointer in
      AudioObjectGetPropertyData(
        tapID,
        &address,
        0,
        nil,
        &propertySize,
        tapUIDPointer
      )
    }
    try check(status, operation: "read the system-audio tap identifier")
    return tapUID as String
  }

  private func readTapFormat(tapID: AudioObjectID) throws -> AVAudioFormat {
    var address = Self.propertyAddress(selector: kAudioTapPropertyFormat)
    var propertySize = UInt32(MemoryLayout<AudioStreamBasicDescription>.stride)
    var streamDescription = AudioStreamBasicDescription()
    try check(
      AudioObjectGetPropertyData(
        tapID,
        &address,
        0,
        nil,
        &propertySize,
        &streamDescription
      ),
      operation: "read the system-audio format"
    )
    guard let format = AVAudioFormat(streamDescription: &streamDescription) else {
      throw RecorderError.invalidAudioFormat
    }
    return format
  }

  private func addTap(_ tapUID: String, to deviceID: AudioObjectID) throws {
    var address = Self.propertyAddress(
      selector: kAudioAggregateDevicePropertyTapList
    )
    var propertySize: UInt32 = 0
    try check(
      AudioObjectGetPropertyDataSize(
        deviceID,
        &address,
        0,
        nil,
        &propertySize
      ),
      operation: "read the system-audio input sources"
    )

    var tapList: CFArray?
    try check(
      withUnsafeMutablePointer(to: &tapList) { tapListPointer in
        AudioObjectGetPropertyData(
          deviceID,
          &address,
          0,
          nil,
          &propertySize,
          tapListPointer
        )
      },
      operation: "read the system-audio input sources"
    )

    var tapUIDs = tapList as? [CFString] ?? []
    let uid = tapUID as CFString
    if !tapUIDs.contains(uid) {
      tapUIDs.append(uid)
      propertySize += UInt32(MemoryLayout<CFString>.stride)
    }
    tapList = tapUIDs as CFArray
    try check(
      withUnsafeMutablePointer(to: &tapList) { tapListPointer in
        AudioObjectSetPropertyData(
          deviceID,
          &address,
          0,
          nil,
          propertySize,
          tapListPointer
        )
      },
      operation: "connect the system-audio tap"
    )
  }

  private func installFormatListener(on tapID: AudioObjectID) throws {
    var address = Self.propertyAddress(selector: kAudioTapPropertyFormat)
    let listener: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
      guard let self else { return }
      if let format = try? self.readTapFormat(tapID: tapID) {
        self.audioFormat = format
      }
    }
    try check(
      AudioObjectAddPropertyListenerBlock(
        tapID,
        &address,
        audioQueue,
        listener
      ),
      operation: "observe system-audio format changes"
    )
    formatListener = listener
  }

  private func removeFormatListener() {
    guard tapID != kAudioObjectUnknown, let formatListener else { return }
    var address = Self.propertyAddress(selector: kAudioTapPropertyFormat)
    _ = AudioObjectRemovePropertyListenerBlock(
      tapID,
      &address,
      audioQueue,
      formatListener
    )
    self.formatListener = nil
  }

  private func installDeviceAliveListener(on deviceID: AudioObjectID) throws {
    var address = Self.propertyAddress(selector: kAudioDevicePropertyDeviceIsAlive)
    let listener: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
      guard let self else { return }
      var currentAddress = Self.propertyAddress(
        selector: kAudioDevicePropertyDeviceIsAlive
      )
      var propertySize = UInt32(MemoryLayout<UInt32>.stride)
      var isAlive: UInt32 = 0
      let status = AudioObjectGetPropertyData(
        deviceID,
        &currentAddress,
        0,
        nil,
        &propertySize,
        &isAlive
      )
      guard status == kAudioHardwareNoError, isAlive != 0 else {
        self.failureHandler?(
          RecorderError.systemAudioCaptureFailed(
            "The system-audio input device stopped unexpectedly."
          )
        )
        return
      }
    }
    try check(
      AudioObjectAddPropertyListenerBlock(
        deviceID,
        &address,
        audioQueue,
        listener
      ),
      operation: "monitor the system-audio input device"
    )
    deviceAliveListener = listener
  }

  private func removeDeviceAliveListener() {
    guard aggregateDeviceID != kAudioObjectUnknown, let deviceAliveListener else {
      return
    }
    var address = Self.propertyAddress(selector: kAudioDevicePropertyDeviceIsAlive)
    _ = AudioObjectRemovePropertyListenerBlock(
      aggregateDeviceID,
      &address,
      audioQueue,
      deviceAliveListener
    )
    self.deviceAliveListener = nil
  }

  private func check(_ status: OSStatus, operation: String) throws {
    guard status != kAudioHardwareNoError else { return }
    if status == kAudioDevicePermissionsError {
      throw RecorderError.systemAudioPermissionDenied
    }
    let message = NSError(
      domain: NSOSStatusErrorDomain,
      code: Int(status)
    ).localizedDescription
    throw RecorderError.systemAudioCaptureFailed(
      "Could not \(operation): \(message) (\(status))."
    )
  }

  private static func propertyAddress(
    selector: AudioObjectPropertySelector,
    scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal,
    element: AudioObjectPropertyElement = kAudioObjectPropertyElementMain
  ) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(
      mSelector: selector,
      mScope: scope,
      mElement: element
    )
  }
}
