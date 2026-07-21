import Darwin
import Foundation
import IOKit.pwr_mgt
import OSLog

enum MeetingDetectionMode: String, CaseIterable, Identifiable, Sendable {
  case off
  case ask
  case automatic

  var id: Self { self }

  var title: String {
    switch self {
    case .off: "Off"
    case .ask: "Ask before recording"
    case .automatic: "Record automatically"
    }
  }

  var description: String {
    switch self {
    case .off:
      "Engram will not watch for Google Meet calls."
    case .ask:
      "Engram shows a small prompt when a Google Meet call begins."
    case .automatic:
      "Engram starts and stops recording with the Google Meet call."
    }
  }
}

enum MeetingBrowser: String, Sendable {
  case chrome
  case edge
  case brave
  case arc
  case safari
  case firefox

  var displayName: String {
    switch self {
    case .chrome: "Google Chrome"
    case .edge: "Microsoft Edge"
    case .brave: "Brave"
    case .arc: "Arc"
    case .safari: "Safari"
    case .firefox: "Firefox"
    }
  }
}

struct DetectedMeeting: Identifiable, Equatable, Sendable {
  let id: UUID
  let browser: MeetingBrowser
  let detectedAt: Date
  let isGoogleMeetConfirmed: Bool

  var title: String { isGoogleMeetConfirmed ? "Google Meet" : "Browser meeting" }
}

enum MeetingDetectionEvent: Sendable {
  case started(DetectedMeeting)
  case ended(DetectedMeeting)
}

@MainActor
final class GoogleMeetDetector {
  typealias EventHandler = (MeetingDetectionEvent) -> Void

  var eventHandler: EventHandler?

  private enum DetectionState {
    case idle
    case candidate(MeetingEvidence, ContinuousClock.Instant)
    case active(DetectedMeeting)
    case ending(DetectedMeeting, ContinuousClock.Instant)
  }

  private static let logger = Logger(
    subsystem: Bundle.main.bundleIdentifier ?? "jeremys.engram.recorder",
    category: "GoogleMeetDetection"
  )
  private static let pollInterval = Duration.seconds(1)
  private static let startConfirmation = Duration.milliseconds(2_500)
  private static let endGracePeriod = Duration.seconds(4)

  private let clock = ContinuousClock()
  private let evidenceReader = MeetingEvidenceReader()
  private var pollingTask: Task<Void, Never>?
  private var state: DetectionState = .idle

  func start() {
    guard pollingTask == nil else { return }
    Self.logger.info("Google Meet detection started")
    pollingTask = Task { [weak self] in
      while !Task.isCancelled {
        guard let self else { return }
        let evidence = await evidenceReader.read()
        guard !Task.isCancelled else { return }
        consume(evidence)
        try? await Task.sleep(for: Self.pollInterval)
      }
    }
  }

  func stop() {
    pollingTask?.cancel()
    pollingTask = nil
    state = .idle
    Self.logger.info("Google Meet detection stopped")
  }

  private func consume(_ evidence: MeetingEvidence?) {
    let now = clock.now

    switch state {
    case .idle:
      if let evidence {
        state = .candidate(evidence, now)
      }

    case .candidate(let candidate, let startedAt):
      guard let evidence, evidence.browser == candidate.browser else {
        state = .idle
        return
      }
      if now - startedAt >= Self.startConfirmation {
        let meeting = DetectedMeeting(
          id: UUID(),
          browser: evidence.browser,
          detectedAt: Date(),
          isGoogleMeetConfirmed: evidence.isGoogleMeetConfirmed
        )
        state = .active(meeting)
        Self.logger.info("Google Meet detected in \(evidence.browser.displayName, privacy: .public)")
        eventHandler?(.started(meeting))
      }

    case .active(let meeting):
      if evidence?.browser != meeting.browser {
        state = .ending(meeting, now)
      }

    case .ending(let meeting, let startedAt):
      if evidence?.browser == meeting.browser {
        state = .active(meeting)
      } else if now - startedAt >= Self.endGracePeriod {
        state = .idle
        Self.logger.info("Google Meet ended in \(meeting.browser.displayName, privacy: .public)")
        eventHandler?(.ended(meeting))
      }
    }
  }
}

private struct MeetingEvidence: Sendable {
  let browser: MeetingBrowser
  let isGoogleMeetConfirmed: Bool
}

