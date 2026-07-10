import AppKit
import SwiftUI

struct MenuBarView: View {
  @Bindable var controller: RecorderController
  @Environment(\.openSettings) private var openSettings

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      header

      Divider()

      if controller.recordings.isEmpty {
        ContentUnavailableView(
          "No recordings yet",
          systemImage: "waveform",
          description: Text("Recordings are saved locally before upload.")
        )
        .frame(height: 180)
      } else {
        history
      }

      Divider()

      HStack {
        Button("Settings…") { openSettings() }
          .buttonStyle(.plain)
        Spacer()
        Text("⌘⇧R")
          .font(.caption.monospaced())
          .foregroundStyle(.secondary)
        Button("Quit") { controller.quitApplication() }
          .buttonStyle(.plain)
      }
      .padding(14)
    }
    .frame(width: 360)
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
        controller.toggleRecording()
      } label: {
        Label(
          controller.isRecording ? "Stop" : "Record",
          systemImage: controller.isRecording ? "stop.fill" : "record.circle"
        )
      }
      .buttonStyle(.borderedProminent)
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
    HStack(spacing: 10) {
      Image(systemName: statusSymbol)
        .foregroundStyle(statusColor)
        .frame(width: 20)

      VStack(alignment: .leading, spacing: 2) {
        Text(recording.title)
          .lineLimit(1)
        Text("\(recording.startedAt.formatted(date: .abbreviated, time: .shortened)) · \(duration)")
          .font(.caption)
          .foregroundStyle(.secondary)
      }

      Spacer()

      if recording.uploadState == .failed || recording.uploadState == .local {
        Button("Retry") { controller.retryUpload(recording.id) }
          .controlSize(.small)
      } else if recording.uploadState == .uploaded {
        Button("Open") { controller.openInEngram(recording) }
          .controlSize(.small)
      } else {
        ProgressView()
          .controlSize(.small)
      }

      Menu {
        Button("Show in Finder") { controller.revealLocalFile(recording) }
        if let error = recording.lastError {
          Text(error)
        }
      } label: {
        Image(systemName: "ellipsis")
      }
      .menuStyle(.borderlessButton)
      .frame(width: 24)
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 8)
  }

  private var duration: String {
    String(format: "%d:%02d", recording.durationSeconds / 60, recording.durationSeconds % 60)
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
