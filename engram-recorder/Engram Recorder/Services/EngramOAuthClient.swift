import Foundation

struct OAuthServerMetadata: Decodable, Sendable {
  let issuer: URL
  let authorizationEndpoint: URL
  let tokenEndpoint: URL
  let revocationEndpoint: URL

  enum CodingKeys: String, CodingKey {
    case issuer
    case authorizationEndpoint = "authorization_endpoint"
    case tokenEndpoint = "token_endpoint"
    case revocationEndpoint = "revocation_endpoint"
  }
}

struct OAuthTokenResponse: Decodable, Sendable {
  let accessToken: String
  let tokenType: String
  let expiresIn: TimeInterval
  let refreshToken: String?
  let scope: String?

  enum CodingKeys: String, CodingKey {
    case accessToken = "access_token"
    case tokenType = "token_type"
    case expiresIn = "expires_in"
    case refreshToken = "refresh_token"
    case scope
  }
}

struct OAuthAccessIdentity: Decodable, Sendable {
  let subject: String
  let issuer: String
  let connectionID: String

  enum CodingKeys: String, CodingKey {
    case subject = "sub"
    case issuer = "iss"
    case connectionID = "connection_id"
  }

  static func decode(accessToken: String) throws -> OAuthAccessIdentity {
    let parts = accessToken.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 3 else { throw OAuthError.invalidToken }
    var payload = String(parts[1]).replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    payload += String(repeating: "=", count: (4 - payload.count % 4) % 4)
    guard let data = Data(base64Encoded: payload) else { throw OAuthError.invalidToken }
    return try JSONDecoder().decode(OAuthAccessIdentity.self, from: data)
  }
}

struct OAuthCallback {
  static func authorizationCode(from callback: URL, expectedState: String) throws -> String {
    guard callback.scheme == EngramOAuthClient.callbackURL.scheme,
      callback.host == EngramOAuthClient.callbackURL.host,
      callback.path == EngramOAuthClient.callbackURL.path,
      let components = URLComponents(url: callback, resolvingAgainstBaseURL: false)
    else { throw OAuthError.invalidCallback }
    let values: [String: String] = Dictionary(
      uniqueKeysWithValues: components.queryItems?.compactMap {
        guard let value = $0.value else { return nil }
        return ($0.name, value)
      } ?? []
    )
    guard values["state"] == expectedState else { throw OAuthError.stateMismatch }
    if let error = values["error"] {
      throw OAuthError.server(values["error_description"] ?? error)
    }
    guard let code = values["code"], !code.isEmpty else { throw OAuthError.invalidCallback }
    return code
  }
}

struct EngramOAuthClient: Sendable {
  static let clientID = "engram-macos"
  static let callbackURL = URL(string: "jeremys.engram.recorder://oauth/callback")!
  static let scopes = ["recordings:write", "recordings:delete-own", "offline_access"]

  private let session: URLSession

  init(session: URLSession = .shared) {
    self.session = session
  }

  func discover(serverURL: URL) async throws -> OAuthServerMetadata {
    let base = serverURL.engramBaseURL
    let endpoint =
      base
      .appendingPathComponent(".well-known", isDirectory: true)
      .appendingPathComponent("oauth-authorization-server", isDirectory: true)
      .appendingPathComponent("api", isDirectory: true)
      .appendingPathComponent("auth", isDirectory: false)
    let (data, response) = try await session.data(from: endpoint)
    try validateHTTP(response, data: data)
    let metadata = try JSONDecoder().decode(OAuthServerMetadata.self, from: data)
    try validate(metadata: metadata, for: base)
    return metadata
  }

  func authorizationURL(
    metadata: OAuthServerMetadata,
    serverURL: URL,
    state: String,
    challenge: String
  ) throws -> URL {
    var components = URLComponents(
      url: metadata.authorizationEndpoint, resolvingAgainstBaseURL: false)
    components?.queryItems = [
      URLQueryItem(name: "response_type", value: "code"),
      URLQueryItem(name: "client_id", value: Self.clientID),
      URLQueryItem(name: "redirect_uri", value: Self.callbackURL.absoluteString),
      URLQueryItem(name: "scope", value: Self.scopes.joined(separator: " ")),
      URLQueryItem(
        name: "resource",
        value: serverURL.engramBaseURL.appendingPathComponent("api").absoluteString),
      URLQueryItem(name: "state", value: state),
      URLQueryItem(name: "code_challenge", value: challenge),
      URLQueryItem(name: "code_challenge_method", value: "S256"),
    ]
    guard let url = components?.url else { throw OAuthError.invalidServerMetadata }
    return url
  }

  func exchange(
    code: String,
    verifier: String,
    metadata: OAuthServerMetadata,
    serverURL: URL
  ) async throws -> OAuthTokenResponse {
    try await tokenRequest(
      endpoint: metadata.tokenEndpoint,
      fields: [
        "grant_type": "authorization_code",
        "client_id": Self.clientID,
        "code": code,
        "code_verifier": verifier,
        "redirect_uri": Self.callbackURL.absoluteString,
        "resource": serverURL.engramBaseURL.appendingPathComponent("api").absoluteString,
      ]
    )
  }

