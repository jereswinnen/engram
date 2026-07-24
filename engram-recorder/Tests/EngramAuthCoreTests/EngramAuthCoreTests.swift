import Foundation
import Testing

@testable import EngramAuthCore

@Test("PKCE matches the RFC 7636 S256 example")
func pkceRFCExample() {
  let pair = PKCEPair.fromVerifier(
    "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
  )
  #expect(pair.challenge == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
}

@Test("Authorization requests bind the Mac client to the API resource")
func authorizationRequest() throws {
  let base = URL(string: "https://engram.example")!
  let metadata = OAuthServerMetadata(
    issuer: URL(string: "https://engram.example/api/auth")!,
    authorizationEndpoint: URL(string: "https://engram.example/api/auth/oauth2/authorize")!,
    tokenEndpoint: URL(string: "https://engram.example/api/auth/oauth2/token")!,
    revocationEndpoint: URL(string: "https://engram.example/api/auth/oauth2/revoke")!
  )
  let url = try EngramOAuthClient().authorizationURL(
    metadata: metadata,
    serverURL: base,
    state: "state-value",
    challenge: "challenge-value"
  )
  let items = Dictionary(
    uniqueKeysWithValues: URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!.map {
      ($0.name, $0.value!)
    })

  #expect(items["client_id"] == "engram-macos")
  #expect(items["redirect_uri"] == "jeremys.engram.recorder://oauth/callback")
  #expect(items["resource"] == "https://engram.example/api")
  #expect(items["code_challenge_method"] == "S256")
  #expect(items["scope"] == "recordings:write recordings:delete-own offline_access")
}

@Test("Access-token identity extracts the account and connection binding")
func accessIdentity() throws {
  let payload = try JSONSerialization.data(withJSONObject: [
    "sub": "user-123",
    "iss": "https://engram.example/api/auth",
    "connection_id": "connection-456",
  ])
  let encoded = payload.base64EncodedString()
    .replacingOccurrences(of: "+", with: "-")
    .replacingOccurrences(of: "/", with: "_")
    .replacingOccurrences(of: "=", with: "")
  let identity = try OAuthAccessIdentity.decode(accessToken: "header.\(encoded).signature")

  #expect(identity.subject == "user-123")
  #expect(identity.connectionID == "connection-456")
}

@Test("OAuth callback requires the original state and exact callback URL")
func callbackValidation() throws {
  let valid = URL(string: "jeremys.engram.recorder://oauth/callback?code=abc&state=expected")!
  #expect(try OAuthCallback.authorizationCode(from: valid, expectedState: "expected") == "abc")

  #expect(throws: OAuthError.stateMismatch) {
    try OAuthCallback.authorizationCode(from: valid, expectedState: "different")
  }
  #expect(throws: OAuthError.invalidCallback) {
    try OAuthCallback.authorizationCode(
      from: URL(string: "jeremys.engram.recorder://other/callback?code=abc&state=expected")!,
      expectedState: "expected"
    )
  }
}

@Test("Concurrent callers share one rotating refresh and persist it first")
func concurrentRefresh() async throws {
  MockOAuthURLProtocol.state.reset()
  let configuration = URLSessionConfiguration.ephemeral
  configuration.protocolClasses = [MockOAuthURLProtocol.self]
  let client = EngramOAuthClient(session: URLSession(configuration: configuration))
  let initial = StoredOAuthCredential(
    issuer: "https://engram.example/api/auth",
    accountID: "user-123",
    connectionID: "connection-456",
    clientID: EngramOAuthClient.clientID,
    refreshToken: "initial-refresh"
  )
  let store = MemoryCredentialStore(initial)
  let auth = EngramAuthSession(oauthClient: client, credentialStore: store)
  let server = URL(string: "https://engram.example")!
  _ = try await auth.restore(serverURL: server)

  async let first = auth.accessToken(for: server)
  async let second = auth.accessToken(for: server)
  let values = try await [first, second]

  #expect(values[0] == values[1])
  #expect(MockOAuthURLProtocol.state.tokenRequests == 1)
  #expect(store.current?.refreshToken == "rotated-refresh")
}

private final class MemoryCredentialStore: OAuthCredentialStoring, @unchecked Sendable {
  private let lock = NSLock()
  private var value: StoredOAuthCredential?

  init(_ value: StoredOAuthCredential?) { self.value = value }

  var current: StoredOAuthCredential? {
    lock.withLock { value }
  }

  func read(issuer: URL) -> StoredOAuthCredential? {
    lock.withLock { value?.issuer == issuer.absoluteString ? value : nil }
  }

  func save(_ credential: StoredOAuthCredential) throws {
    lock.withLock { value = credential }
  }

  func delete(_ credential: StoredOAuthCredential) throws {
    lock.withLock { value = nil }
  }
}

private final class MockOAuthState: @unchecked Sendable {
  private let lock = NSLock()
  private var count = 0

  var tokenRequests: Int { lock.withLock { count } }
  func increment() { lock.withLock { count += 1 } }
  func reset() { lock.withLock { count = 0 } }
}

