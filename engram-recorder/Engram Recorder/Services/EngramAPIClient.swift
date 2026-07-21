import Foundation

actor EngramAPIClient {
  private let session: URLSession

  init() {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.waitsForConnectivity = true
    configuration.timeoutIntervalForRequest = 120
    configuration.timeoutIntervalForResource = 30 * 60
    session = URLSession(configuration: configuration)
  }

  func upload(
    recording: LocalRecording,
    serverURL: URL,
    token: String
  ) async throws -> UploadResult {
    let endpoint =
      serverURL
      .appendingPathComponent("api", isDirectory: true)
      .appendingPathComponent("recordings", isDirectory: false)
    let boundary = "EngramBoundary-\(UUID().uuidString)"
    let multipartURL = FileManager.default.temporaryDirectory
      .appendingPathComponent("\(UUID().uuidString).multipart", isDirectory: false)
    defer { try? FileManager.default.removeItem(at: multipartURL) }

    try buildMultipartFile(
      at: multipartURL,
      boundary: boundary,
      recording: recording
    )

    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue(
      "multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

    let (data, response) = try await session.upload(for: request, fromFile: multipartURL)
    guard let http = response as? HTTPURLResponse else {
      throw APIError.invalidResponse
    }
    guard (200..<300).contains(http.statusCode) else {
      let message = (try? JSONDecoder().decode(APIErrorBody.self, from: data).error)
      throw APIError.server(status: http.statusCode, message: message)
    }
    return try JSONDecoder().decode(UploadResult.self, from: data)
  }

  func deleteRecording(
    remoteID: String,
    serverURL: URL,
    token: String
  ) async throws {
    let endpoint =
      serverURL
      .appendingPathComponent("api", isDirectory: true)
      .appendingPathComponent("recordings", isDirectory: true)
      .appendingPathComponent(remoteID, isDirectory: false)

    var request = URLRequest(url: endpoint)
    request.httpMethod = "DELETE"
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else {
      throw APIError.invalidResponse
    }
    // A missing remote recording already satisfies the requested end state.
    if http.statusCode == 404 { return }
    guard (200..<300).contains(http.statusCode) else {
      let message = (try? JSONDecoder().decode(APIErrorBody.self, from: data).error)
      throw APIError.server(status: http.statusCode, message: message)
    }
  }

  private func buildMultipartFile(
    at destination: URL,
    boundary: String,
    recording: LocalRecording
  ) throws {
    FileManager.default.createFile(atPath: destination.path, contents: nil)
    let output = try FileHandle(forWritingTo: destination)
    defer { try? output.close() }

    try writeField("source", value: "mac", boundary: boundary, to: output)
    try writeField("title", value: recording.title, boundary: boundary, to: output)
    try writeField(
      "durationSeconds",
      value: String(recording.durationSeconds),
      boundary: boundary,
      to: output
    )
    try writeField(
      "startedAt",
      value: ISO8601DateFormatter.engram.string(from: recording.startedAt),
      boundary: boundary,
      to: output
    )

    let fileHeader =
      "--\(boundary)\r\n"
      + "Content-Disposition: form-data; name=\"file\"; filename=\"recording.m4a\"\r\n"
      + "Content-Type: audio/mp4\r\n\r\n"
    try output.write(contentsOf: Data(fileHeader.utf8))

    let input = try FileHandle(forReadingFrom: recording.audioURL)
    defer { try? input.close() }
    while let chunk = try input.read(upToCount: 1_048_576), !chunk.isEmpty {
      try output.write(contentsOf: chunk)
    }
    try output.write(contentsOf: Data("\r\n--\(boundary)--\r\n".utf8))
  }

  private func writeField(
    _ name: String,
    value: String,
    boundary: String,
    to output: FileHandle
  ) throws {
    let header =
      "--\(boundary)\r\n" + "Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n"
      + "\(value)\r\n"
    try output.write(contentsOf: Data(header.utf8))
  }
}

private struct APIErrorBody: Decodable {
  let error: String
}

private enum APIError: LocalizedError {
  case invalidResponse
  case server(status: Int, message: String?)

  var errorDescription: String? {
    switch self {
    case .invalidResponse:
      "Engram returned an invalid response."
    case .server(let status, let message):
      message ?? "Engram request failed with HTTP \(status)."
    }
  }
}

extension ISO8601DateFormatter {
  fileprivate static let engram: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()
}
