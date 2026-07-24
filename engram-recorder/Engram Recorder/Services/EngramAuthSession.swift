import AppKit
import AuthenticationServices
import Foundation

struct EngramAccount: Equatable, Sendable {
  let issuer: URL
  let accountID: String
  let connectionID: String

  var displayName: String { "Account \(accountID.prefix(8))" }
}

private struct MemoryAccessToken: Sendable {
  let value: String
  let expiresAt: Date

  var isUsable: Bool { expiresAt.timeIntervalSinceNow > 60 }
}

protocol EngramAccessTokenProviding: Sendable {
  func accessToken(for serverURL: URL, forceRefresh: Bool) async throws -> String
}

actor EngramAuthSession: EngramAccessTokenProviding {
  private let oauthClient: EngramOAuthClient
  private let credentialStore: any OAuthCredentialStoring
  private var account: EngramAccount?
  private var credential: StoredOAuthCredential?
  private var accessToken: MemoryAccessToken?
  private var metadata: OAuthServerMetadata?
  private var refreshTask:
    Task<(OAuthServerMetadata, StoredOAuthCredential, MemoryAccessToken), Error>?

  init(
    oauthClient: EngramOAuthClient = EngramOAuthClient(),
    credentialStore: any OAuthCredentialStoring = SystemOAuthCredentialStore()
  ) {
    self.oauthClient = oauthClient
    self.credentialStore = credentialStore
  }

  func restore(serverURL: URL) async throws -> EngramAccount? {
    try validate(serverURL)
    let issuer = serverURL.engramBaseURL.appendingPathComponent("api/auth")
    guard let stored = credentialStore.read(issuer: issuer) else {
      clearMemory()
      return nil
    }
    let restored = EngramAccount(
      issuer: issuer,
      accountID: stored.accountID,
      connectionID: stored.connectionID
    )
    credential = stored
    account = restored
    accessToken = nil
    metadata = nil
    return restored
  }

  func signIn(serverURL: URL) async throws -> EngramAccount {
    try validate(serverURL)
    let metadata = try await oauthClient.discover(serverURL: serverURL)
    let pkce = try PKCEPair.generate()
    let state = try PKCEPair.randomState()
    let authorizationURL = try oauthClient.authorizationURL(
      metadata: metadata,
      serverURL: serverURL,
      state: state,
      challenge: pkce.challenge
    )
    let callback = try await OAuthBrowserSession.start(authorizationURL: authorizationURL)
    let code = try OAuthCallback.authorizationCode(from: callback, expectedState: state)
    let token = try await oauthClient.exchange(
      code: code,
      verifier: pkce.verifier,
      metadata: metadata,
      serverURL: serverURL
    )
    guard let refreshToken = token.refreshToken else { throw OAuthError.invalidToken }
    let identity = try OAuthAccessIdentity.decode(accessToken: token.accessToken)
    guard identity.issuer == metadata.issuer.absoluteString else { throw OAuthError.invalidToken }
    let stored = StoredOAuthCredential(
      issuer: metadata.issuer.absoluteString,
      accountID: identity.subject,
      connectionID: identity.connectionID,
      clientID: EngramOAuthClient.clientID,
      refreshToken: refreshToken
    )
    try credentialStore.save(stored)
    let signedIn = EngramAccount(
      issuer: metadata.issuer,
      accountID: identity.subject,
      connectionID: identity.connectionID
    )
    credential = stored
    account = signedIn
    accessToken = MemoryAccessToken(
      value: token.accessToken,
      expiresAt: Date().addingTimeInterval(token.expiresIn)
    )
    self.metadata = metadata
    return signedIn
  }

  func accessToken(for serverURL: URL, forceRefresh: Bool = false) async throws -> String {
    try validate(serverURL)
    let expectedIssuer = serverURL.engramBaseURL.appendingPathComponent("api/auth")
    if account?.issuer != expectedIssuer {
      _ = try await restore(serverURL: serverURL)
    }
    guard let credential, account != nil else { throw OAuthError.notSignedIn }
    if !forceRefresh, let accessToken, accessToken.isUsable { return accessToken.value }
    if let refreshTask {
      let result = try await refreshTask.value
      return result.2.value
    }

    let client = oauthClient
    let cachedMetadata = metadata
    let task = Task {
      let metadata: OAuthServerMetadata
      if let cachedMetadata {
        metadata = cachedMetadata
      } else {
        metadata = try await client.discover(serverURL: serverURL)
      }
      let response = try await client.refresh(
        credential.refreshToken,
        metadata: metadata,
        serverURL: serverURL
      )
      let identity = try OAuthAccessIdentity.decode(accessToken: response.accessToken)
      guard identity.issuer == credential.issuer,
        identity.subject == credential.accountID,
        identity.connectionID == credential.connectionID
      else { throw OAuthError.credentialBelongsToAnotherAccount }
      let rotated = StoredOAuthCredential(
        issuer: credential.issuer,
        accountID: credential.accountID,
        connectionID: credential.connectionID,
        clientID: credential.clientID,
        refreshToken: response.refreshToken ?? credential.refreshToken
      )
      // Persist rotation before publishing the new in-memory access token.
      try credentialStore.save(rotated)
      return (
        metadata,
        rotated,
        MemoryAccessToken(
          value: response.accessToken,
          expiresAt: Date().addingTimeInterval(response.expiresIn)
        )
      )
    }
    refreshTask = task
    do {
      let result = try await task.value
      metadata = result.0
      self.credential = result.1
      accessToken = result.2
      refreshTask = nil
      return result.2.value
    } catch {
      refreshTask = nil
      throw error
    }
  }

  func disconnect(serverURL: URL) async throws {
    guard let credential else { throw OAuthError.notSignedIn }
    let metadata = try await resolvedMetadata(serverURL: serverURL)
    try await oauthClient.revoke(credential.refreshToken, metadata: metadata)
    try credentialStore.delete(credential)
    clearMemory()
  }

  func signOutLocally() throws {
    if let credential { try credentialStore.delete(credential) }
    clearMemory()
  }

  private func resolvedMetadata(serverURL: URL) async throws -> OAuthServerMetadata {
    if let metadata { return metadata }
    let discovered = try await oauthClient.discover(serverURL: serverURL)
    metadata = discovered
    return discovered
  }

  private func validate(_ serverURL: URL) throws {
    guard serverURL.isAllowedEngramServer else { throw OAuthError.invalidServerURL }
  }

  private func clearMemory() {
    account = nil
    credential = nil
    accessToken = nil
    metadata = nil
    refreshTask?.cancel()
    refreshTask = nil
  }
}

