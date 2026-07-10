import AppKit
import Carbon
import SwiftUI

@main
struct EngramRecorderApp: App {
  @State private var runtime = AppRuntime()

  var body: some Scene {
    MenuBarExtra {
      MenuBarView(controller: runtime.controller)
    } label: {
      Label(
        runtime.controller.isRecording ? "Engram is recording" : "Engram Recorder",
        systemImage: runtime.controller.isRecording ? "record.circle.fill" : "waveform"
      )
    }
    .menuBarExtraStyle(.window)

    Settings {
      SettingsView(settings: runtime.controller.settings)
    }
    .defaultSize(width: 520, height: 360)
  }
}

@MainActor
@Observable
final class AppRuntime {
  let controller: RecorderController
  private let panelController: CapsulePanelController
  private let hotKey: GlobalHotKey

  init() {
    let controller = RecorderController(settings: AppSettings())
    self.controller = controller
    panelController = CapsulePanelController(controller: controller)
    hotKey = GlobalHotKey(keyCode: UInt32(kVK_ANSI_R), modifiers: [.command, .shift])

    controller.phaseHandler = { [weak panelController] phase in
      panelController?.update(for: phase)
    }
    hotKey.handler = { [weak controller] in
      controller?.toggleRecording()
    }
    hotKey.register()
  }
}
