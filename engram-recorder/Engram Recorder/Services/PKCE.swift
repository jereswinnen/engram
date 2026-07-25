import CryptoKit
import Foundation

struct PKCEPair: Equatable, Sendable {
  let verifier: String
  let challenge: String

  static func generate(byteCount: Int = 32) throws -> PKCEPair {
    var bytes = [UInt8](repeating: 0, count: byteCount)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
      throw OAuthError.randomnessUnavailable
    }
    return fromVerifier(base64URL(Data(bytes)))
  }

  static func fromVerifier(_ verifier: String) -> PKCEPair {
    let digest = SHA256.hash(data: Data(verifier.utf8))
    return PKCEPair(verifier: verifier, challenge: base64URL(Data(digest)))
  }

  static func randomState(byteCount: Int = 32) throws -> String {
    var bytes = [UInt8](repeating: 0, count: byteCount)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
      throw OAuthError.randomnessUnavailable
    }
    return base64URL(Data(bytes))
  }

  private static func base64URL(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}
