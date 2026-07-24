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

struct LocalRecording: Codable, Identifiable, Equatable, Sendable {
  enum UploadState: String, Codable, Sendable {
    case local
    case uploading
    case uploaded
    case failed
  }

  let id: UUID
  var title: String
  let startedAt: Date
  var durationSeconds: Int
  let audioFilename: String
  var uploadState: UploadState
  var remoteID: String?
  var remotePath: String?
  var uploadedAt: Date?
  var lastError: String?

  var audioURL: URL {
    RecordingArchive.recordingsDirectory
      .appendingPathComponent(audioFilename, isDirectory: false)
  }
}

struct UploadResult: Decodable, Sendable {
  let id: String
  let url: String
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
      "Add your Engram URL and recorder token in Settings first."
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
