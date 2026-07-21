import AppKit
import SwiftUI

@MainActor
final class MeetingPromptPanelController {
  fileprivate static let panelSize = NSSize(width: 330, height: 132)

  private let panel: NSPanel

  init(controller: RecorderController) {
    panel = NSPanel(
      contentRect: NSRect(origin: .zero, size: Self.panelSize),
      styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered,
      defer: false
    )
    panel.contentView = NSHostingView(rootView: MeetingPromptView(controller: controller))
    panel.backgroundColor = .clear
    panel.isOpaque = false
    panel.hasShadow = true
    panel.isFloatingPanel = true
    panel.level = .floating
    panel.hidesOnDeactivate = false
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
  }

  func update(for meeting: DetectedMeeting?) {
    guard meeting != nil else {
      panel.orderOut(nil)
      return
    }
    positionNearTopRight()
    panel.orderFrontRegardless()
  }

  private func positionNearTopRight() {
    guard let screen = NSScreen.main ?? NSScreen.screens.first else { return }
    let visible = screen.visibleFrame
    panel.setFrameOrigin(
      NSPoint(
        x: visible.maxX - panel.frame.width - 24,
        y: visible.maxY - panel.frame.height - 20
      )
    )
  }
}

private struct MeetingPromptView: View {
  @Bindable var controller: RecorderController

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(spacing: 12) {
        Image(systemName: "video.fill")
          .font(.system(size: 18, weight: .semibold))
          .foregroundStyle(.blue)
          .frame(width: 34, height: 34)
          .background(.blue.opacity(0.12), in: Circle())

        VStack(alignment: .leading, spacing: 3) {
          Text("\(controller.detectedMeeting?.title ?? "Meeting") detected")
            .font(.headline)
          Text(browserDescription)
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      }

      HStack {
        Button("Not Now") {
          controller.dismissDetectedMeeting()
        }
        .keyboardShortcut(.cancelAction)

        Spacer()

        Button("Record") {
          controller.recordDetectedMeeting()
        }
        .buttonStyle(.borderedProminent)
        .keyboardShortcut(.defaultAction)
      }
    }
    .padding(16)
    .frame(width: MeetingPromptPanelController.panelSize.width)
    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    .overlay {
      RoundedRectangle(cornerRadius: 18, style: .continuous)
        .strokeBorder(.primary.opacity(0.08), lineWidth: 1)
    }
  }

  private var browserDescription: String {
    guard let meeting = controller.detectedMeeting else {
      return "A browser call is ready to record."
    }
    return "A call is active in \(meeting.browser.displayName)."
  }
}