@MainActor
private final class OAuthBrowserSession: NSObject, ASWebAuthenticationPresentationContextProviding {
  private var session: ASWebAuthenticationSession?

  static func start(authorizationURL: URL) async throws -> URL {
    let flow = OAuthBrowserSession()
    return try await flow.start(authorizationURL: authorizationURL)
  }

  private func start(authorizationURL: URL) async throws -> URL {
    try await withCheckedThrowingContinuation { continuation in
      let session = ASWebAuthenticationSession(
        url: authorizationURL,
        callbackURLScheme: EngramOAuthClient.callbackURL.scheme
      ) { [self] callback, error in
        self.session = nil
        if let authError = error as? ASWebAuthenticationSessionError,
          authError.code == .canceledLogin
        {
          continuation.resume(throwing: OAuthError.cancelled)
        } else if let error {
          continuation.resume(throwing: error)
        } else if let callback {
          continuation.resume(returning: callback)
        } else {
          continuation.resume(throwing: OAuthError.invalidCallback)
        }
      }
      session.presentationContextProvider = self
      session.prefersEphemeralWebBrowserSession = false
      self.session = session
      guard session.start() else {
        self.session = nil
        continuation.resume(throwing: OAuthError.invalidCallback)
        return
      }
    }
  }

  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    NSApp.keyWindow ?? NSApp.windows.first ?? NSWindow()
  }
}
