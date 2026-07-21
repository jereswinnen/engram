import AppKit
import Foundation
import Observation

@MainActor
@Observable
final class RecorderController {
  private(set) var phase: RecorderPhase = .idle {
    didSet { phaseHandler?(phase) }
  }
  private(set) var recordings: [LocalRecording] = []
  private(set) var elapsedSeconds = 0
  private(set) var waveform = Array(repeating: Float(0.08), count: 28)
  private(set) var detectedMeeting: DetectedMeeting?

  let settings: AppSettings
  var phaseHandler: ((RecorderPhase) -> Void)?
  var meetingPromptHandler: ((DetectedMeeting?) -> Void)?

  private let capture = AudioCaptureService()
  private let archive: RecordingArchive
  private let api = EngramAPIClient()
  private let meetingDetector: GoogleMeetDetector
  private var activeRecordingID: UUID?
  private var activeOutputURL: URL?
  private var activeStartedAt: Date?
  private var activeMeetingSessionID: UUID?
  private var elapsedTask: Task<Void, Never>?
  private var dismissalTask: Task<Void, Never>?
  private var uploadTasks: [UUID: Task<Void, Never>] = [:]
  private var deletionTasks: [UUID: Task<Void, Never>] = [:]
  private(set) var deletingRecordingIDs: Set<UUID> = []

  init(settings: AppSettings) {
    let meetingDetector = GoogleMeetDetector()
    self.settings = settings
    self.meetingDetector = meetingDetector
    archive = RecordingArchive()
    meetingDetector.eventHandler = { [weak self] event in
      self?.handleMeetingDetection(event)
    }
    settings.meetingDetectionModeChanged = { [weak self] mode in
      self?.configureMeetingDetection(for: mode)
    }
    configureMeetingDetection(for: settings.meetingDetectionMode)
    Task { await loadHistory() }
  }

  var isRecording: Bool {
    phase == .recording
  }

  var canStart: Bool {
    switch phase {
    case .idle, .success, .failure:
      true
    default:
      false
    }
  }

  var statusTitle: String {
    switch phase {
    case .idle:
      detectedMeeting == nil ? "Ready" : "\(detectedMeeting?.title ?? "Meeting") detected"
    case .preparing:
      "Preparing…"
    case .recording:
      "Recording"
    case .finalizing:
      "Saving recording…"
    case .uploading:
      "Uploading to Engram…"
    case .processing:
      "Sent for transcription"
    case .success:
      "Saved to Engram"
    case .failure(let message):
      message
    }
  }

  func toggleRecording() {
    if isRecording {
      // A user stop always wins over automatic meeting behavior. The detector
      // remains in its current session, so it will not immediately restart.
      activeMeetingSessionID = nil
      Task { await stopRecording() }
    } else if canStart {
      Task { await startRecording() }
    }
  }

  func startRecording() async {
    await startRecording(for: nil)
  }

  func recordDetectedMeeting() {
    guard let meeting = detectedMeeting, canStart else { return }
    meetingPromptHandler?(nil)
    Task { await startRecording(for: meeting) }
  }

  func dismissDetectedMeeting() {
    detectedMeeting = nil
    meetingPromptHandler?(nil)
  }

  private func startRecording(for meeting: DetectedMeeting?) async {
    guard canStart else { return }
    dismissalTask?.cancel()
    if meeting == nil {
      detectedMeeting = nil
      meetingPromptHandler?(nil)
    }
    phase = .preparing
    elapsedSeconds = 0
    waveform = Array(repeating: 0.08, count: waveform.count)

    let id = UUID()
    var pendingOutputURL: URL?
    do {
      let outputURL = try await archive.audioURL(for: id)
      pendingOutputURL = outputURL
      let startedAt = Date()
      try await capture.start(
        outputURL: outputURL,
        meterHandler: { [weak self] level in
          Task { @MainActor [weak self] in
            self?.appendWaveform(level)
          }
        },
        failureHandler: { [weak self] _ in
          Task { @MainActor [weak self] in
            guard let self, self.phase == .recording else { return }
            await self.stopRecording()
          }
        }
      )
      activeRecordingID = id
      activeOutputURL = outputURL
      activeStartedAt = startedAt
      activeMeetingSessionID = meeting?.id
      if meeting != nil {
        meetingPromptHandler?(nil)
      }
      phase = .recording
      startElapsedTimer(from: startedAt)
    } catch {
      if let pendingOutputURL {
        try? FileManager.default.removeItem(at: pendingOutputURL)
      }
      activeMeetingSessionID = nil
      showFailure(error.localizedDescription)
    }
  }

