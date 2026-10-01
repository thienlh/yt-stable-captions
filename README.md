# YT Stable Captions — MVP

Replaces YouTube's flowing auto-captions with short, stable caption chunks
(≤6 words, shown whole) on a frosted, visionOS-inspired panel, with a
subtle emphasis on the word being spoken. A bold, playful **Short** style is
available from the toolbar popup.

## What the MVP does

- Captions source, in order:
  1. **Tap**: the player's own signed timedtext download, captured at
     `document_start` (follows the CC language you pick in the player)
  2. **Fetch**: our own `fmt=json3` request (often gated by YouTube → empty body)
  3. **Live**: YouTube's caption DOM, diffed to new words only
- Extracts timed words (ASR per-word offsets; manual lines spread by length)
- De-dupes rolling ASR windows (`Was` → `Was bedeutet` → `Was bedeutet das?`)
- Cuts words into chunks at max words/chars, sentence ends, commas and pauses
- Hides `.ytp-caption-window-container`, renders its own frosted overlay (bundled Inter font)
- Syncs via `requestAnimationFrame` against `video.currentTime`

Live mode can't see the future, so it shows each chunk once it is complete
(~1–2 s behind speech). Turning CC on lets the tap switch to exact timing.

No AI cleanup yet — that is the next iteration. The deterministic cues alone
remove the flowing-text distraction.

## Structure (SOLID)

- `src/core/text-utils.js` — string normalization only
- `src/core/rolling-merger.js` — rolling-window merge only
- `src/core/json3-parser.js` — JSON3 → stable cues (rollup + streaming paths)
- `src/core/cue-lookup.js` — binary-search `cueAtTime`
- `src/core/chunker.js` — timed words → short chunks (batch + live)
- `src/core/disfluency.js` — clean verbatim: drop fillers (en/de/vi) and repeats, `[Music]` → ♪, repair punctuation/timing
- `src/content/timedtext-tap.js` — captures the player's caption response
- `src/content/live-source.js` — caption DOM → new words → live chunks
- `src/content/track-provider.js` — track discovery + `fmt=json3` fetch
- `src/content/overlay.js` — DOM rendering only
- `src/content/settings-bridge.js` — popup settings → `<html data-ytsc-style/-size>`, font registration (isolated world)
- `src/content/page-loader.js` — injects page-world scripts when `world: MAIN` is unsupported (Safari)
- `src/core/settings.js` — settings vocabulary (keys, defaults, sizes, levels, labels) shared by popup and bridge
- `src/popup/` — toolbar popup: both styles previewed live, size, background, clean verbatim
- `src/content/main.js` — composition root (`StableCaptionsController`)

Core files attach to `globalThis.YTSC` and also export via CommonJS, so the
same code runs in the extension and under `node --test`.

## Run tests

```bash
cd yt-stable-captions
npm test
```

## Try in Chromium

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select this folder (`yt-stable-captions`)
4. Open a YouTube watch page with captions, e.g. any video with auto-subs
5. Turn **CC on** in the player (the player's download is what gets tapped)
6. DevTools console → filter `[ytsc]` (enable *Verbose* level) → expect `N chunks (tap lang=…)`
7. Native captions disappear; short chunks appear on a translucent frosted panel

To disable: `chrome://extensions` → toggle off.

## Clean verbatim (on by default)

Popup toggle or `Shift+C`. Drops hesitation fillers (*um, uh, er* · *äh, ähm* · *ờ, ừm*) and
stumbles (*I I I think*, *It's, um, it's*), keeping the last copy of a repeat; moves sentence
punctuation and capitals onto neighbouring words and absorbs the dropped time so chunks don't
split on fake pauses. YouTube's `[Music]` tags (`[Musik]`, `[âm nhạc]`, …) become a standalone
♪ chunk, merged when consecutive; other tags like `[Applause]` stay. In live mode it works per
chunk, so repeats spanning two chunks remain.
Known rough edges: a leftover comma (*Und, am Anfang*) and legitimate doubles (*that that*).

## Popup

Both styles play side by side as live previews (the extension's own chunker and cleaner), so
choosing one is a click on the picture. Below: text size (Tiny → XXL, seven steps), the current
style's background level, and clean verbatim. The status dot says whether the active tab is a
YouTube video (readable via the youtube.com host permission; no `tabs` permission). The same
shortcuts work inside the popup. Kanagawa blue accent; follows the system light/dark mode.

## Keyboard shortcuts

Same keys as YouTube's own captions:

| Key | Action |
|---|---|
| `c` | Captions on/off — YouTube's own toggle; the overlay follows the player's CC state |
| `=` / `+` | Larger caption text (while stable captions are showing) |
| `-` | Smaller caption text |
| `w` | Cycle background: frosted panel Clear → Light → Medium → Dark → Solid; Short box Off → 25–100% |
| `Alt+C` / `⌥C` | Switch style: Frosted ↔ Short |
| `Shift+C` | Clean verbatim on/off — hide *um, uh* and stumbles like *I I I think* |

Setting keys are taken over only while the stable captions are visible (otherwise they reach
YouTube as usual), are ignored while typing or with Ctrl/⌘ (Alt only for `Alt+C`), and save to the popup setting.

## Try in Safari (macOS)

Needs Xcode. From a clone of this repo:

```bash
xcrun safari-web-extension-converter . --app-name "YT Stable Captions" --macos-only --copy-resources
```

1. Xcode opens the generated project → **Run** (⌘R); a small host app launches
2. Safari → Settings → Advanced → **Show features for web developers**
3. **Develop → Allow Unsigned Extensions** (resets on every Safari quit unless signed
   with a paid Apple Developer team)
4. Safari → Settings → Extensions → enable **YT Stable Captions**, allow on youtube.com

Safari notes:
- If Safari ignores `"world": "MAIN"`, `src/content/page-loader.js` injects the same
  page-world scripts via `<script src>` (web-accessible resources) instead
- The font is registered at runtime with the browser's own extension URL; on Safari the
  caption uses the real system font (SF Pro) via `@supports (font: -apple-system-body)`
- Settings use `storage.sync` when available, else `storage.local` (per-Mac)

## Playgrounds

Open directly in Chromium (no build step); both run the real `src/core` code:

- `playground/caption-styles.html` — compare caption styles, chunk sizes, highlight modes
- `playground/speaker-marks.html` — ways to handle YouTube's `>>` speaker-change marks
- `playground/popup-ui.html` — popup designs; A2 is what shipped
- `playground/disfluency.html` — verbatim vs dimmed vs cleaned fillers/repeats, both styles

Inter is bundled from https://rsms.me/inter (SIL OFL 1.1, see `fonts/Inter-LICENSE.txt`); the popup title uses
Instrument Serif, latin subset (SIL OFL 1.1, see `fonts/InstrumentSerif-LICENSE.txt`).

## Next iterations

1. Punctuation/AI pass (local Ollama helper, cached by videoId+lang)
2. More popup settings: chunk size, hold time
3. Side transcript panel (Omarchy app candidate — reader, not overlay)
