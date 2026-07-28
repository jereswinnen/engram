import AppKit
import Foundation
import Observation

@MainActor
@Observable
final class RecorderController {
  private static let localRecordingRetention: TimeInterval = 7 * 24 * 60 * 60

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
  private let api: EngramAPIClient
  private let meetingDetector: GoogleMeetDetector
  private var activeRecordingID: UUID?
  private var activeOutputURL: URL?
  private var activeStartedAt: Date?
  private var activeMeetingSessionID: UUID?
  private var elapsedTask: Task<Void, Never>?
  private var dismissalTask: Task<Void, Never>?
  private var retentionCleanupTask: Task<Void, Never>?
  private var uploadTasks: [UUID: Task<Void, Never>] = [:]
  private var metadataTasks: [UUID: Task<Void, Never>] = [:]
  private var deletionTasks: [UUID: Task<Void, Never>] = [:]
  private(set) var deletingRecordingIDs: Set<UUID> = []

  init(settings: AppSettings) {
    let meetingDetector = GoogleMeetDetector()
    self.settings = settings
    api = EngramAPIClient(authSession: settings.authSession)
    self.meetingDetector = meetingDetector
    archive = RecordingArchive()
    meetingDetector.eventHandler = { [weak self] event in
      self?.handleMeetingDetection(event)
    }
    settings.meetingDetectionModeChanged = { [weak self] mode in
      self?.configureMeetingDetection(for: mode)
    }
    settings.authenticationChanged = { [weak self] binding in
      guard let self else { return }
      if binding == nil {
        self.cancelMetadataRefreshes()
      } else {
        self.refreshUploadedRecordingMetadata()
      }
    }
    configureMeetingDetection(for: settings.meetingDetectionMode)
    Task { [weak self] in
      guard let self else { return }
      await self.loadHistory()
      self.scheduleRetentionCleanup()
    }
  }

  var isRecording: Bool {
    phase == .recording
  }

  var canStart: Bool {
    switch phase {
    case .idle, .savedLocally, .failure:
      true
    default:
      false
    }
  }

  var isUploading: Bool {
    recordings.contains { $0.uploadState == .uploading }
  }

  var statusTitle: String {
    switch phase {
    case .idle:
      if let detectedMeeting {
        "\(detectedMeeting.title) detected"
      } else if isUploading {
        "Uploading to Engram…"
      } else {
        "Ready"
      }
    case .preparing:
      "Preparing…"
    case .recording:
      "Recording"
    case .finalizing:
      "Saving recording…"
    case .savedLocally:
      "Saved locally"
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
      uploadState: .local,
      authBinding: settings.currentBinding
    )
    recordings.insert(recording, at: 0)
    clearActiveRecording()
    await persistHistory()

    phase = .savedLocally
    scheduleDismissal(after: .seconds(1.1))
    if uploadAfterStop {
      startUpload(recordingID: id)
    }
  }

  func retryUpload(_ recordingID: UUID) {
    guard let index = recordings.firstIndex(where: { $0.id == recordingID }) else { return }
    if recordings[index].authBinding?.matches(settings.currentBinding) != true {
      guard let currentBinding = settings.currentBinding else {
        showFailure(RecorderError.settingsIncomplete.localizedDescription)
        return
      }
      let alert = NSAlert()
      if recordings[index].authBinding == nil {
        alert.messageText =
          "Attach this recording to \(settings.authAccount?.displayName ?? "this Engram account")?"
        alert.informativeText =
          "This recording predates account binding. Engram will attach it to the currently signed-in account before uploading."
      } else {
        alert.messageText = "Move this local recording to the current Engram sign-in?"
        alert.informativeText =
          "It is attached to a different server, account, or connection. This explicit reassignment changes where its audio will be uploaded."
      }
      alert.alertStyle = .informational
      alert.addButton(withTitle: "Attach & Upload")
      alert.addButton(withTitle: "Cancel")
      NSApp.activate()
      guard alert.runModal() == .alertFirstButtonReturn else { return }
      recordings[index].authBinding = currentBinding
      Task { [weak self] in
        guard let self else { return }
        await self.persistHistory()
        self.startUpload(recordingID: recordingID)
      }
      return
    }
    startUpload(recordingID: recordingID)
  }

