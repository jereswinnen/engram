import Foundation
import Observation

@MainActor
@Observable
final class AppSettings {
  private enum Keys {
    static let serverURL = "engram.serverURL"
    static let hideFromCapture = "engram.hideCapsuleFromCapture"
    static let launchAtLogin = "engram.launchAtLogin"
    static let meetingDetectionMode = "engram.meetingDetectionMode"
  }

  var serverURLString: String {
    didSet { defaults.set(serverURLString, forKey: Keys.serverURL) }
  }

  var apiToken: String {
    didSet {
      do {
        try KeychainStore.saveToken(apiToken.trimmingCharacters(in: .whitespacesAndNewlines))
        tokenSaveError = nil
      } catch {
        tokenSaveError = error.localizedDescription
      }
    }
  }

  var hideCapsuleFromCapture: Bool {
    didSet { defaults.set(hideCapsuleFromCapture, forKey: Keys.hideFromCapture) }
  }

  var meetingDetectionMode: MeetingDetectionMode {
    didSet {
      defaults.set(meetingDetectionMode.rawValue, forKey: Keys.meetingDetectionMode)
      meetingDetectionModeChanged?(meetingDetectionMode)
    }
  }

  var meetingDetectionModeChanged: ((MeetingDetectionMode) -> Void)?

  private(set) var tokenSaveError: String?
  private let defaults: UserDefaults

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    serverURLString = defaults.string(forKey: Keys.serverURL) ?? ""
    apiToken = KeychainStore.readToken()
    hideCapsuleFromCapture = defaults.object(forKey: Keys.hideFromCapture) as? Bool ?? true
    meetingDetectionMode = MeetingDetectionMode(
      rawValue: defaults.string(forKey: Keys.meetingDetectionMode) ?? ""
    ) ?? .ask
  }

  var serverURL: URL? {
    let trimmed = serverURLString.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let components = URLComponents(string: trimmed),
      let scheme = components.scheme?.lowercased(),
      scheme == "https" || scheme == "http",
      components.host != nil
    else {
      return nil
    }
    return components.url
  }

  var trimmedToken: String {
    apiToken.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  var isConfigured: Bool {
    serverURL != nil && !trimmedToken.isEmpty
  }
}
