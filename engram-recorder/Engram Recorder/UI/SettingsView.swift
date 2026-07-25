import AppKit
import SwiftUI

struct SettingsView: View {
  @Bindable var settings: AppSettings

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
          "Sign-in opens your browser. The renewable credential is stored in the device-only "
            + "macOS Keychain. Confirmed uploads remain local for 7 days."
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
