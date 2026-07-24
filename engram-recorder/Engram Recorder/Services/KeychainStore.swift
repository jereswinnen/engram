import Foundation
import LocalAuthentication
import Security

enum KeychainStore {
  private static let service = "jeremys.engram.recorder"
  private static let legacyService = "com.jereswinnen.engram.recorder"
  private static let oauthService = "jeremys.engram.recorder.oauth"

  static func readToken() -> String {
    if let token = readToken(service: service) {
      return token
    }

    // Older builds used a different Keychain namespace. Only migrate it when
    // macOS can read it without presenting an authorization dialog at launch.
    guard let legacyToken = readToken(service: legacyService, allowAuthenticationUI: false)
    else {
      return ""
    }
    try? saveToken(legacyToken)
    return legacyToken
  }

  private static func readToken(
    service: String,
    allowAuthenticationUI: Bool = true
  ) -> String? {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: "api-token",
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    if !allowAuthenticationUI {
      let context = LAContext()
      context.interactionNotAllowed = true
      query[kSecUseAuthenticationContext as String] = context
    }

    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
      let data = item as? Data,
      let token = String(data: data, encoding: .utf8)
    else {
      return nil
    }
    return token
  }

  static func saveToken(_ token: String) throws {
    let baseQuery: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: "api-token",
    ]

    if token.isEmpty {
      SecItemDelete(baseQuery as CFDictionary)
      return
    }

    let data = Data(token.utf8)
    let update = [kSecValueData as String: data]
    let status = SecItemUpdate(baseQuery as CFDictionary, update as CFDictionary)
    if status == errSecItemNotFound {
      var insert = baseQuery
      insert[kSecValueData as String] = data
      let insertStatus = SecItemAdd(insert as CFDictionary, nil)
      guard insertStatus == errSecSuccess else {
        throw KeychainError(status: insertStatus)
      }
    } else if status != errSecSuccess {
      throw KeychainError(status: status)
    }
  }

  static func readOAuthCredential(issuer: URL) -> StoredOAuthCredential? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: oauthService,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitAll,
      kSecUseDataProtectionKeychain as String: true,
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
      let values = item as? [Data]
    else { return nil }
    return values.lazy.compactMap {
      try? JSONDecoder().decode(StoredOAuthCredential.self, from: $0)
    }
    .first { $0.issuer == issuer.absoluteString && $0.clientID == EngramOAuthClient.clientID }
  }

  static func saveOAuthCredential(_ credential: StoredOAuthCredential) throws {
    let account = credential.keychainAccount
    let baseQuery: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: oauthService,
      kSecAttrAccount as String: account,
      kSecUseDataProtectionKeychain as String: true,
    ]
    let data = try JSONEncoder().encode(credential)
    let status = SecItemUpdate(
      baseQuery as CFDictionary,
      [kSecValueData as String: data] as CFDictionary
    )
    if status == errSecItemNotFound {
      var insert = baseQuery
      insert[kSecValueData as String] = data
      insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      let insertStatus = SecItemAdd(insert as CFDictionary, nil)
      guard insertStatus == errSecSuccess else { throw KeychainError(status: insertStatus) }
    } else if status != errSecSuccess {
      throw KeychainError(status: status)
    }
  }

  static func deleteOAuthCredential(_ credential: StoredOAuthCredential) throws {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: oauthService,
      kSecAttrAccount as String: credential.keychainAccount,
      kSecUseDataProtectionKeychain as String: true,
    ]
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw KeychainError(status: status)
    }
  }
}

struct StoredOAuthCredential: Codable, Equatable, Sendable {
  let issuer: String
  let accountID: String
  let connectionID: String
  let clientID: String
  let refreshToken: String

  var keychainAccount: String { "\(issuer)|\(accountID)|\(clientID)" }
}

protocol OAuthCredentialStoring: Sendable {
  func read(issuer: URL) -> StoredOAuthCredential?
  func save(_ credential: StoredOAuthCredential) throws
  func delete(_ credential: StoredOAuthCredential) throws
}

struct SystemOAuthCredentialStore: OAuthCredentialStoring {
  func read(issuer: URL) -> StoredOAuthCredential? {
    KeychainStore.readOAuthCredential(issuer: issuer)
  }

  func save(_ credential: StoredOAuthCredential) throws {
    try KeychainStore.saveOAuthCredential(credential)
  }

  func delete(_ credential: StoredOAuthCredential) throws {
    try KeychainStore.deleteOAuthCredential(credential)
  }
}

private struct KeychainError: LocalizedError {
  let status: OSStatus

  var errorDescription: String? {
    SecCopyErrorMessageString(status, nil) as String? ?? "Keychain error \(status)"
  }
}
