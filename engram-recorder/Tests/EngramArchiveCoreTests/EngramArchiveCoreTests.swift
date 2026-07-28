import Foundation
import Testing

@testable import EngramArchiveCore

@Test("Pre-OAuth recording archives decode without an account binding")
func legacyArchiveDecoding() throws {
  let data = Data(
    """
    [{
      "id":"00000000-0000-4000-8000-000000000001",
      "title":"Legacy recording",
      "startedAt":"2026-07-24T12:00:00Z",
      "durationSeconds":42,
      "audioFilename":"legacy.m4a",
      "uploadState":"failed"
    }]
    """.utf8
  )
  let decoder = JSONDecoder()
  decoder.dateDecodingStrategy = .iso8601
  let recordings = try decoder.decode([LocalRecording].self, from: data)

  #expect(recordings.count == 1)
  #expect(recordings[0].authBinding == nil)
  #expect(recordings[0].audioFilename == "legacy.m4a")
}

@Test("Recording bindings preserve the original server and connection")
func recordingBindingIsolation() {
  let original = RecordingAuthBinding(
    issuer: "https://first.example/api/auth",
    accountID: "account-1",
    connectionID: "connection-1"
  )
  let otherConnection = RecordingAuthBinding(
    issuer: "https://first.example/api/auth",
    accountID: "account-1",
    connectionID: "connection-2"
  )

  #expect(original.serverURL == URL(string: "https://first.example"))
  #expect(!original.matches(otherConnection))
  #expect(
    recordingMetadataRefreshAllowed(
      storedBinding: original,
      currentBinding: original
    )
  )
  #expect(
    !recordingMetadataRefreshAllowed(
      storedBinding: otherConnection,
      currentBinding: original
    )
  )
  #expect(
    recordingMetadataRefreshAllowed(
      storedBinding: nil,
      currentBinding: original
    )
  )
}
