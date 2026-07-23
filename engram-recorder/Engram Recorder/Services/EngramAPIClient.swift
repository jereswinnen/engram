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
    let fileValues = try recording.audioURL.resourceValues(forKeys: [.fileSizeKey])
    guard let byteCount = fileValues.fileSize, byteCount > 0 else {
      throw APIError.emptyFile
    }

    let initiateEndpoint =
      recordingsEndpoint(serverURL: serverURL)
      .appendingPathComponent("initiate", isDirectory: false)
    let initiateBody = InitiateUploadBody(
      id: recording.id.uuidString.lowercased(),
      title: recording.title,
      durationSeconds: recording.durationSeconds,
      startedAt: ISO8601DateFormatter.engram.string(from: recording.startedAt),
      byteCount: byteCount
    )
    let initiateData = try await sendJSON(
      initiateBody,
      to: initiateEndpoint,
      token: token
    )
    let initiation = try JSONDecoder().decode(InitiateUploadResponse.self, from: initiateData)

    if !initiation.completed, let upload = initiation.upload {
      guard let uploadURL = URL(string: upload.url) else {
        throw APIError.invalidResponse
      }
      var uploadRequest = URLRequest(url: uploadURL)
      uploadRequest.httpMethod = "PUT"
      for (name, value) in upload.headers {
        uploadRequest.setValue(value, forHTTPHeaderField: name)
      }

      let (data, response) = try await session.upload(
        for: uploadRequest,
        fromFile: recording.audioURL
      )
      try validate(response: response, data: data, service: "Audio storage")
    }

    if initiation.completed {
      return UploadResult(id: initiation.id, url: initiation.url)
    }

    let completeEndpoint =
      recordingsEndpoint(serverURL: serverURL)
      .appendingPathComponent(initiation.id, isDirectory: true)
      .appendingPathComponent("complete", isDirectory: false)
    let completeData = try await sendJSON(
      CompleteUploadBody(byteCount: byteCount),
      to: completeEndpoint,
      token: token
    )
    return try JSONDecoder().decode(UploadResult.self, from: completeData)
  }

  func deleteRecording(
    remoteID: String,
    serverURL: URL,
    token: String
  ) async throws {
    let endpoint =
      recordingsEndpoint(serverURL: serverURL)
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
      throw APIError.server(service: "Engram", status: http.statusCode, message: message)
    }
  }

  private func recordingsEndpoint(serverURL: URL) -> URL {
    serverURL
      .appendingPathComponent("api", isDirectory: true)
      .appendingPathComponent("recordings", isDirectory: true)
  }

  private func sendJSON<Body: Encodable>(
    _ body: Body,
    to endpoint: URL,
    token: String
  ) async throws -> Data {
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(body)

    let (data, response) = try await session.data(for: request)
    try validate(response: response, data: data, service: "Engram")
    return data
  }

  private func validate(
    response: URLResponse,
    data: Data,
    service: String
  ) throws {
    guard let http = response as? HTTPURLResponse else {
      throw APIError.invalidResponse
    }
    guard (200..<300).contains(http.statusCode) else {
      let message = (try? JSONDecoder().decode(APIErrorBody.self, from: data).error)
      throw APIError.server(service: service, status: http.statusCode, message: message)
    }
  }
}

private struct InitiateUploadBody: Encodable {
  let id: String
  let title: String
  let durationSeconds: Int
  let startedAt: String
  let byteCount: Int
}

private struct CompleteUploadBody: Encodable {
  let byteCount: Int
}

private struct InitiateUploadResponse: Decodable {
  struct Upload: Decodable {
    let url: String
    let headers: [String: String]
  }

  let id: String
  let url: String
  let completed: Bool
  let upload: Upload?
}

private struct APIErrorBody: Decodable {
  let error: String
}

private enum APIError: LocalizedError {
  case emptyFile
  case invalidResponse
  case server(service: String, status: Int, message: String?)

  var errorDescription: String? {
    switch self {
    case .emptyFile:
      "The local audio file is empty."
    case .invalidResponse:
      "Engram returned an invalid response."
    case .server(let service, let status, let message):
      message ?? "\(service) request failed with HTTP \(status)."
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