  func stopRecording(uploadAfterStop: Bool = true) async {
    guard phase == .recording,
      let id = activeRecordingID,
      let outputURL = activeOutputURL,
      let startedAt = activeStartedAt
    else {
      return
    }

    phase = .finalizing
    elapsedTask?.cancel()
    elapsedTask = nil

    do {
      try await capture.stop()
    } catch {
      clearActiveRecording()
      try? FileManager.default.removeItem(at: outputURL)
      showFailure(error.localizedDescription)
      return
    }

    let duration = max(1, Int(Date().timeIntervalSince(startedAt).rounded()))
    let recording = LocalRecording(
      id: id,
      title: Self.defaultTitle(for: startedAt),
      startedAt: startedAt,
      durationSeconds: duration,
      audioFilename: outputURL.lastPathComponent,
      uploadState: .local
    )
    recordings.insert(recording, at: 0)
    clearActiveRecording()
    await persistHistory()
    if uploadAfterStop {
      await upload(recordingID: id, controlsCapsule: true)
    } else {
      phase = .idle
    }
  }

  func retryUpload(_ recordingID: UUID) {
    guard uploadTasks[recordingID] == nil else { return }
    uploadTasks[recordingID] = Task { [weak self] in
      guard let self else { return }
      await self.upload(recordingID: recordingID, controlsCapsule: false)
      self.uploadTasks[recordingID] = nil
    }
  }

  func openInEngram(_ recording: LocalRecording) {
    guard let path = recording.remotePath,
      let serverURL = settings.serverURL,
      let url = URL(string: path, relativeTo: serverURL)?.absoluteURL
    else {
      return
    }
    NSWorkspace.shared.open(url)
  }

  func revealLocalFile(_ recording: LocalRecording) {
    NSWorkspace.shared.activateFileViewerSelecting([recording.audioURL])
  }

  func deleteRecording(_ recordingID: UUID, fromEngram: Bool = false) {
    guard deletionTasks[recordingID] == nil else { return }
    let uploadTask = uploadTasks.removeValue(forKey: recordingID)
    uploadTask?.cancel()

    deletingRecordingIDs.insert(recordingID)
    deletionTasks[recordingID] = Task { [weak self] in
      await uploadTask?.value
      guard let self else { return }
      defer {
        self.deletingRecordingIDs.remove(recordingID)
        self.deletionTasks[recordingID] = nil
      }
      guard !Task.isCancelled else { return }
      if fromEngram {
        await self.deleteRemoteAndLocalRecording(recordingID)
      } else {
        await self.deleteLocalRecording(recordingID)
      }
    }
  }

  func isDeleting(_ recordingID: UUID) -> Bool {
    deletingRecordingIDs.contains(recordingID)
  }

  func clearStatus() {
    guard !phase.isBusy else { return }
    phase = .idle
  }

  func quitApplication() {
    Task {
      if isRecording {
        await stopRecording(uploadAfterStop: false)
      }
      for task in uploadTasks.values {
        task.cancel()
      }
      for task in deletionTasks.values {
        task.cancel()
      }
      NSApp.terminate(nil)
    }
  }

  private func configureMeetingDetection(for mode: MeetingDetectionMode) {
    switch mode {
    case .off:
      meetingDetector.stop()
      detectedMeeting = nil
      activeMeetingSessionID = nil
      meetingPromptHandler?(nil)
    case .ask:
      meetingDetector.start()
      if let detectedMeeting, canStart {
        meetingPromptHandler?(detectedMeeting)
      }
    case .automatic:
      meetingDetector.start()
      meetingPromptHandler?(nil)
      if let detectedMeeting, canStart {
        Task { await startRecording(for: detectedMeeting) }
      }
    }
  }

  private func handleMeetingDetection(_ event: MeetingDetectionEvent) {
    switch event {
    case .started(let meeting):
      guard settings.meetingDetectionMode != .off else { return }
      detectedMeeting = meeting

      switch settings.meetingDetectionMode {
      case .off:
        break
      case .ask:
        if canStart { meetingPromptHandler?(meeting) }
      case .automatic:
        if canStart {
          Task { await startRecording(for: meeting) }
        }
      }

    case .ended(let meeting):
      if detectedMeeting?.id == meeting.id {
        detectedMeeting = nil
        meetingPromptHandler?(nil)
      }

      guard activeMeetingSessionID == meeting.id else { return }
      activeMeetingSessionID = nil
      if isRecording {
        Task { await stopRecording() }
      }
    }
  }