  private func startUpload(recordingID: UUID) {
    guard uploadTasks[recordingID] == nil else { return }
    uploadTasks[recordingID] = Task { [weak self] in
      guard let self else { return }
      await self.upload(recordingID: recordingID)
      self.uploadTasks[recordingID] = nil
    }
  }

  func openInEngram(_ recording: LocalRecording) {
    guard let path = recording.remotePath,
      let serverURL = recording.authBinding?.serverURL ?? settings.serverURL,
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
    metadataTasks.removeValue(forKey: recordingID)?.cancel()

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
      for task in metadataTasks.values {
        task.cancel()
      }
      retentionCleanupTask?.cancel()
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

  private func upload(recordingID: UUID) async {
    guard let index = recordings.firstIndex(where: { $0.id == recordingID }) else {
      return
    }
    guard let serverURL = settings.serverURL, settings.isConfigured else {
      recordings[index].uploadState = .failed
      recordings[index].lastError = RecorderError.settingsIncomplete.localizedDescription
      await persistHistory()
      return
    }

    guard recordings[index].authBinding?.matches(settings.currentBinding) == true else {
      recordings[index].uploadState = .failed
      recordings[index].lastError =
        OAuthError.credentialBelongsToAnotherAccount.localizedDescription
      await persistHistory()
      return
    }
    recordings[index].uploadState = .uploading
    recordings[index].lastError = nil
    await persistHistory()

    do {
      let result = try await api.upload(
        recording: recordings[index],
        serverURL: serverURL
      )
      guard let updatedIndex = recordings.firstIndex(where: { $0.id == recordingID }) else {
        return
      }
      recordings[updatedIndex].uploadState = .uploaded
      recordings[updatedIndex].remoteID = result.id
      recordings[updatedIndex].remotePath = result.url
      recordings[updatedIndex].uploadedAt = Date()
      recordings[updatedIndex].lastError = nil
      await persistHistory()
      scheduleRetentionCleanup()
      startMetadataRefresh(recordingID: recordingID)
    } catch {
      guard let failedIndex = recordings.firstIndex(where: { $0.id == recordingID }) else {
        return
      }
      recordings[failedIndex].uploadState = .failed
      recordings[failedIndex].lastError = error.localizedDescription
      await persistHistory()
    }
  }

  private func loadHistory() async {
    do {
      recordings = try await archive.load().sorted { $0.startedAt > $1.startedAt }
      var changed = false
      let migrationDate = Date()
      for index in recordings.indices where recordings[index].uploadState == .uploading {
        recordings[index].uploadState = .failed
        recordings[index].lastError = "Upload was interrupted. Retry when ready."
        changed = true
      }
      // Older archive entries predate upload timestamps. Give them a full
      // retention window from this app version's first launch rather than
      // unexpectedly deleting them immediately.
      for index in recordings.indices
      where recordings[index].uploadState == .uploaded
        && recordings[index].uploadedAt == nil
      {
        recordings[index].uploadedAt = migrationDate
        changed = true
      }
      if changed { await persistHistory() }
      await deleteExpiredLocalRecordings(now: migrationDate)
      refreshUploadedRecordingMetadata()
    } catch {
      showFailure("Could not load recording history")
    }
  }

  private func persistHistory() async {
    try? await archive.save(recordings)
  }

  private func startMetadataRefresh(recordingID: UUID, maxAttempts: Int = 60) {
    guard metadataTasks[recordingID] == nil else { return }
    metadataTasks[recordingID] = Task { [weak self] in
      guard let self else { return }
      await self.refreshRemoteMetadata(
        recordingID: recordingID,
        maxAttempts: maxAttempts
      )
      self.metadataTasks[recordingID] = nil
    }
  }

  private func refreshUploadedRecordingMetadata(maxAttempts: Int = 3) {
    guard settings.currentBinding != nil else { return }
    for recording in recordings where recording.uploadState == .uploaded {
      guard recording.remoteID != nil else { continue }
      startMetadataRefresh(recordingID: recording.id, maxAttempts: maxAttempts)
    }
  }

  private func cancelMetadataRefreshes() {
    for task in metadataTasks.values {
      task.cancel()
    }
    metadataTasks.removeAll()
  }

  private func refreshRemoteMetadata(
    recordingID: UUID,
    maxAttempts: Int
  ) async {
    for attempt in 0..<maxAttempts {
      guard !Task.isCancelled,
        let index = recordings.firstIndex(where: { $0.id == recordingID }),
        let remoteID = recordings[index].remoteID,
        let serverURL = recordings[index].authBinding?.serverURL ?? settings.serverURL,
        let currentBinding = settings.currentBinding,
        recordingMetadataRefreshAllowed(
          storedBinding: recordings[index].authBinding,
          currentBinding: currentBinding
        )
      else { return }

      do {
        let metadata = try await api.recordingMetadata(
          remoteID: remoteID,
          serverURL: serverURL
        )
        guard let updatedIndex = recordings.firstIndex(where: { $0.id == recordingID }) else {
          return
        }
        if metadata.titleOrigin == "generated",
          recordings[updatedIndex].title != metadata.title
        {
          recordings[updatedIndex].title = metadata.title
          await persistHistory()
        }
        if metadata.status == "done" || metadata.status == "error" { return }
      } catch {
        if maxAttempts == 1 { return }
      }

      guard attempt + 1 < maxAttempts else { return }
      do {
        try await Task.sleep(for: .seconds(10))
      } catch {
        return
      }
    }
  }

  private func deleteLocalRecording(_ recordingID: UUID) async {
    guard let recording = recordings.first(where: { $0.id == recordingID }) else {
      return
    }

    do {
      try await archive.deleteAudio(for: recording)
      recordings.removeAll { $0.id == recordingID }
      try await archive.save(recordings)
      scheduleRetentionCleanup()
    } catch {
      showFailure("Could not delete the recording")
    }
  }

  private func deleteExpiredLocalRecordings(now: Date = Date()) async {
    let cutoff = now.addingTimeInterval(-Self.localRecordingRetention)
    let expired = recordings.filter { recording in
      recording.uploadState == .uploaded
        && recording.uploadedAt.map { $0 <= cutoff } == true
    }
    guard !expired.isEmpty else { return }

    var deletedIDs: Set<UUID> = []
    for recording in expired {
      do {
        try await archive.deleteAudio(for: recording)
        deletedIDs.insert(recording.id)
      } catch {
        // Keep the history entry so a filesystem failure can be retried later.
      }
    }

    guard !deletedIDs.isEmpty else { return }
    recordings.removeAll { deletedIDs.contains($0.id) }
    await persistHistory()
  }

  private func scheduleRetentionCleanup(now: Date = Date()) {
    retentionCleanupTask?.cancel()
    retentionCleanupTask = nil

    let nextExpiration = recordings.compactMap { recording -> Date? in
      guard recording.uploadState == .uploaded, let uploadedAt = recording.uploadedAt else {
        return nil
      }
      return uploadedAt.addingTimeInterval(Self.localRecordingRetention)
    }.min()
    guard let nextExpiration else { return }

    // A failed filesystem deletion leaves the entry eligible. Retry it later
    // instead of immediately spinning on the same expired recording.
    let interval = nextExpiration.timeIntervalSince(now)
    let delay = interval > 0 ? interval : 60 * 60
    retentionCleanupTask = Task { [weak self] in
      do {
        try await Task.sleep(for: .seconds(delay))
      } catch {
        return
      }
      guard let self, !Task.isCancelled else { return }
      self.retentionCleanupTask = nil
      await self.deleteExpiredLocalRecordings()
      self.scheduleRetentionCleanup()
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
    guard recordings[index].authBinding?.matches(settings.currentBinding) == true else {
      showFailure("This recording was uploaded by another connection — delete it from the web app")
      return
    }

    recordings[index].lastError = nil
    do {
      try await api.deleteRecording(
        remoteID: remoteID,
        serverURL: serverURL
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
