# Engram Recorder

A native macOS 15+ menu-bar recorder that captures microphone and system audio,
keeps a recoverable local M4A, and uploads it directly to Engram.

## Current phases

1. **Engram ingestion — complete.** The recorder uses its dedicated bearer token to
   initialize an idempotent upload, sends audio directly to R2 with a short-lived
   signed URL, and asks Engram to verify the stored byte count before processing.
2. **Native recording core — complete.** `AVAudioEngine` captures the microphone,
   `ScreenCaptureKit` supplies system audio, and a dedicated mixer writes 48 kHz,
   stereo, 96 kbps AAC to M4A.
3. **Recovery and upload — complete.** Recordings are finalized in Application
   Support before upload. History survives relaunches, interrupted uploads become
   retryable, retries reuse the local recording UUID, and a completed R2 object is
   reused after an interruption instead of being uploaded twice. Confirmed uploads
   are removed locally after seven days; failed and local-only recordings are kept.
4. **Menu-bar experience — complete.** The app is an `LSUIElement` with no Dock icon,
   a global ⌘⇧R shortcut, an always-on-top draggable `NSPanel` capsule, a throttled
   live waveform, recent history, Settings, retry, Finder reveal, and Open in Engram.
5. **Google Meet detection — complete.** Like Plaud, the app watches macOS power
   assertions for sustained WebRTC and browser-audio activity. It can ask before
   recording or automatically start and stop with the browser meeting.
6. **Real-meeting validation — pending.** Sign the app with the intended Developer ID,
   deploy the backend token, then compare several calls against Plaud before removing
   any Plaud code.

## Configure

1. Generate a token with `openssl rand -hex 32`.
2. Set the same value as `MAC_RECORDER_API_TOKEN` in the Engram deployment.
3. Open Engram Recorder → Settings and enter the Engram base URL and token. The token
   is stored in Keychain.
4. Start with the menu-bar control or ⌘⇧R. Grant Microphone and Screen & System Audio
   Recording access when macOS asks.
5. In Settings, choose whether meeting detection is Off, asks before recording, or
   records automatically. Ask before recording is the default.

Local audio and history are stored inside the sandboxed Application Support container.
Successful uploads are retained locally for seven days; failed uploads are never
deleted automatically.

## Build

```bash
xcodebuild \
  -project engram-recorder/engram-recorder.xcodeproj \
  -scheme "Engram Recorder" \
  -configuration Release \
  -destination "platform=macOS" \
  build
```

The target has App Sandbox, microphone input, and outgoing-network entitlements. Set
your Apple development team in Xcode before distributing the app.

## Source layout

- `App` — SwiftUI lifecycle, settings state, and the global shortcut.
- `Recording` — capture, mixing, persistence models, and recording coordination.
- `Services` — Engram networking and Keychain access.
- `UI` — menu-bar, capsule panel, and Settings views.
- `Resources` — sandbox entitlements and future app assets.

## Validation checklist

- Record silence, microphone-only speech, system-only speech, and overlapping speech.
- Confirm the M4A plays after stopping and after relaunching the app.
- Disable the network before stopping, then retry from history after reconnecting.
- Confirm the Engram link opens and the transcript contains both sides of the call.
- Test Bluetooth input, built-in input, headphones, sleep/wake, and an audio-device
  change during recording.
- Compare CPU, memory, battery use, channel balance, drift, and transcript quality with
  Plaud over several real meetings.
- Verify meeting detection in Chrome and Safari while muted and unmuted. Confirm that
  ordinary browser media does not trigger it, a manual stop does not immediately
  restart, and leaving a meeting automatically stops only a meeting-started recording.

The capsule's “keep out of screen captures” option uses the native window-sharing
exclusion as a best effort. Screen-sharing applications can use different capture
stacks, so verify this with the actual meeting apps before relying on it.
