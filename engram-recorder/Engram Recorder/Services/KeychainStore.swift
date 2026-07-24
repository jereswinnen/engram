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
    let protected = readOAuthCredentials(useDataProtectionKeychain: true)
    if protected.status == errSecSuccess,
      let credential = matchingCredential(in: protected.values, issuer: issuer)
    {
      return credential
    }
    guard protected.status == errSecSuccess || protected.status == errSecItemNotFound
      || protected.status == errSecMissingEntitlement
    else { return nil }

    let fallback = readOAuthCredentials(useDataProtectionKeychain: false)
    guard fallback.status == errSecSuccess,
      let credential = matchingCredential(in: fallback.values, issuer: issuer)
    else { return nil }

    // A locally signed build may need the non-syncing login Keychain. Once a
    // properly entitled release is installed, migrate only after the protected
    // copy has been saved successfully.
    if protected.status != errSecMissingEntitlement {
      do {
        try writeOAuthCredential(credential, useDataProtectionKeychain: true)
        _ = deleteOAuthCredential(credential, useDataProtectionKeychain: false)
      } catch {
        // The existing device-only credential remains the source of truth.
      }
    }
    return credential
  }

  static func saveOAuthCredential(_ credential: StoredOAuthCredential) throws {
    do {
      try writeOAuthCredential(credential, useDataProtectionKeychain: true)
    } catch let error as KeychainError where error.status == errSecMissingEntitlement {
      try writeOAuthCredential(credential, useDataProtectionKeychain: false)
    }
  }

  static func deleteOAuthCredential(_ credential: StoredOAuthCredential) throws {
    let protectedStatus = deleteOAuthCredential(
      credential,
      useDataProtectionKeychain: true
    )
    guard protectedStatus == errSecSuccess || protectedStatus == errSecItemNotFound
      || protectedStatus == errSecMissingEntitlement
    else { throw KeychainError(status: protectedStatus) }

    let fallbackStatus = deleteOAuthCredential(
      credential,
      useDataProtectionKeychain: false
    )
    guard fallbackStatus == errSecSuccess || fallbackStatus == errSecItemNotFound else {
      throw KeychainError(status: fallbackStatus)
    }
  }

  private static func matchingCredential(
    in values: [StoredOAuthCredential],
    issuer: URL
  ) -> StoredOAuthCredential? {
    values.first {
      $0.issuer == issuer.absoluteString && $0.clientID == EngramOAuthClient.clientID
    }
  }

  private static func readOAuthCredentials(
    useDataProtectionKeychain: Bool
  ) -> (status: OSStatus, values: [StoredOAuthCredential]) {
    var query = oauthCredentialQuery(useDataProtectionKeychain: useDataProtectionKeychain)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitAll
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess else { return (status, []) }
    let dataValues: [Data]
    if let values = item as? [Data] {
      dataValues = values
    } else if let value = item as? Data {
      dataValues = [value]
    } else {
      return (errSecDecode, [])
    }
    return (
      status,
      dataValues.compactMap { try? JSONDecoder().decode(StoredOAuthCredential.self, from: $0) }
    )
  }

  private static func writeOAuthCredential(
    _ credential: StoredOAuthCredential,
    useDataProtectionKeychain: Bool
  ) throws {
    let baseQuery = oauthCredentialQuery(
      account: credential.keychainAccount,
      useDataProtectionKeychain: useDataProtectionKeychain
    )
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

  private static func deleteOAuthCredential(
    _ credential: StoredOAuthCredential,
    useDataProtectionKeychain: Bool
  ) -> OSStatus {
    SecItemDelete(
      oauthCredentialQuery(
        account: credential.keychainAccount,
        useDataProtectionKeychain: useDataProtectionKeychain
      ) as CFDictionary
    )
  }

  private static func oauthCredentialQuery(
    account: String? = nil,
    useDataProtectionKeychain: Bool
  ) -> [String: Any] {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: oauthService,
    ]
    if let account { query[kSecAttrAccount as String] = account }
    if useDataProtectionKeychain {
      query[kSecUseDataProtectionKeychain as String] = true
    } else {
      // Explicitly exclude iCloud Keychain synchronization for locally signed builds.
      query[kSecAttrSynchronizable as String] = false
    }
    return query
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
