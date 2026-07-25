import Foundation
import LocalAuthentication
import Security

enum KeychainStore {
  private static let service = "jeremys.engram.recorder"
  private static let legacyService = "com.jereswinnen.engram.recorder"
  private static let oauthService = "jeremys.engram.recorder.oauth"
  // Keep this explicit and testable: the current ad-hoc Mac distribution has
  // no stable application identifier for durable Data Protection Keychain use.
  static let persistentOAuthCredentialUsesDataProtectionKeychain = false

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
    // The app is currently distributed with an ad-hoc signature. A Data
    // Protection Keychain write can appear to succeed without a stable signed
    // application identifier and then become unreadable after the process exits.
    // The non-synchronizing login Keychain is durable across those relaunches,
    // and ThisDeviceOnly keeps the renewable credential on this Mac.
    let login = readOAuthCredentials(
      useDataProtectionKeychain: persistentOAuthCredentialUsesDataProtectionKeychain
    )
    if login.status == errSecSuccess,
      let credential = matchingCredential(in: login.values, issuer: issuer)
    {
      return credential
    }
    guard login.status == errSecSuccess || login.status == errSecItemNotFound
    else { return nil }

    // Migrate credentials written by an earlier entitled/protected build only
    // after the durable login-Keychain copy succeeds.
    let protected = readOAuthCredentials(useDataProtectionKeychain: true)
    guard protected.status == errSecSuccess,
      let credential = matchingCredential(in: protected.values, issuer: issuer)
    else { return nil }
    do {
      try writeOAuthCredential(
        credential,
        useDataProtectionKeychain: persistentOAuthCredentialUsesDataProtectionKeychain
      )
      _ = deleteOAuthCredential(
        credential,
        useDataProtectionKeychain: !persistentOAuthCredentialUsesDataProtectionKeychain
      )
    } catch {
      // The protected credential remains available to this process. A later
      // rotated-token save will surface a durable-store failure to the user.
    }
    return credential
  }

  static func saveOAuthCredential(_ credential: StoredOAuthCredential) throws {
    try writeOAuthCredential(
      credential,
      useDataProtectionKeychain: persistentOAuthCredentialUsesDataProtectionKeychain
    )
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
