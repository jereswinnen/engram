import AppKit
import SwiftUI

struct MenuBarView: View {
  private static let contentHeight: CGFloat = 196

  @Bindable var controller: RecorderController
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      header

      Divider()

      Group {
        if controller.recordings.isEmpty {
          ContentUnavailableView(
            "No recordings yet",
            systemImage: "waveform",
            description: Text("Recordings are saved locally before upload.")
          )
        } else {
          ScrollView {
            history
          }
          .scrollIndicators(.automatic)
        }
      }
      // MenuBarExtra's AppKit host can leave stale pixels behind when its
      // intrinsic height shrinks. Keep the host window stable and scroll the
      // recording history instead of repeatedly resizing the popover.
      .frame(height: Self.contentHeight)
      .clipped()

      Divider()

      HStack {
        SettingsLink {
          Label("Settings", systemImage: "gearshape")
        }
        .buttonStyle(.plain)

        Spacer()

        Label("⌘⇧R", systemImage: "keyboard")
          .font(.caption)
          .foregroundStyle(.secondary)

        Spacer()

        Button {
          controller.quitApplication()
        } label: {
          Label("Quit", systemImage: "power")
        }
        .buttonStyle(.plain)
      }
      .font(.callout)
      .padding(.horizontal, 16)
      .padding(.vertical, 13)
    }
    .frame(width: 380)
    .onChange(of: controller.phase) { _, phase in
      if phase == .preparing {
        dismiss()
      }
    }
  }

  private var header: some View {
    HStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 3) {
        Text("Engram Recorder")
          .font(.headline)
        Text(controller.statusTitle)
          .font(.caption)
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }

      Spacer()

      Button {
        if controller.isRecording {
          controller.toggleRecording()
        } else if controller.detectedMeeting != nil {
          controller.recordDetectedMeeting()
        } else {
          controller.toggleRecording()
        }
      } label: {
        Label(
          controller.isRecording ? "Stop" : "Record",
          systemImage: controller.isRecording ? "stop.fill" : "record.circle"
        )
      }
      .buttonStyle(.borderedProminent)
      .buttonBorderShape(.roundedRectangle(radius: 10))
      .controlSize(.large)
      .tint(controller.isRecording ? .red : .accentColor)
      .disabled(!controller.isRecording && !controller.canStart)
    }
    .padding(16)
  }

  private var history: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("RECENT RECORDINGS")
        .font(.caption2.weight(.semibold))
        .foregroundStyle(.secondary)
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 6)

      ForEach(controller.recordings.prefix(6)) { recording in
        RecordingRow(recording: recording, controller: controller)
      }
    }
    .padding(.bottom, 8)
  }
}