  private func upload(recordingID: UUID, controlsCapsule: Bool) async {
    guard let index = recordings.firstIndex(where: { $0.id == recordingID }) else {
      return
    }
    guard let serverURL = settings.serverURL, settings.isConfigured else {
      recordings[index].uploadState = .failed
      recordings[index].lastError = RecorderError.settingsIncomplete.localizedDescription
      await persistHistory()
      if controlsCapsule {
        showFailure("Saved locally — configure Engram to upload")
      }
      return
    }

    let token = settings.trimmedToken
    recordings[index].uploadState = .uploading
    recordings[index].lastError = nil
    if controlsCapsule { phase = .uploading }
    await persistHistory()

    do {
      let result = try await api.upload(
        recording: recordings[index],
        serverURL: serverURL,
        token: token
      )
      guard let updatedIndex = recordings.firstIndex(where: { $0.id == recordingID }) else {
        return
      }
      recordings[updatedIndex].uploadState = .uploaded
      recordings[updatedIndex].remoteID = result.id
      recordings[updatedIndex].remotePath = result.url
      recordings[updatedIndex].lastError = nil
      await persistHistory()

      if controlsCapsule {
        phase = .processing
        try? await Task.sleep(for: .seconds(1.1))
        guard !Task.isCancelled else { return }
        let remoteURL = URL(string: result.url, relativeTo: serverURL)?.absoluteURL
        if let remoteURL {
          phase = .success(remoteURL)
        } else {
          phase = .idle
        }
        scheduleDismissal()
      }
    } catch {
      guard let failedIndex = recordings.firstIndex(where: { $0.id == recordingID }) else {
        return
      }
      recordings[failedIndex].uploadState = .failed
      recordings[failedIndex].lastError = error.localizedDescription
      await persistHistory()
      if controlsCapsule {
        showFailure("Saved locally — upload failed")
      }
    }
  }

  private func loadHistory() async {
    do {
      recordings = try await archive.load().sorted { $0.startedAt > $1.startedAt }
      var changed = false
      for index in recordings.indices where recordings[index].uploadState == .uploading {
        recordings[index].uploadState = .failed
        recordings[index].lastError = "Upload was interrupted. Retry when ready."
        changed = true
      }
      if changed { await persistHistory() }
    } catch {
      showFailure("Could not load recording history")
    }
  }

  private func persistHistory() async {
    try? await archive.save(recordings)
  }

  private func deleteLocalRecording(_ recordingID: UUID) async {
    guard let recording = recordings.first(where: { $0.id == recordingID }) else {
      return
    }

    do {
      try await archive.deleteAudio(for: recording)
      recordings.removeAll { $0.id == recordingID }
      try await archive.save(recordings)
    } catch {
      showFailure("Could not delete the recording")
    }
  }

  private func deleteRemoteAndLocalRecording(_ recordingID: UUID) async {
    guard let index = recordings.firstIndex(where: { $0.id == recordingID }) else {
      return
    }
    guard let remoteID = recordings[index].remoteID else {
      showFailure("Could not identify the Engram recording — local copy kept")
      return
    }
    guard let serverURL = settings.serverURL, settings.isConfigured else {
      showFailure("Could not connect to Engram — local copy kept")
      return
    }

    recordings[index].lastError = nil
    do {
      try await api.deleteRecording(
        remoteID: remoteID,
        serverURL: serverURL,
        token: settings.trimmedToken
      )
      guard !Task.isCancelled else { return }
      await deleteLocalRecording(recordingID)
    } catch {
      guard !Task.isCancelled else { return }
      if let failedIndex = recordings.firstIndex(where: { $0.id == recordingID }) {
        recordings[failedIndex].lastError = error.localizedDescription
        await persistHistory()
      }
      showFailure("Could not delete from Engram — local copy kept")
    }
  }

  private func appendWaveform(_ level: Float) {
    waveform.removeFirst()
    waveform.append(level)
  }

  private func startElapsedTimer(from startedAt: Date) {
    elapsedTask?.cancel()
    elapsedTask = Task { [weak self] in
      while !Task.isCancelled {
        guard let self else { return }
        self.elapsedSeconds = max(0, Int(Date().timeIntervalSince(startedAt)))
        try? await Task.sleep(for: .seconds(1))
      }
    }
  }

  private func showFailure(_ message: String) {
    phase = .failure(message)
    scheduleDismissal(after: .seconds(5))
  }

  private func scheduleDismissal(after delay: Duration = .seconds(2.5)) {
    dismissalTask?.cancel()
    dismissalTask = Task { [weak self] in
      try? await Task.sleep(for: delay)
      guard !Task.isCancelled else { return }
      self?.phase = .idle
    }
  }

  private func clearActiveRecording() {
    activeRecordingID = nil
    activeOutputURL = nil
    activeStartedAt = nil
    activeMeetingSessionID = nil
  }

  private static func defaultTitle(for date: Date) -> String {
    date.formatted(
      Date.FormatStyle(date: .abbreviated, time: .shortened)
    )
  }
}
