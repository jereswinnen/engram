import AppKit
import SwiftUI

struct CapsuleView: View {
  @Bindable var controller: RecorderController

  var body: some View {
    HStack(spacing: 14) {
      stateSymbol
        .frame(width: 24, height: 24)

      if controller.isRecording {
        WaveformView(samples: controller.waveform)
          .frame(width: 112, height: 34)

        Text(formattedElapsed)
          .font(.system(.body, design: .monospaced, weight: .medium))
          .contentTransition(.numericText())

        Button {
          controller.toggleRecording()
        } label: {
          Image(systemName: "stop.fill")
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: 34, height: 34)
            .background(.red, in: Circle())
        }
        .buttonStyle(.plain)
        .help("Stop recording (⌘⇧R)")
      } else {
        Text(controller.statusTitle)
          .font(.system(size: 14, weight: .medium))
          .lineLimit(1)
          .frame(maxWidth: .infinity, alignment: .leading)

        if case .success(let url) = controller.phase {
          Button("Open") {
            NSWorkspace.shared.open(url)
          }
          .buttonStyle(.borderedProminent)
          .controlSize(.small)
        }
      }
    }
    .padding(.horizontal, 18)
    .frame(width: 350, height: 76)
    .background(.ultraThinMaterial, in: Capsule())
    .overlay {
      Capsule()
        .strokeBorder(.white.opacity(0.18), lineWidth: 1)
    }
    .padding(8)
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
      let barWidth = max(
        1.5, (size.width - spacing * CGFloat(samples.count - 1)) / CGFloat(samples.count))
      for (index, sample) in samples.enumerated() {
        let height = max(3, size.height * CGFloat(sample))
        let rect = CGRect(
          x: CGFloat(index) * (barWidth + spacing),
          y: (size.height - height) / 2,
          width: barWidth,
          height: height
        )
        context.fill(
          Path(roundedRect: rect, cornerRadius: barWidth / 2),
          with: .color(.primary.opacity(0.82))
        )
      }
    }
    .accessibilityHidden(true)
  }
}
