import Foundation
import LocalAuthentication
import Security

enum KeychainStore {
  private static let service = "jeremys.engram.recorder"
  private static let legacyService = "com.jereswinnen.engram.recorder"

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
}

private struct KeychainError: LocalizedError {
  let status: OSStatus

  var errorDescription: String? {
    SecCopyErrorMessageString(status, nil) as String? ?? "Keychain error \(status)"
  }
}
