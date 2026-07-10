import Carbon
import Foundation

@MainActor
final class GlobalHotKey {
  struct Modifiers: OptionSet {
    let rawValue: UInt32

    static let command = Modifiers(rawValue: UInt32(cmdKey))
    static let option = Modifiers(rawValue: UInt32(optionKey))
    static let control = Modifiers(rawValue: UInt32(controlKey))
    static let shift = Modifiers(rawValue: UInt32(shiftKey))
  }

  var handler: (() -> Void)?

  private let keyCode: UInt32
  private let modifiers: Modifiers
  private var hotKeyRef: EventHotKeyRef?
  private var eventHandlerRef: EventHandlerRef?

  init(keyCode: UInt32, modifiers: Modifiers) {
    self.keyCode = keyCode
    self.modifiers = modifiers
  }

  deinit {
    if let hotKeyRef { UnregisterEventHotKey(hotKeyRef) }
    if let eventHandlerRef { RemoveEventHandler(eventHandlerRef) }
  }

  func register() {
    var eventType = EventTypeSpec(
      eventClass: OSType(kEventClassKeyboard),
      eventKind: UInt32(kEventHotKeyPressed)
    )
    let pointer = Unmanaged.passUnretained(self).toOpaque()
    InstallEventHandler(
      GetApplicationEventTarget(),
      { _, event, userData in
        guard let event, let userData else { return noErr }
        var hotKeyID = EventHotKeyID()
        let status = GetEventParameter(
          event,
          EventParamName(kEventParamDirectObject),
          EventParamType(typeEventHotKeyID),
          nil,
          MemoryLayout<EventHotKeyID>.size,
          nil,
          &hotKeyID
        )
        guard status == noErr, hotKeyID.id == 1 else { return status }
        let hotKey = Unmanaged<GlobalHotKey>.fromOpaque(userData).takeUnretainedValue()
        DispatchQueue.main.async { hotKey.handler?() }
        return noErr
      },
      1,
      &eventType,
      pointer,
      &eventHandlerRef
    )

    let identifier = EventHotKeyID(signature: OSType(0x454E_4752), id: 1)  // ENGR
    RegisterEventHotKey(
      keyCode,
      modifiers.rawValue,
      identifier,
      GetApplicationEventTarget(),
      0,
      &hotKeyRef
    )
  }
}
