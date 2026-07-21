import AppKit
import SwiftUI

struct CapsuleView: View {
  static let panelSize = NSSize(width: 50, height: 196)

  @Bindable var controller: RecorderController
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    Group {
      if controller.isRecording {
        recordingContent
      } else {
        statusContent
      }
    }
    .frame(width: Self.panelSize.width, height: Self.panelSize.height)
    .background(containerBackground, in: containerShape)
    .overlay {
      containerShape
        .strokeBorder(containerBorder, lineWidth: 1)
    }
  }

  private var recordingContent: some View {
    VStack(spacing: 0) {
      Text(formattedElapsed)
        .font(.system(size: 13, weight: .semibold, design: .monospaced))
        .contentTransition(.numericText())
        .accessibilityLabel("Recording time \(formattedElapsed)")
        .padding(.top, 14)

      WaveformView(samples: controller.waveform)
        .frame(width: 30, height: 78)
        .padding(.top, 12)

      Spacer(minLength: 8)

      Button {
        controller.toggleRecording()
      } label: {
        Image(systemName: "stop.fill")
          .font(.system(size: 13, weight: .bold))
          .foregroundStyle(.red)
          .frame(width: 34, height: 34)
          .background(.red.opacity(0.1), in: Circle())
      }
      .buttonStyle(.plain)
      .help("Stop recording (⌘⇧R)")
      .accessibilityLabel("Stop recording")
      .padding(.bottom, 8)
    }
  }

  private var statusContent: some View {
    VStack(spacing: 12) {
      stateSymbol
        .frame(width: 28, height: 28)

      Text(compactStatusTitle)
        .font(.system(size: 9, weight: .medium))
        .multilineTextAlignment(.center)
        .lineLimit(2)
        .minimumScaleFactor(0.8)
        .frame(maxWidth: .infinity)

      if case .success(let url) = controller.phase {
        Button {
          NSWorkspace.shared.open(url)
        } label: {
          Image(systemName: "arrow.up.right.square")
            .frame(width: 28, height: 28)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.small)
        .help("Open in Engram")
        .accessibilityLabel("Open in Engram")
      }
    }
    .padding(.horizontal, 4)
  }

  private var containerShape: RoundedRectangle {
    RoundedRectangle(cornerRadius: 25, style: .continuous)
  }

  private var containerBackground: Color {
    colorScheme == .dark ? Color(nsColor: .windowBackgroundColor) : .white
  }

  private var containerBorder: Color {
    colorScheme == .dark ? .white.opacity(0.12) : .black.opacity(0.08)
  }

  private var compactStatusTitle: String {
    switch controller.phase {
    case .idle: "Ready"
    case .preparing: "Starting"
    case .recording: "Recording"
    case .finalizing: "Saving"
    case .uploading: "Uploading"
    case .processing: "Sent"
    case .success: "Done"
    case .failure: "Failed"
    }
  }

  @ViewBuilder
  private var stateSymbol: some View {
    switch controller.phase {
    case .recording:
      Circle()
        .fill(.red)
        .frame(width: 10, height: 10)
        .shadow(color: .red.opacity(0.45), radius: 5)
    case .preparing, .finalizing, .uploading, .processing:
      ProgressView()
        .controlSize(.small)
    case .success:
      Image(systemName: "checkmark.circle.fill")
        .foregroundStyle(.green)
        .font(.system(size: 20))
    case .failure:
      Image(systemName: "exclamationmark.triangle.fill")
        .foregroundStyle(.orange)
        .font(.system(size: 18))
    case .idle:
      Image(systemName: "waveform")
    }
  }

  private var formattedElapsed: String {
    let minutes = controller.elapsedSeconds / 60
    let seconds = controller.elapsedSeconds % 60
    return String(format: "%02d:%02d", minutes, seconds)
  }
}

private struct WaveformView: View {
  let samples: [Float]

  var body: some View {
    Canvas { context, size in
      guard !samples.isEmpty else { return }
      let spacing: CGFloat = 2
      let minimumBarHeight: CGFloat = 1.5
      let maximumBarCount = max(
        1,
        Int((size.height + spacing) / (minimumBarHeight + spacing))
      )
      let visibleSamples = samples.suffix(maximumBarCount)
      let barHeight = max(
        minimumBarHeight,
        (size.height - spacing * CGFloat(visibleSamples.count - 1))
          / CGFloat(visibleSamples.count)
      )
      for (index, sample) in visibleSamples.enumerated() {
        let width = max(3, size.width * CGFloat(sample))
        let rect = CGRect(
          x: (size.width - width) / 2,
          y: CGFloat(index) * (barHeight + spacing),
          width: width,
          height: barHeight
        )
        context.fill(
          Path(roundedRect: rect, cornerRadius: barHeight / 2),
          with: .color(.primary.opacity(0.82))
        )
      }
    }
    .accessibilityHidden(true)
  }
}
