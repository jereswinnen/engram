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
        SecureField("Mac recorder API token", text: $settings.apiToken)

        if !settings.serverURLString.isEmpty, settings.serverURL == nil {
          Label("Enter a valid HTTP or HTTPS URL.", systemImage: "exclamationmark.triangle.fill")
            .foregroundStyle(.orange)
            .font(.caption)
        }
        if let error = settings.tokenSaveError {
          Label(error, systemImage: "key.slash")
            .foregroundStyle(.red)
            .font(.caption)
        }

        Text(
          "The token is stored in your macOS Keychain. Audio stays local until Engram accepts the upload."
        )
        .font(.caption)
        .foregroundStyle(.secondary)
      }

      Section("Recording") {
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
