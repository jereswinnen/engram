import Foundation
import Observation
import ServiceManagement

@MainActor
@Observable
final class AppSettings {
  private enum Keys {
    static let serverURL = "engram.serverURL"
    static let hideFromCapture = "engram.hideCapsuleFromCapture"
    static let meetingDetectionMode = "engram.meetingDetectionMode"
  }

  var serverURLString: String {
    didSet {
      defaults.set(serverURLString, forKey: Keys.serverURL)
      refreshAuthentication()
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

  private(set) var authAccount: EngramAccount?
  private(set) var authenticationError: String?
  private(set) var isAuthenticating = false
  private(set) var revocationFailed = false
  private(set) var launchAtLoginStatus: SMAppService.Status
  private(set) var launchAtLoginError: String?
  let authSession: EngramAuthSession
  private let defaults: UserDefaults

  init(
    defaults: UserDefaults = .standard,
    authSession: EngramAuthSession = EngramAuthSession()
  ) {
    self.defaults = defaults
    self.authSession = authSession
    serverURLString = defaults.string(forKey: Keys.serverURL) ?? ""
    authAccount = nil
    authenticationError = nil
    isAuthenticating = false
    revocationFailed = false
    launchAtLoginStatus = SMAppService.mainApp.status
    launchAtLoginError = nil
    hideCapsuleFromCapture = defaults.object(forKey: Keys.hideFromCapture) as? Bool ?? true
    meetingDetectionMode =
      MeetingDetectionMode(
        rawValue: defaults.string(forKey: Keys.meetingDetectionMode) ?? ""
      ) ?? .ask
    refreshAuthentication()
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

  var currentBinding: RecordingAuthBinding? {
    guard let authAccount else { return nil }
    return RecordingAuthBinding(
      issuer: authAccount.issuer.absoluteString,
      accountID: authAccount.accountID,
      connectionID: authAccount.connectionID
    )
  }

  var isConfigured: Bool {
    guard let serverURL, serverURL.isAllowedEngramServer, let authAccount else { return false }
    return authAccount.issuer == serverURL.engramBaseURL.appendingPathComponent("api/auth")
  }

  var launchAtLogin: Bool {
    launchAtLoginStatus == .enabled || launchAtLoginStatus == .requiresApproval
  }

  var launchAtLoginRequiresApproval: Bool {
    launchAtLoginStatus == .requiresApproval
  }

  func setLaunchAtLogin(_ enabled: Bool) {
    let service = SMAppService.mainApp
    launchAtLoginError = nil
    do {
      if enabled {
        if service.status == .notRegistered || service.status == .notFound {
          try service.register()
        }
      } else if service.status != .notRegistered {
        try service.unregister()
      }
    } catch {
      launchAtLoginError = error.localizedDescription
    }
    refreshLaunchAtLoginStatus()
  }

  func refreshLaunchAtLoginStatus() {
    launchAtLoginStatus = SMAppService.mainApp.status
  }

  func openLoginItemsSettings() {
    SMAppService.openSystemSettingsLoginItems()
  }

  func signIn() async {
    guard let serverURL else {
      authenticationError = OAuthError.invalidServerURL.localizedDescription
      return
    }
    isAuthenticating = true
    authenticationError = nil
    revocationFailed = false
    defer { isAuthenticating = false }
    do {
      authAccount = try await authSession.signIn(serverURL: serverURL)
    } catch OAuthError.cancelled {
      authenticationError = nil
    } catch {
      authenticationError = error.localizedDescription
    }
  }

  func disconnect() async {
    guard let serverURL else { return }
    isAuthenticating = true
    authenticationError = nil
    revocationFailed = false
    defer { isAuthenticating = false }
    do {
      try await authSession.disconnect(serverURL: serverURL)
      authAccount = nil
    } catch {
      revocationFailed = true
      authenticationError = "Engram could not revoke this Mac yet: \(error.localizedDescription)"
    }
  }

  func signOutLocallyAfterRevocationFailure() async {
    do {
      try await authSession.signOutLocally()
      authAccount = nil
      revocationFailed = false
      authenticationError =
        "Signed out on this Mac. The server credential may still be active; revoke it from Engram Settings when online."
    } catch {
      authenticationError = error.localizedDescription
    }
  }

  private func refreshAuthentication() {
    guard let serverURL, serverURL.isAllowedEngramServer else {
      authAccount = nil
      return
    }
    Task {
      do {
        let restored = try await authSession.restore(serverURL: serverURL)
        guard self.serverURL?.engramBaseURL == serverURL.engramBaseURL else { return }
        authAccount = restored
        authenticationError = nil
      } catch {
        authAccount = nil
        authenticationError = error.localizedDescription
      }
    }
  }
}
