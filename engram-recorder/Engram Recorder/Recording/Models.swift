import Foundation

enum RecorderPhase: Equatable {
  case idle
  case preparing
  case recording
  case finalizing
  case savedLocally
  case failure(String)

  var isBusy: Bool {
    switch self {
    case .preparing, .recording, .finalizing:
      true
    case .idle, .savedLocally, .failure:
      false
    }
  }
}

public struct LocalRecording: Codable, Identifiable, Equatable, Sendable {
  public enum UploadState: String, Codable, Sendable {
    case local
    case uploading
    case uploaded
    case failed
  }

  public let id: UUID
  public var title: String
  public let startedAt: Date
  public var durationSeconds: Int
  public let audioFilename: String
  public var uploadState: UploadState
  public var remoteID: String?
  public var remotePath: String?
  public var uploadedAt: Date?
  public var lastError: String?
  public var authBinding: RecordingAuthBinding?

  public var audioURL: URL {
    RecordingArchive.recordingsDirectory
      .appendingPathComponent(audioFilename, isDirectory: false)
  }
}

public struct RecordingAuthBinding: Codable, Equatable, Sendable {
  public let issuer: String
  public let accountID: String
  public let connectionID: String

  func matches(_ other: RecordingAuthBinding?) -> Bool {
    self == other
  }

  var serverURL: URL? {
    guard var components = URLComponents(string: issuer),
      components.path.hasSuffix("/api/auth")
    else { return nil }
    components.path.removeLast("/api/auth".count)
    return components.url
  }
}

public func recordingMetadataRefreshAllowed(
  storedBinding: RecordingAuthBinding?,
  currentBinding: RecordingAuthBinding
) -> Bool {
  storedBinding == nil || storedBinding?.matches(currentBinding) == true
}

public struct UploadResult: Decodable, Sendable {
  public let id: String
  public let url: String

  public init(id: String, url: String) {
    self.id = id
    self.url = url
  }
}

public struct RemoteRecordingMetadata: Decodable, Sendable {
  public let id: String
  public let title: String
  public let titleOrigin: String
  public let status: String

  public init(id: String, title: String, titleOrigin: String, status: String) {
    self.id = id
    self.title = title
    self.titleOrigin = titleOrigin
    self.status = status
  }
}

enum RecorderError: LocalizedError {
  case settingsIncomplete
  case microphonePermissionDenied
  case screenRecordingPermissionDenied
  case noDisplayAvailable
  case invalidAudioFormat
  case audioWriteFailed(String)
  case noAudioCaptured
  case noActiveRecording

  var errorDescription: String? {
    switch self {
    case .settingsIncomplete:
      "Add your Engram URL and sign in from Settings first."
    case .microphonePermissionDenied:
      "Microphone access is required. Enable Engram in System Settings → Privacy & Security → Microphone."
    case .screenRecordingPermissionDenied:
      "Screen Recording access is required to capture meeting audio. Enable Engram in System Settings → Privacy & Security → Screen & System Audio Recording."
    case .noDisplayAvailable:
      "No display is available for system-audio capture."
    case .invalidAudioFormat:
      "The current audio devices could not provide a recordable format."
    case .audioWriteFailed(let message):
      "The local audio file could not be completed: \(message)"
    case .noAudioCaptured:
      "No audio frames were captured. The recording was not saved."
    case .noActiveRecording:
      "There is no active recording to stop."
    }
  }
}