private final class MockOAuthURLProtocol: URLProtocol, @unchecked Sendable {
  static let state = MockOAuthState()

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    let url = request.url!
    let data: Data
    if url.path.contains(".well-known") {
      data = Data(
        """
        {
          "issuer":"https://engram.example/api/auth",
          "authorization_endpoint":"https://engram.example/api/auth/oauth2/authorize",
          "token_endpoint":"https://engram.example/api/auth/oauth2/token",
          "revocation_endpoint":"https://engram.example/api/auth/oauth2/revoke"
        }
        """.utf8
      )
    } else {
      Self.state.increment()
      Thread.sleep(forTimeInterval: 0.05)
      let token = makeAccessToken()
      data = Data(
        """
        {"access_token":"\(token)","token_type":"Bearer","expires_in":900,"refresh_token":"rotated-refresh"}
        """.utf8
      )
    }
    client?.urlProtocol(
      self,
      didReceive: HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!,
      cacheStoragePolicy: .notAllowed
    )
    client?.urlProtocol(self, didLoad: data)
    client?.urlProtocolDidFinishLoading(self)
  }

  override func stopLoading() {}

  private func makeAccessToken() -> String {
    let payload = try! JSONSerialization.data(withJSONObject: [
      "sub": "user-123",
      "iss": "https://engram.example/api/auth",
      "connection_id": "connection-456",
    ])
    let encoded = payload.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
    return "header.\(encoded).signature"
  }
}

@Suite(.serialized)
struct APIClientRetryTests {
  @Test("Engram API retries one 401 with a forced refresh")
  func retriesOneUnauthorizedResponse() async throws {
    MockAPIURLProtocol.state.reset([401, 204])
    let tokens = StubAccessTokens()
    let client = EngramAPIClient(authSession: tokens, session: makeAPISession())

    try await client.deleteRecording(
      remoteID: "recording-1",
      serverURL: URL(string: "https://engram.example")!
    )

    #expect(await tokens.forcedRefreshes == [false, true])
    #expect(MockAPIURLProtocol.state.requestCount == 2)
  }

  @Test("Engram API never retries a 403 as authentication failure")
  func doesNotRetryForbiddenResponse() async {
    MockAPIURLProtocol.state.reset([403])
    let tokens = StubAccessTokens()
    let client = EngramAPIClient(authSession: tokens, session: makeAPISession())

    do {
      try await client.deleteRecording(
        remoteID: "recording-1",
        serverURL: URL(string: "https://engram.example")!
      )
      Issue.record("Expected the forbidden response to fail")
    } catch {}

    #expect(await tokens.forcedRefreshes == [false])
    #expect(MockAPIURLProtocol.state.requestCount == 1)
  }

  @Test("Mac disconnect revokes the current authenticated connection")
  func revokesCurrentConnection() async throws {
    MockAPIURLProtocol.state.reset([200])
    let client = EngramOAuthClient(session: makeAPISession())

    try await client.revokeConnection(
      accessToken: "mac-access-token",
      serverURL: URL(string: "https://engram.example")!
    )

    #expect(MockAPIURLProtocol.state.lastMethod == "POST")
    #expect(
      MockAPIURLProtocol.state.lastPath == "/api/auth/connections/current/revoke"
    )
    #expect(MockAPIURLProtocol.state.lastAuthorization == "Bearer mac-access-token")
  }

  private func makeAPISession() -> URLSession {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [MockAPIURLProtocol.self]
    return URLSession(configuration: configuration)
  }
}

private actor StubAccessTokens: EngramAccessTokenProviding {
  private(set) var forcedRefreshes: [Bool] = []

  func accessToken(for serverURL: URL, forceRefresh: Bool) async throws -> String {
    forcedRefreshes.append(forceRefresh)
    return forceRefresh ? "refreshed-token" : "initial-token"
  }
}

private final class MockAPIState: @unchecked Sendable {
  private let lock = NSLock()
  private var statuses: [Int] = []
  private var requests = 0
  private var method: String?
  private var path: String?
  private var authorization: String?

  var requestCount: Int { lock.withLock { requests } }
  var lastMethod: String? { lock.withLock { method } }
  var lastPath: String? { lock.withLock { path } }
  var lastAuthorization: String? { lock.withLock { authorization } }

  func reset(_ statuses: [Int]) {
    lock.withLock {
      self.statuses = statuses
      requests = 0
      method = nil
      path = nil
      authorization = nil
    }
  }

  func nextStatus(for request: URLRequest) -> Int {
    lock.withLock {
      requests += 1
      method = request.httpMethod
      path = request.url?.path
      authorization = request.value(forHTTPHeaderField: "Authorization")
      return statuses.removeFirst()
    }
  }
}

private final class MockAPIURLProtocol: URLProtocol, @unchecked Sendable {
  static let state = MockAPIState()

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    let status = Self.state.nextStatus(for: request)
    let data = status == 403 ? Data(#"{"error":"insufficient_scope"}"#.utf8) : Data()
    client?.urlProtocol(
      self,
      didReceive: HTTPURLResponse(
        url: request.url!,
        statusCode: status,
        httpVersion: nil,
        headerFields: nil
      )!,
      cacheStoragePolicy: .notAllowed
    )
    client?.urlProtocol(self, didLoad: data)
    client?.urlProtocolDidFinishLoading(self)
  }

  override func stopLoading() {}
}
