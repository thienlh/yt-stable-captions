# YT Stable Captions — MVP

Replaces YouTube's flowing auto-captions with short, stable caption chunks
(≤6 words, shown whole) on a frosted, visionOS-inspired panel, with a
subtle emphasis on the word being spoken. A bold TikTok style is available
from the toolbar popup, for fun.

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
- `src/content/timedtext-tap.js` — captures the player's caption response
- `src/content/live-source.js` — caption DOM → new words → live chunks
- `src/content/track-provider.js` — track discovery + `fmt=json3` fetch
- `src/content/overlay.js` — DOM rendering only
- `src/content/settings-bridge.js` — popup settings → `<html data-ytsc-style/-size>` (isolated world)
- `src/popup/` — toolbar popup: caption style (Frosted / TikTok), text size
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

## Playgrounds

Open directly in Chromium (no build step); both run the real `src/core` code:

- `playground/caption-styles.html` — compare caption styles, chunk sizes, highlight modes
- `playground/speaker-marks.html` — ways to handle YouTube's `>>` speaker-change marks

Inter is bundled from https://rsms.me/inter (SIL OFL 1.1, see `fonts/Inter-LICENSE.txt`).

## Next iterations

1. Punctuation/AI pass (local Ollama helper, cached by videoId+lang)
2. More popup settings: chunk size, hold time
3. Side transcript panel (Omarchy app candidate — reader, not overlay)