private struct RecordingRow: View {
  let recording: LocalRecording
  let controller: RecorderController

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: statusSymbol)
        .foregroundStyle(statusColor)
        .font(.system(size: 16, weight: .semibold))
        .frame(width: 22)
        .help(statusDescription)

      VStack(alignment: .leading, spacing: 3) {
        Text(recording.title)
          .font(.body.weight(.medium))
          .lineLimit(1)

        Text(detailText)
          .font(.caption)
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
      .layoutPriority(1)

      Spacer(minLength: 6)

      if controller.isDeleting(recording.id) {
        ProgressView()
          .controlSize(.small)
      } else if recording.uploadState == .failed || recording.uploadState == .local {
        Button {
          controller.retryUpload(recording.id)
        } label: {
          Label("Retry", systemImage: "arrow.clockwise")
        }
        .buttonStyle(.borderless)
        .controlSize(.small)
      } else if recording.uploadState == .uploaded {
        Button {
          controller.openInEngram(recording)
        } label: {
          Label("Open", systemImage: "arrow.up.right.square")
        }
        .buttonStyle(.borderless)
        .controlSize(.small)
      } else {
        ProgressView()
          .controlSize(.small)
      }

      Menu {
        Button {
          controller.revealLocalFile(recording)
        } label: {
          Label("Show in Finder", systemImage: "folder")
        }

        if let error = recording.lastError {
          Divider()
          Text(error)
        }

        Divider()

        if recording.uploadState == .uploaded {
          Button(role: .destructive) {
            confirmLocalDeletion()
          } label: {
            Label("Delete Local Copy…", systemImage: "trash")
          }

          if recording.remoteID != nil {
            Button(role: .destructive) {
              confirmEverywhereDeletion()
            } label: {
              Label("Delete Everywhere…", systemImage: "trash.slash")
            }
          }
        } else {
          Button(role: .destructive) {
            confirmLocalDeletion()
          } label: {
            Label("Delete Recording…", systemImage: "trash")
          }
        }
      } label: {
        Image(systemName: "ellipsis.circle")
          .font(.system(size: 15))
          .foregroundStyle(.secondary)
      }
      .menuStyle(.borderlessButton)
      .menuIndicator(.hidden)
      .fixedSize()
      .help("More actions")
      .disabled(controller.isDeleting(recording.id))
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 10)
  }

  private func confirmLocalDeletion() {
    let alert = NSAlert()
    alert.messageText =
      recording.uploadState == .uploaded ? "Delete the local copy?" : "Delete this recording?"
    if recording.uploadState == .uploaded {
      alert.informativeText =
        "This removes the local audio and history entry. "
        + "The recording in Engram is not deleted."
    } else {
      alert.informativeText =
        "This permanently removes the local audio. It has not been saved to Engram."
    }
    alert.alertStyle = .warning
    let deleteTitle =
      recording.uploadState == .uploaded ? "Delete Local Copy" : "Delete Recording"
    alert.addButton(withTitle: deleteTitle).hasDestructiveAction = true
    alert.addButton(withTitle: "Cancel")

    NSApp.activate()
    guard alert.runModal() == .alertFirstButtonReturn else { return }
    controller.deleteRecording(recording.id)
  }

  private func confirmEverywhereDeletion() {
    let alert = NSAlert()
    alert.messageText = "Delete this recording everywhere?"
    alert.informativeText =
      "This permanently deletes the recording, transcript, and generated content from Engram, "
      + "then removes the local audio and history entry from this Mac. This cannot be undone."
    alert.alertStyle = .warning
    alert.addButton(withTitle: "Delete Everywhere").hasDestructiveAction = true
    alert.addButton(withTitle: "Cancel")

    NSApp.activate()
    guard alert.runModal() == .alertFirstButtonReturn else { return }
    controller.deleteRecording(recording.id, fromEngram: true)
  }

  private var duration: String {
    String(format: "%d:%02d", recording.durationSeconds / 60, recording.durationSeconds % 60)
  }

  private var detailText: String {
    if controller.isDeleting(recording.id) {
      return "Deleting…"
    }
    switch recording.uploadState {
    case .local, .failed:
      return "Saved locally · \(duration)"
    case .uploading:
      return "Uploading · \(duration)"
    case .uploaded:
      return "\(recording.startedAt.formatted(date: .abbreviated, time: .shortened)) · \(duration)"
    }
  }

  private var statusDescription: String {
    switch recording.uploadState {
    case .local: "Saved locally"
    case .uploading: "Uploading"
    case .uploaded: "Uploaded"
    case .failed: "Upload failed — saved locally"
    }
  }

  private var statusSymbol: String {
    switch recording.uploadState {
    case .local: "externaldrive.fill"
    case .uploading: "arrow.up.circle.fill"
    case .uploaded: "checkmark.circle.fill"
    case .failed: "exclamationmark.circle.fill"
    }
  }

  private var statusColor: Color {
    switch recording.uploadState {
    case .local: .secondary
    case .uploading: .blue
    case .uploaded: .green
    case .failed: .orange
    }
  }
}