private actor MeetingEvidenceReader {
  private static let networkCacheDuration = Duration.seconds(2)

  private let clock = ContinuousClock()
  private var networkCache:
    [MeetingBrowser: (isActive: Bool, expiresAt: ContinuousClock.Instant)] = [:]

  func read() -> MeetingEvidence? {
    let powerSignals = PowerAssertionReader.browserSignals()
    if let browser = powerSignals.first(where: { browser, signal in
      browser != .safari
        && browser != .firefox
        && signal.hasWebRTC
        && signal.hasAudio
    })?.key {
      return MeetingEvidence(browser: browser, isGoogleMeetConfirmed: false)
    }

    if let safari = powerSignals[.safari],
      safari.hasWebKitMediaPlayback,
      hasMeetingNetworkActivity(for: .safari)
    {
      return MeetingEvidence(browser: .safari, isGoogleMeetConfirmed: false)
    }

    if let firefox = powerSignals[.firefox],
      firefox.hasAudio,
      hasMeetingNetworkActivity(for: .firefox)
    {
      return MeetingEvidence(browser: .firefox, isGoogleMeetConfirmed: false)
    }

    return nil
  }

  private func hasMeetingNetworkActivity(for browser: MeetingBrowser) -> Bool {
    let now = clock.now
    if let cached = networkCache[browser], now < cached.expiresAt {
      return cached.isActive
    }

    let isActive = ProcessNetworkReader.hasMeetingUDPSocket(for: browser)
    networkCache[browser] = (
      isActive,
      now.advanced(by: Self.networkCacheDuration)
    )
    return isActive
  }
}

private struct BrowserPowerSignal: Sendable {
  var hasWebRTC = false
  var hasAudio = false
  var hasWebKitMediaPlayback = false
}

private enum PowerAssertionReader {
  static func browserSignals() -> [MeetingBrowser: BrowserPowerSignal] {
    var unmanagedAssertions: Unmanaged<CFDictionary>?
    guard
      IOPMCopyAssertionsByProcess(&unmanagedAssertions) == kIOReturnSuccess,
      let assertions = unmanagedAssertions?.takeRetainedValue() as NSDictionary?
    else {
      return [:]
    }

    var result: [MeetingBrowser: BrowserPowerSignal] = [:]
    var resolvedPIDs: [pid_t: MeetingBrowser] = [:]
    for (rawOwnerPID, rawAssertions) in assertions {
      guard
        let ownerPID = (rawOwnerPID as? NSNumber)?.int32Value,
        let assertionList = rawAssertions as? [NSDictionary]
      else {
        continue
      }

      for assertion in assertionList where isEnabled(assertion) {
        let text = searchableText(assertion).lowercased()
        let hasWebRTC = text.contains("webrtc") && text.contains("peerconnection")
        let hasAudio =
          text.contains("audio-playing")
          || text.contains("audio-in")
          || text.contains("audio-out")
          || text.contains("webkit media playback")
        let hasWebKitMediaPlayback = text.contains("webkit media playback")
        guard hasWebRTC || hasAudio || hasWebKitMediaPlayback else { continue }

        let candidatePIDs = processIDs(from: assertion, ownerPID: ownerPID, text: text)
        let browser = BrowserProcessResolver.browser(fromHint: text)
          ?? candidatePIDs.lazy.compactMap { pid in
            if let cached = resolvedPIDs[pid] { return cached }
            guard let browser = BrowserProcessResolver.browser(pid: pid) else { return nil }
            resolvedPIDs[pid] = browser
            return browser
          }.first
        guard let browser else { continue }

        var signal = result[browser, default: BrowserPowerSignal()]
        signal.hasWebRTC = signal.hasWebRTC || hasWebRTC
        signal.hasAudio = signal.hasAudio || hasAudio
        signal.hasWebKitMediaPlayback =
          signal.hasWebKitMediaPlayback || hasWebKitMediaPlayback
        result[browser] = signal
      }
    }
    return result
  }

  private static func isEnabled(_ assertion: NSDictionary) -> Bool {
    guard let level = assertion["AssertLevel"] as? NSNumber else { return true }
    return level.intValue != 0
  }

  private static func processIDs(
    from assertion: NSDictionary,
    ownerPID: pid_t,
    text: String
  ) -> [pid_t] {
    var result: [pid_t] = []
    for key in ["AssertionOnBehalfOfPID", "AssertPID", "PID"] {
      if let pid = (assertion[key] as? NSNumber)?.int32Value, !result.contains(pid) {
        result.append(pid)
      }
    }

    if let createdPID = firstCapturedPID(in: text, marker: "created for pid:") {
      result.append(createdPID)
    }
    if !result.contains(ownerPID) { result.append(ownerPID) }
    return result
  }

  private static func firstCapturedPID(in text: String, marker: String) -> pid_t? {
    guard let markerRange = text.range(of: marker) else { return nil }
    let suffix = text[markerRange.upperBound...].drop(while: { $0.isWhitespace })
    let digits = suffix.prefix(while: { $0.isNumber })
    return pid_t(digits)
  }

  private static func searchableText(_ assertion: NSDictionary) -> String {
    let keys = [
      "AssertName",
      "HumanReadableReason",
      "Details",
      "AssertType",
      "AssertionTrueType",
      "ResourcesUsed",
      "Process Name",
      "BundleID",
    ]
    return keys.compactMap { key in
      assertion[key].map { "\(key) \($0)" }
    }.joined(separator: " ")
  }
}

private enum ProcessNetworkReader {
  private static let webKitNetworkingPath =
    "/System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/"
    + "com.apple.WebKit.Networking.xpc/Contents/MacOS/com.apple.WebKit.Networking"
  private static let firefoxPluginPath =
    "/Applications/Firefox.app/Contents/MacOS/plugin-container.app/Contents/MacOS/"
    + "plugin-container"

