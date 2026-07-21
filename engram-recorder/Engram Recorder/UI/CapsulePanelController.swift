import AppKit
import SwiftUI

@MainActor
final class CapsulePanelController {
  private let panel: NSPanel
  private let controller: RecorderController

  init(controller: RecorderController) {
    self.controller = controller
    panel = NSPanel(
      contentRect: NSRect(origin: .zero, size: CapsuleView.panelSize),
      styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered,
      defer: false
    )
    panel.contentView = NSHostingView(rootView: CapsuleView(controller: controller))
    panel.backgroundColor = .clear
    panel.isOpaque = false
    panel.hasShadow = true
    panel.isFloatingPanel = true
    panel.level = .floating
    panel.hidesOnDeactivate = false
    panel.isMovableByWindowBackground = true
    panel.collectionBehavior = [
      .canJoinAllSpaces,
      .fullScreenAuxiliary,
      .stationary,
      .ignoresCycle,
    ]
    updateCaptureVisibility()
  }

  func update(for phase: RecorderPhase) {
    updateCaptureVisibility()
    if phase == .idle {
      panel.orderOut(nil)
    } else {
      if !panel.isVisible { positionNearTopRight() }
      panel.orderFrontRegardless()
    }
  }

  private func updateCaptureVisibility() {
    panel.sharingType = controller.settings.hideCapsuleFromCapture ? .none : .readOnly
  }

  private func positionNearTopRight() {
    guard let screen = NSScreen.main ?? NSScreen.screens.first else { return }
    let visible = screen.visibleFrame
    let origin = NSPoint(
      x: visible.maxX - panel.frame.width - 24,
      y: visible.maxY - panel.frame.height - 20
    )
    panel.setFrameOrigin(origin)
  }
}
