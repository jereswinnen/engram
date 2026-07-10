import Foundation
import Security

enum KeychainStore {
  private static let service = "com.jereswinnen.engram.recorder"

  static func readToken() -> String {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: "api-token",
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]

    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
      let data = item as? Data,
      let token = String(data: data, encoding: .utf8)
    else {
      return ""
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
