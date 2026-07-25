import AppKit
import SwiftUI

struct SettingsView: View {
  @Bindable var settings: AppSettings
  @Environment(\.appearsActive) private var appearsActive

  var body: some View {
    Form {
      Section("Engram") {
        TextField(
          "Server URL", text: $settings.serverURLString, prompt: Text("https://engram.example.com")
        )
        .textContentType(.URL)

        if !settings.serverURLString.isEmpty, settings.serverURL == nil {
          Label("Enter a valid HTTP or HTTPS URL.", systemImage: "exclamationmark.triangle.fill")
            .foregroundStyle(.orange)
            .font(.caption)
        }
        if let account = settings.authAccount, settings.isConfigured {
          LabeledContent("Signed in", value: account.displayName)
          LabeledContent("Issuer", value: account.issuer.absoluteString)
            .textSelection(.enabled)
          Button("Disconnect", role: .destructive) {
            Task { await settings.disconnect() }
          }
          .disabled(settings.isAuthenticating)
        } else {
          Button("Sign in to Engram") {
            Task { await settings.signIn() }
          }
          .buttonStyle(.borderedProminent)
          .disabled(settings.serverURL == nil || settings.isAuthenticating)
        }

        if settings.isAuthenticating {
          ProgressView()
            .controlSize(.small)
        }

        if let error = settings.authenticationError {
          Label(error, systemImage: "key.slash")
            .foregroundStyle(.red)
            .font(.caption)
        }

        if settings.revocationFailed {
          Button("Sign out only on this Mac") {
            Task { await settings.signOutLocallyAfterRevocationFailure() }
          }
          .foregroundStyle(.red)
        }

        Text(
          "Sign-in opens your browser. The renewable credential is stored in the encrypted, "
            + "non-synchronizing macOS login Keychain. Confirmed uploads remain local for 7 days."
        )
        .font(.caption)
        .foregroundStyle(.secondary)
      }

      Section("Recording") {
        Picker("Google Meet detection", selection: $settings.meetingDetectionMode) {
          ForEach(MeetingDetectionMode.allCases) { mode in
            Text(mode.title).tag(mode)
          }
        }

        Text(settings.meetingDetectionMode.description)
          .font(.caption)
          .foregroundStyle(.secondary)

        Toggle(
          "Keep the floating capsule out of screen captures", isOn: $settings.hideCapsuleFromCapture
        )
        LabeledContent("Shortcut", value: "⌘⇧R")
        HStack {
          Button("Microphone Privacy Settings") {
            openPrivacyPane("Privacy_Microphone")
          }
          Button("Screen Recording Privacy Settings") {
            openPrivacyPane("Privacy_ScreenCapture")
          }
        }
      }

      Section("App") {
        Toggle(
          "Launch Engram at login",
          isOn: Binding(
            get: { settings.launchAtLogin },
            set: { settings.setLaunchAtLogin($0) }
          )
        )

        if settings.launchAtLoginRequiresApproval {
          Label(
            "Allow Engram under System Settings → General → Login Items.",
            systemImage: "exclamationmark.triangle.fill"
          )
          .font(.caption)
          .foregroundStyle(.orange)

          Button("Open Login Items Settings") {
            settings.openLoginItemsSettings()
          }
        }

        if let error = settings.launchAtLoginError {
          Label(error, systemImage: "exclamationmark.triangle.fill")
            .font(.caption)
            .foregroundStyle(.red)
        }
      }

      Section {
        Text(
          "Google Meet detection uses the same low-overhead macOS WebRTC and browser-audio signals as Plaud."
        )
        .font(.caption)
        .foregroundStyle(.secondary)
      }
    }
    .formStyle(.grouped)
    .padding(12)
    .onAppear {
      settings.refreshLaunchAtLoginStatus()
    }
    .onChange(of: appearsActive) { _, isActive in
      if isActive {
        settings.refreshLaunchAtLoginStatus()
      }
    }
  }

  private func openPrivacyPane(_ anchor: String) {
    guard
      let url = URL(
        string: "x-apple.systempreferences:com.apple.preference.security?\(anchor)"
      )
    else {
      return
    }
    NSWorkspace.shared.open(url)
  }
}
