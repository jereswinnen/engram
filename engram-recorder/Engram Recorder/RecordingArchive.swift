import Foundation

actor RecordingArchive {
  static let rootDirectory: URL = {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    return base.appendingPathComponent("Engram Recorder", isDirectory: true)
  }()

  static let recordingsDirectory = rootDirectory.appendingPathComponent(
    "Recordings", isDirectory: true)
  private static let indexURL = rootDirectory.appendingPathComponent(
    "recordings.json", isDirectory: false)

  init() {}

  private func prepareDirectory() throws {
    try FileManager.default.createDirectory(
      at: Self.recordingsDirectory,
      withIntermediateDirectories: true
    )
  }

  func load() throws -> [LocalRecording] {
    try prepareDirectory()
    guard FileManager.default.fileExists(atPath: Self.indexURL.path) else { return [] }
    let data = try Data(contentsOf: Self.indexURL)
    return try JSONDecoder.engram.decode([LocalRecording].self, from: data)
  }

  func save(_ recordings: [LocalRecording]) throws {
    try prepareDirectory()
    let data = try JSONEncoder.engram.encode(recordings)
    try data.write(to: Self.indexURL, options: .atomic)
  }

  func audioURL(for id: UUID) throws -> URL {
    try prepareDirectory()
    return Self.recordingsDirectory.appendingPathComponent(
      "\(id.uuidString).m4a",
      isDirectory: false
    )
  }

  func deleteAudio(for recording: LocalRecording) throws {
    guard FileManager.default.fileExists(atPath: recording.audioURL.path) else { return }
    try FileManager.default.removeItem(at: recording.audioURL)
  }
}

extension JSONEncoder {
  fileprivate static let engram: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    return encoder
  }()
}

extension JSONDecoder {
  fileprivate static let engram: JSONDecoder = {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return decoder
  }()
}