  static func hasMeetingUDPSocket(for browser: MeetingBrowser) -> Bool {
    let path: String
    switch browser {
    case .safari:
      path = webKitNetworkingPath
    case .firefox:
      path = firefoxPluginPath
    default:
      return false
    }

    return processIDs(executablePath: path).contains(where: hasMeetingUDPSocket)
  }

  private static func processIDs(executablePath: String) -> [pid_t] {
    let requiredBytes = executablePath.withCString { path in
      proc_listpidspath(UInt32(PROC_ALL_PIDS), 0, path, 0, nil, 0)
    }
    guard requiredBytes > 0 else { return [] }

    var pids = [pid_t](
      repeating: 0,
      count: Int(requiredBytes) / MemoryLayout<pid_t>.stride
    )
    let returnedBytes = executablePath.withCString { path in
      pids.withUnsafeMutableBytes { buffer in
        proc_listpidspath(
          UInt32(PROC_ALL_PIDS),
          0,
          path,
          0,
          buffer.baseAddress,
          Int32(buffer.count)
        )
      }
    }
    guard returnedBytes > 0 else { return [] }
    return Array(pids.prefix(Int(returnedBytes) / MemoryLayout<pid_t>.stride))
  }

  private static func hasMeetingUDPSocket(pid: pid_t) -> Bool {
    let requiredBytes = proc_pidinfo(pid, PROC_PIDLISTFDS, 0, nil, 0)
    guard requiredBytes > 0 else { return false }

    var fileDescriptors = [proc_fdinfo](
      repeating: proc_fdinfo(),
      count: Int(requiredBytes) / MemoryLayout<proc_fdinfo>.stride
    )
    let returnedBytes = fileDescriptors.withUnsafeMutableBytes { buffer in
      proc_pidinfo(
        pid,
        PROC_PIDLISTFDS,
        0,
        buffer.baseAddress,
        Int32(buffer.count)
      )
    }
    guard returnedBytes > 0 else { return false }

    let descriptorCount = Int(returnedBytes) / MemoryLayout<proc_fdinfo>.stride
    for descriptor in fileDescriptors.prefix(descriptorCount)
    where descriptor.proc_fdtype == PROX_FDTYPE_SOCKET {
      var socket = socket_fdinfo()
      let socketSize = Int32(MemoryLayout<socket_fdinfo>.stride)
      guard
        proc_pidfdinfo(
          pid,
          descriptor.proc_fd,
          PROC_PIDFDSOCKETINFO,
          &socket,
          socketSize
        ) == socketSize,
        socket.psi.soi_protocol == IPPROTO_UDP,
        socket.psi.soi_family == AF_INET || socket.psi.soi_family == AF_INET6
      else {
        continue
      }

      // DNS and HTTP/3 commonly use UDP ports 53 and 443. WebRTC normally
      // negotiates a high remote port; Plaud applies the same low-port guard.
      let remotePort = UInt16(
        bigEndian: UInt16(truncatingIfNeeded: socket.psi.soi_proto.pri_in.insi_fport)
      )
      if remotePort > 1_024 {
        return true
      }
    }
    return false
  }
}

private enum BrowserProcessResolver {
  static func browser(pid: pid_t) -> MeetingBrowser? {
    var currentPID = pid
    var visited = Set<pid_t>()
    for _ in 0..<6 where currentPID > 0 && visited.insert(currentPID).inserted {
      if let browser = executablePath(pid: currentPID).flatMap(browser(fromHint:)) {
        return browser
      }
      currentPID = parentPID(of: currentPID) ?? 0
    }
    return nil
  }

  static func browser(fromHint hint: String) -> MeetingBrowser? {
    let value = hint.lowercased()
    if value.contains("com.google.chrome") || value.contains("google chrome") {
      return .chrome
    }
    if value.contains("com.microsoft.edgemac") || value.contains("microsoft edge") {
      return .edge
    }
    if value.contains("com.brave.browser") || value.contains("brave browser") {
      return .brave
    }
    if value.contains("company.thebrowser.browser") || value.contains("/arc.app/") {
      return .arc
    }
    if value.contains("com.apple.safari")
      || value.contains("com.apple.webkit")
      || value.contains("/safari.app/")
    {
      return .safari
    }
    if value.contains("org.mozilla.firefox") || value.contains("/firefox.app/") {
      return .firefox
    }
    return nil
  }

  private static func executablePath(pid: pid_t) -> String? {
    var buffer = [CChar](repeating: 0, count: 4_096)
    let length = proc_pidpath(pid, &buffer, UInt32(buffer.count))
    guard length > 0 else { return nil }
    return String(cString: buffer)
  }

  private static func parentPID(of pid: pid_t) -> pid_t? {
    var info = proc_bsdinfo()
    let size = MemoryLayout<proc_bsdinfo>.stride
    let result = withUnsafeMutablePointer(to: &info) { pointer in
      proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, pointer, Int32(size))
    }
    guard result == Int32(size) else { return nil }
    return pid_t(info.pbi_ppid)
  }
}
