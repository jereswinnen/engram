# Engram Recorder

A native macOS 15+ menu-bar recorder that captures microphone and system audio,
keeps a recoverable local M4A, and uploads it directly to Engram.

## Current phases

1. **Engram ingestion — complete.** `POST /api/recordings` accepts the dedicated
   recorder bearer token and metadata without reusing `CRON_SECRET`.
2. **Native recording core — complete.** `AVAudioEngine` captures the microphone,
   `ScreenCaptureKit` supplies system audio, and a dedicated mixer writes 48 kHz,
   stereo, 192 kbps AAC to M4A.
3. **Recovery and upload — complete.** Recordings are finalized in Application
   Support before upload. History survives relaunches, interrupted uploads become
   retryable, and multipart bodies are streamed through a temporary file rather than
   held in memory.
4. **Menu-bar experience — complete.** The app is an `LSUIElement` with no Dock icon,
   a global ⌘⇧R shortcut, an always-on-top draggable `NSPanel` capsule, a throttled
   live waveform, recent history, Settings, retry, Finder reveal, and Open in Engram.
5. **Real-meeting validation — pending.** Sign the app with the intended Developer ID,
   deploy the backend token, then compare several calls against Plaud before removing
   any Plaud code.

## Configure

1. Generate a token with `openssl rand -hex 32`.
2. Set the same value as `MAC_RECORDER_API_TOKEN` in the Engram deployment.
3. Open Engram Recorder → Settings and enter the Engram base URL and token. The token
   is stored in Keychain.
4. Start with the menu-bar control or ⌘⇧R. Grant Microphone and Screen & System Audio
   Recording access when macOS asks.

Local audio and history are stored inside the sandboxed Application Support container.
Successful recordings are retained locally for now; failed uploads are never deleted.

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

The capsule's “keep out of screen captures” option uses the native window-sharing
exclusion as a best effort. Screen-sharing applications can use different capture
stacks, so verify this with the actual meeting apps before relying on it.
