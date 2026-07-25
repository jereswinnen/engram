import Foundation
import LocalAuthentication
import OSLog
import Security

enum KeychainStore {
  private static let service = "jeremys.engram.recorder"
  private static let legacyService = "com.jereswinnen.engram.recorder"
  private static let oauthService = "jeremys.engram.recorder.oauth"
  // Keep this explicit and testable: the current ad-hoc Mac distribution has
  // no stable application identifier for durable Data Protection Keychain use.
  static let persistentOAuthCredentialUsesDataProtectionKeychain = false
  private static let logger = Logger(
    subsystem: "jeremys.engram.recorder",
    category: "OAuthKeychain"
  )

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
    // The encrypted, non-synchronizing login Keychain is durable across those
    // relaunches and remains local to this macOS user account.
    if persistentOAuthCredentialUsesDataProtectionKeychain {
      let protected = readOAuthCredentials(useDataProtectionKeychain: true)
      guard protected.status == errSecSuccess else { return nil }
      return matchingCredential(in: protected.values, issuer: issuer)
    }

    let login = readLoginOAuthCredential(issuer: issuer)
    if login.status == errSecSuccess { return login.credential }
    guard login.status == errSecItemNotFound else { return nil }

    // Migrate credentials written by an earlier entitled/protected build only
    // after the durable login-Keychain copy succeeds.
    let protected = readOAuthCredentials(useDataProtectionKeychain: true)
    guard protected.status == errSecSuccess,
      let credential = matchingCredential(in: protected.values, issuer: issuer)
    else { return nil }
    do {
      try writeLoginOAuthCredential(credential)
      deleteProtectedOAuthCredentialVariants(credential)
    } catch {
      // The protected credential remains available to this process. A later
      // rotated-token save will surface a durable-store failure to the user.
    }
    return credential
  }

  static func saveOAuthCredential(_ credential: StoredOAuthCredential) throws {
    if persistentOAuthCredentialUsesDataProtectionKeychain {
      try writeOAuthCredential(credential, useDataProtectionKeychain: true)
    } else {
      try writeLoginOAuthCredential(credential)
    }
  }

  static func deleteOAuthCredential(_ credential: StoredOAuthCredential) throws {
    for account in Set([credential.keychainAccount, credential.legacyKeychainAccount]) {
      let protectedStatus = deleteOAuthCredential(account: account, useDataProtectionKeychain: true)
      guard protectedStatus == errSecSuccess || protectedStatus == errSecItemNotFound
        || protectedStatus == errSecMissingEntitlement
      else { throw KeychainError(status: protectedStatus) }
    }

    let fallbackStatus = deleteLoginOAuthCredential(credential)
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
    guard status == errSecSuccess else {
      logger.notice(
        "OAuth credential read protected=\(useDataProtectionKeychain, privacy: .public) status=\(status, privacy: .public)"
      )
      return (status, [])
    }
    let dataValues: [Data]
    if let values = item as? [Data] {
      dataValues = values
    } else if let value = item as? Data {
      dataValues = [value]
    } else {
      return (errSecDecode, [])
    }
    let decoded = dataValues.compactMap {
      try? JSONDecoder().decode(StoredOAuthCredential.self, from: $0)
    }
    logger.notice(
      "OAuth credential read protected=\(useDataProtectionKeychain, privacy: .public) status=\(status, privacy: .public) decoded=\(decoded.count, privacy: .public)"
    )
    return (
      status,
      decoded
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
    logger.notice(
      "OAuth credential update protected=\(useDataProtectionKeychain, privacy: .public) status=\(status, privacy: .public)"
    )
    if status == errSecItemNotFound {
      var insert = baseQuery
      insert[kSecValueData as String] = data
      if useDataProtectionKeychain {
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      }
      let insertStatus = SecItemAdd(insert as CFDictionary, nil)
      logger.notice(
        "OAuth credential insert protected=\(useDataProtectionKeychain, privacy: .public) status=\(insertStatus, privacy: .public)"
      )
      guard insertStatus == errSecSuccess else { throw KeychainError(status: insertStatus) }
    } else if status != errSecSuccess {
      throw KeychainError(status: status)
    }
  }

  private static func deleteOAuthCredential(
    account: String,
    useDataProtectionKeychain: Bool
  ) -> OSStatus {
    SecItemDelete(
      oauthCredentialQuery(
        account: account,
        useDataProtectionKeychain: useDataProtectionKeychain
      ) as CFDictionary
    )
  }

  private static func deleteProtectedOAuthCredentialVariants(
    _ credential: StoredOAuthCredential
  ) {
    for account in Set([credential.keychainAccount, credential.legacyKeychainAccount]) {
      _ = deleteOAuthCredential(account: account, useDataProtectionKeychain: true)
    }
  }

  static func oauthCredentialQuery(
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
    }
    return query
  }

  private static func readLoginOAuthCredential(
    issuer: URL
  ) -> (status: OSStatus, credential: StoredOAuthCredential?) {
    var passwordLength: UInt32 = 0
    var passwordData: UnsafeMutableRawPointer?
    let account = StoredOAuthCredential.keychainAccount(
      issuer: issuer.absoluteString,
      clientID: EngramOAuthClient.clientID
    )
    let status = withLoginKeychainNames(account: account) { serviceName, serviceLength,
      accountName, accountLength in
      SecKeychainFindGenericPassword(
        nil,
        serviceLength,
        serviceName,
        accountLength,
        accountName,
        &passwordLength,
        &passwordData,
        nil
      )
    }
    defer {
      if let passwordData { SecKeychainItemFreeContent(nil, passwordData) }
    }
    guard status == errSecSuccess, let passwordData else {
      logger.notice("OAuth login credential read status=\(status, privacy: .public)")
      return (status, nil)
    }
    let credential = try? JSONDecoder().decode(
      StoredOAuthCredential.self,
      from: Data(bytes: passwordData, count: Int(passwordLength))
    )
    logger.notice(
      "OAuth login credential read status=\(status, privacy: .public) decoded=\(credential == nil ? 0 : 1, privacy: .public)"
    )
    return (credential == nil ? errSecDecode : status, credential)
  }

  private static func writeLoginOAuthCredential(_ credential: StoredOAuthCredential) throws {
    let data = try JSONEncoder().encode(credential)
    var item: SecKeychainItem?
    let findStatus = withLoginKeychainNames(account: credential.keychainAccount) {
      serviceName, serviceLength, accountName, accountLength in
      SecKeychainFindGenericPassword(
        nil,
        serviceLength,
        serviceName,
        accountLength,
        accountName,
        nil,
        nil,
        &item
      )
    }
    logger.notice("OAuth login credential find status=\(findStatus, privacy: .public)")
    if findStatus == errSecSuccess, let item {
      let status = data.withUnsafeBytes {
        SecKeychainItemModifyAttributesAndData(item, nil, UInt32($0.count), $0.baseAddress)
      }
      logger.notice("OAuth login credential update status=\(status, privacy: .public)")
      guard status == errSecSuccess else { throw KeychainError(status: status) }
      return
    }
    guard findStatus == errSecItemNotFound else { throw KeychainError(status: findStatus) }
    let status = withLoginKeychainNames(account: credential.keychainAccount) {
      serviceName, serviceLength, accountName, accountLength in
      data.withUnsafeBytes {
        guard let dataAddress = $0.baseAddress else { return errSecParam }
        return SecKeychainAddGenericPassword(
          nil,
          serviceLength,
          serviceName,
          accountLength,
          accountName,
          UInt32($0.count),
          dataAddress,
          nil
        )
      }
    }
    logger.notice("OAuth login credential insert status=\(status, privacy: .public)")
    guard status == errSecSuccess else { throw KeychainError(status: status) }
  }

  private static func deleteLoginOAuthCredential(_ credential: StoredOAuthCredential) -> OSStatus {
    var item: SecKeychainItem?
    let findStatus = withLoginKeychainNames(account: credential.keychainAccount) {
      serviceName, serviceLength, accountName, accountLength in
      SecKeychainFindGenericPassword(
        nil,
        serviceLength,
        serviceName,
        accountLength,
        accountName,
        nil,
        nil,
        &item
      )
    }
    guard findStatus == errSecSuccess, let item else { return findStatus }
    return SecKeychainItemDelete(item)
  }

  private static func withLoginKeychainNames<T>(
    account: String,
    _ body: (UnsafePointer<CChar>, UInt32, UnsafePointer<CChar>, UInt32) -> T
  ) -> T {
    oauthService.withCString { serviceName in
      account.withCString { accountName in
        body(
          serviceName,
          UInt32(oauthService.utf8.count),
          accountName,
          UInt32(account.utf8.count)
        )
      }
    }
  }
}

struct StoredOAuthCredential: Codable, Equatable, Sendable {
  let issuer: String
  let accountID: String
  let connectionID: String
  let clientID: String
  let refreshToken: String

  var keychainAccount: String { Self.keychainAccount(issuer: issuer, clientID: clientID) }
  var legacyKeychainAccount: String { "\(issuer)|\(accountID)|\(clientID)" }

  static func keychainAccount(issuer: String, clientID: String) -> String {
    "\(issuer)|\(clientID)"
  }
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