  func refresh(
    _ refreshToken: String,
    metadata: OAuthServerMetadata,
    serverURL: URL
  ) async throws -> OAuthTokenResponse {
    try await tokenRequest(
      endpoint: metadata.tokenEndpoint,
      fields: [
        "grant_type": "refresh_token",
        "client_id": Self.clientID,
        "refresh_token": refreshToken,
        "resource": serverURL.engramBaseURL.appendingPathComponent("api").absoluteString,
      ]
    )
  }

  func revoke(_ refreshToken: String, metadata: OAuthServerMetadata) async throws {
    var request = URLRequest(url: metadata.revocationEndpoint)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    request.httpBody = formData([
      "client_id": Self.clientID,
      "token": refreshToken,
      "token_type_hint": "refresh_token",
    ])
    let (data, response) = try await session.data(for: request)
    try validateHTTP(response, data: data)
  }

  func revokeConnection(accessToken: String, serverURL: URL) async throws {
    let endpoint =
      serverURL.engramBaseURL
      .appendingPathComponent("api", isDirectory: true)
      .appendingPathComponent("auth", isDirectory: true)
      .appendingPathComponent("connections", isDirectory: true)
      .appendingPathComponent("current", isDirectory: true)
      .appendingPathComponent("revoke", isDirectory: false)
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
    let (data, response) = try await session.data(for: request)
    try validateHTTP(response, data: data)
  }

  private func tokenRequest(endpoint: URL, fields: [String: String]) async throws
    -> OAuthTokenResponse
  {
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    request.httpBody = formData(fields)
    let (data, response) = try await session.data(for: request)
    try validateHTTP(response, data: data)
    let token = try JSONDecoder().decode(OAuthTokenResponse.self, from: data)
    guard token.tokenType.caseInsensitiveCompare("Bearer") == .orderedSame,
      token.expiresIn > 0
    else { throw OAuthError.invalidToken }
    return token
  }

  private func validate(metadata: OAuthServerMetadata, for base: URL) throws {
    let expectedIssuer = base.appendingPathComponent("api/auth").absoluteString
    guard metadata.issuer.absoluteString == expectedIssuer else {
      throw OAuthError.invalidServerMetadata
    }
    for endpoint in [
      metadata.authorizationEndpoint, metadata.tokenEndpoint, metadata.revocationEndpoint,
    ] {
      guard endpoint.scheme == base.scheme, endpoint.host == base.host, endpoint.port == base.port
      else {
        throw OAuthError.invalidServerMetadata
      }
    }
  }

  private func validateHTTP(_ response: URLResponse, data: Data) throws {
    guard let http = response as? HTTPURLResponse else { throw OAuthError.invalidResponse }
    guard (200..<300).contains(http.statusCode) else {
      let body = try? JSONDecoder().decode(OAuthErrorBody.self, from: data)
      throw OAuthError.server(body?.errorDescription ?? body?.error ?? "HTTP \(http.statusCode)")
    }
  }

  private func formData(_ fields: [String: String]) -> Data {
    var components = URLComponents()
    components.queryItems = fields.sorted { $0.key < $1.key }.map(URLQueryItem.init)
    return Data((components.percentEncodedQuery ?? "").utf8)
  }
}

private struct OAuthErrorBody: Decodable {
  let error: String?
  let errorDescription: String?

  enum CodingKeys: String, CodingKey {
    case error
    case errorDescription = "error_description"
  }
}

enum OAuthError: LocalizedError, Equatable {
  case randomnessUnavailable
  case invalidServerURL
  case invalidServerMetadata
  case invalidResponse
  case invalidCallback
  case stateMismatch
  case invalidToken
  case notSignedIn
  case credentialBelongsToAnotherAccount
  case cancelled
  case server(String)

  var errorDescription: String? {
    switch self {
    case .randomnessUnavailable: "macOS could not create secure login values."
    case .invalidServerURL: "Use an HTTPS Engram URL. Debug builds also allow localhost HTTP."
    case .invalidServerMetadata:
      "That server does not advertise a valid Engram OAuth configuration."
    case .invalidResponse: "Engram returned an invalid authentication response."
    case .invalidCallback: "Engram returned an incomplete sign-in callback."
    case .stateMismatch: "The sign-in response did not match this Mac's request. Please try again."
    case .invalidToken: "Engram returned an invalid access credential."
    case .notSignedIn: "Sign in to Engram in Settings first."
    case .credentialBelongsToAnotherAccount: "This recording is attached to another Engram sign-in."
    case .cancelled: "Sign in was cancelled."
    case .server(let message): message
    }
  }
}

extension URL {
  var engramBaseURL: URL {
    var components = URLComponents(url: self, resolvingAgainstBaseURL: false)!
    components.path = components.path.replacingOccurrences(
      of: #"/+$"#, with: "", options: .regularExpression)
    components.query = nil
    components.fragment = nil
    return components.url!
  }

  var isAllowedEngramServer: Bool {
    guard host != nil else { return false }
    if scheme?.lowercased() == "https" { return true }
    #if DEBUG
      return scheme?.lowercased() == "http"
        && ["localhost", "127.0.0.1", "::1"].contains(host!.lowercased())
    #else
      return false
    #endif
  }
}
