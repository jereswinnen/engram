# Engram Menu Bar History and Footer — Design QA

## Evidence

- Source visual truth: `/var/folders/x7/5tz__wk12dl664_sdlyqdf4h0000gn/T/codex-clipboard-3450f2ea-1993-41a7-ada1-dbd93352ee2a.png`
- Source pixels: 804 × 648.
- Source state: installed macOS menu-bar app, light appearance, ready state, three visible uploaded recordings.
- Intended implementation state: same 380 pt menu width and recording history, with a long generated title, fixed-width trailing actions, icon-only footer controls, and no shortcut label.
- Implementation screenshot: not captured at the user's explicit request not to run the app.

## Findings

- [P2] Visual verification is blocked because no rendered implementation screenshot was captured. The source shows the long first-row title compressing the Open action into a clipped vertical sliver. The code now gives the title the flexible track, explicitly truncates it at the tail, and keeps trailing actions at their intrinsic width, but that correction has not been visually compared.
- Fonts and typography: unchanged native SwiftUI system typography; the title remains a single medium-weight body line with explicit tail truncation.
- Spacing and layout rhythm: the 380 pt frame, header, history height, row padding, and separators are unchanged. Footer labels and the centered shortcut were removed, leaving two 28 × 24 pt icon control frames at opposite edges.
- Colors and visual tokens: unchanged native semantic colors and materials.
- Image quality and asset fidelity: no raster assets are present. Existing native SF Symbols are used for Settings and Quit.
- Copy and content: visible Settings, Quit, and keyboard-shortcut footer text are intentionally removed per the requested compact design. Accessibility labels and help text preserve their meaning.
- Interaction and accessibility: SettingsLink and Quit behavior are unchanged; both icon-only controls retain accessible names and tooltips. Open and overflow actions retain their existing behavior.

## Comparison History

### Pass 1 — blocked

- Source screenshot opened and inspected.
- The implementation compiled successfully in Xcode.
- The user explicitly asked not to run the app, so no same-state implementation capture or combined comparison was made.

## Implementation Checklist

- [x] Long titles truncate instead of compressing trailing actions.
- [x] Settings uses an icon-only native SettingsLink with an accessibility label.
- [x] Quit uses an icon-only button with an accessibility label.
- [x] Footer shortcut display removed.
- [ ] Same-state rendered screenshot comparison.

final result: blocked
