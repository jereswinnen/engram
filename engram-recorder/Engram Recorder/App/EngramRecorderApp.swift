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
        menuBarTitle,
        systemImage: menuBarSymbol
      )
    }
    .menuBarExtraStyle(.window)

    Settings {
      SettingsView(settings: runtime.controller.settings)
    }
    .defaultSize(width: 520, height: 360)
  }

  private var menuBarTitle: String {
    if runtime.controller.isRecording { return "Engram is recording" }
    if let meeting = runtime.controller.detectedMeeting { return "\(meeting.title) detected" }
    if runtime.controller.isUploading { return "Engram is uploading" }
    return "Engram Recorder"
  }

  private var menuBarSymbol: String {
    if runtime.controller.isRecording { return "record.circle.fill" }
    if runtime.controller.detectedMeeting != nil { return "video.fill" }
    if runtime.controller.isUploading { return "arrow.up.circle" }
    return "waveform"
  }
}

@MainActor
@Observable
final class AppRuntime {
  let controller: RecorderController
  private let panelController: CapsulePanelController
  private let meetingPromptController: MeetingPromptPanelController
  private let hotKey: GlobalHotKey

  init() {
    let controller = RecorderController(settings: AppSettings())
    self.controller = controller
    panelController = CapsulePanelController(controller: controller)
    meetingPromptController = MeetingPromptPanelController(controller: controller)
    hotKey = GlobalHotKey(keyCode: UInt32(kVK_ANSI_R), modifiers: [.command, .shift])

    controller.phaseHandler = { [weak panelController] phase in
      panelController?.update(for: phase)
    }
    controller.meetingPromptHandler = { [weak meetingPromptController] meeting in
      meetingPromptController?.update(for: meeting)
    }
    hotKey.handler = { [weak controller] in
      controller?.toggleRecording()
    }
    hotKey.register()
  }
}
