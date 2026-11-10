# Memory optimization project

## Status

First measurement and optimization pass: 2026-11-10, macOS 27.2, Safari/JSC
27.2, Node 26.8.2, Chrome 157. The copy-on-write and bounded-cache changes below are
implemented and covered by 160 passing tests. Whole-tab Safari A/B validation is
still pending; macOS blocked Safari UI, Apple Events JavaScript, and preference
automation in the initial environment.

## Goal

Minimize Stable Captions' memory cost in Safari and the other supported browsers
without changing caption output, language switching, navigation behavior, or accessibility. Optimize in this order:

1. memory retained in background and paused YouTube tabs;
2. peak memory while loading, switching languages, or rebuilding chunks;
3. fixed cost in every matching frame, including iframes;
4. transient allocation rate during playback and in the popup.

Non-matching tabs already receive no content scripts. Keep it that way.

## Measurement rules

- Use the same real caption payload for before/after comparisons.
- Measure after explicit garbage collection for the object ledger. Report medians
  from fresh processes, not a single reading.
- Distinguish retained memory from temporary allocation peaks and from allocator
  pages that remain reserved after release.
- Do not present JSON/download byte size or extension bundle size as RAM usage.
- Do not call a one-time rise a leak. A leak requires a continuing post-GC slope
  after warm-up.
- Validate whole-tab conclusions in Safari. JavaScriptCore's standalone `jsc`
  footprint excludes WebKit DOM, compositing, networking, and Safari UI costs.

## Reproducible object and engine ledger

`scripts/memory-benchmark.js` runs the real controller, JSON3 parser, cleaner, and
chunker against a JSON3 fixture. `scripts/memory-jsc-driver.js` is its Safari-engine
runner; it is not included in extension builds.

```sh
npm run memory -- \
  --fixture .context/memory-baseline/asr-en.json3 \
  --runs 5 \
  --json .context/memory-baseline/results.json
```

Useful variations:

```sh
# One scenario while developing
npm run memory -- --fixture /path/to/captions.json3 --scenario timeline --runs 3

# Repeat the fixture's events to approximate a 4x-longer track
npm run memory -- --fixture /path/to/captions.json3 --scenario scaled --scale 4

# Only the JavaScriptCore binary shipped with macOS
npm run memory -- --fixture /path/to/captions.json3 --engines jsc

# Compare an archived original source tree and reduce JIT allocator noise
npm run memory -- --fixture /path/to/captions.json3 --engines jsc \
  --source-root .context/memory-baseline/original --jsc-arg --useJIT=false

# Override the engine binary (for example, a WebKit checkout)
JSC=/path/to/jsc npm run memory -- --fixture /path/to/captions.json3 --engines jsc
```

A public reference payload can be obtained with `yt-dlp` without downloading video:

```sh
yt-dlp --skip-download --write-auto-subs --no-write-subs \
  --sub-langs en --sub-format json3 \
  -o '.context/memory-baseline/asr-%(id)s.%(ext)s' \
  'https://www.youtube.com/watch?v=aircAruvnKk'
```

YouTube can change a caption track over time. Record a fixture hash with every
baseline and keep the exact fixture locally for comparisons; do not silently
compare results from different downloads.

### Scenarios

| Scenario | What remains after GC |
| --- | --- |
| `empty` | Engine and harness only |
| `code` | Extension main-world classes, no caption data |
| `raw` | Code plus the raw JSON3 response string |
| `payload` | Code plus the parsed JSON3 response |
| `words` | Code plus parsed timed words |
| `timeline-no-clean` | Active controller, original words/chunks, one raw tapped response |
| `timeline` | Active controller with Clean Verbatim, one raw tapped response |
| `released` | Released controller; the optimized implementation also clears tap state |
| `cleared` | Released controller with tap cache explicitly cleared again |
| `cache8` | Eight distinct copies of the complete raw response |
| `scaled` | Active timeline after repeating the fixture `--scale` times |

Node/V8's **current** value is `heapUsed` after GC and is the primary structural
object-retention comparison. JavaScriptCore's **current/peak** values are process
`phys_footprint`. JSC allocator reservations and compiled code mean its current
value need not return to the code baseline after objects are released; use fresh
scenario processes and do not interpret `released - cleared` as exact object size.

## Baseline fixture

Initial local baseline, downloaded 2026-11-10:

- video: `aircAruvnKk`, *But what is a neural network? | Deep learning chapter 1*;
- automatic English captions, 1,106.72 seconds of timed content;
- 293,469 bytes of JSON3, 1,066 events;
- 3,365 parsed words, 3,360 cleaned words, 769 cleaned chunks;
- ASR fixture SHA-256: `957e61a0a89115decde39949fe8e34178e2485220ff433986c90bc630a6b8f6f`;
- manual English comparison: 46,010 bytes, 3,357 words, 286 chunks;
- manual fixture SHA-256: `ecbd75e8d72ec09d39a644018e462ed4e34db5a35f791839271f868ee276aa45`.

The full transcript fixture stays in gitignored `.context/`; only measurements and
the reproducible downloader are recorded here.

## First-pass results

All values below are **medians of five fresh Node/V8 processes after explicit GC**.
They include the harness and engine baseline, so they are scenario totals, not
promised Safari MB/tab savings. The raw JSON results are in gitignored
`.context/memory-baseline/`.

| Scenario | Before | After | Saving | Structural change |
| --- | ---: | ---: | ---: | --- |
| Active ASR timeline, 18.4 min | 6.65 MiB | 6.49 MiB | 0.16 MiB (2.4%) | 3,360 → 5 additional word objects |
| Active manual timeline, 18.4 min | 6.34 MiB | 6.18 MiB | 0.16 MiB (2.5%) | 3,357 → 426 additional word objects* |
| Active ASR timeline, repeated 4× | 12.94 MiB | 12.23 MiB | 0.71 MiB (5.5%) | 13,440 → 20 additional word objects |
| Released after ASR timeline | 4.68 MiB | 4.42 MiB | 0.26 MiB | 1 → 0 retained raw bodies |
| Eight raw bodies offered to cache | 6.44 MiB | 5.06 MiB | 1.38 MiB (21.4%) | 8 → 3 retained bodies |

\* Manual-caption line balancing intentionally clones 426 words to add line-break
metadata; the cleaner itself shares unchanged words.

The cache's raw character retention falls from 2,347,752 to 880,407 code units in
this fixture. It now has a four-entry and 1,000,000-total-character bound, clears
on video changes/releases, and never retains an individually over-budget body.

JavaScriptCore confirms the object-identity change but its standalone retained
process footprint is too allocator/JIT-sensitive for a reliable saving claim.
With JIT disabled, the ASR active-timeline **peak** falls from 14.72 to 14.42 MiB
(about 0.30 MiB). Treat that as a diagnostic peak result only. No whole-tab Safari
saving is claimed yet.

## Real Chromium A/B runner

`scripts/browser-memory-chrome.js` launches Google Chrome with disposable profiles
and uses the DevTools protocol directly (no npm/browser automation dependency).
It never attaches to the user's normal Chrome session. Chrome 137+ requires the
`Extensions.loadUnpacked` path used by the runner; headless mode is rejected if the
extension does not actually activate.

```sh
npm run chrome:build
npm run memory:chrome -- \
  --fixture .context/memory-baseline/asr-en.json3 \
  --url 'https://www.youtube.com/watch?v=aircAruvnKk&autoplay=0&mute=1' \
  --settle-ms 5000 --runs 3 \
  --json .context/memory-baseline/chrome-results.json
```

Both modes enable native CC and pause the same watch page. With `--fixture`, the
extension-on run installs the real reference JSON3 through the actual controller
before collection, producing a 3,365-word timeline and one 293,469-character raw
body. This controlled installation avoids YouTube's current live-fallback/gating
variability; it is a caption-memory experiment, not a timed-text download test.
A diagnostic controller hook is present only for fixture/debug runs.

The runner forces V8 GC and records `Performance.getMetrics` plus the main target
renderer's macOS `phys_footprint`. Other renderer processes are not summed, and
whole-renderer deltas can be dominated by YouTube media/DOM variance. Post-GC JS
heap is therefore the primary browser comparison; ranges and raw samples are
saved alongside medians.

### Chrome 157 observations (not a stable delta)

Three warmed, isolated profile pairs produced these post-GC medians:

| Mode | JS heap used | Range | Main-renderer footprint | Range |
| --- | ---: | ---: | ---: | ---: |
| Extension off | 65.31 MiB | 56.17–67.64 MiB | 487.53 MiB | 472.03–518.05 MiB |
| Extension on + controlled timeline | 67.76 MiB | 67.58–69.95 MiB | 416.55 MiB | 414.55–502.88 MiB |

The three-pair median on−off JS-heap difference was **2.45 MiB**, but a separate
warmed validation pair differed by **12.11 MiB**. YouTube page-state variation
therefore prevents a stable cross-profile JS-heap estimate. Renderer footprint
also moved 70.98 MiB in the opposite direction in the three-pair run, so it gives
no reliable whole-renderer delta either. **The current real-browser A/B result is
inconclusive; no Chrome MB/tab claim is made.** Raw samples are saved in
`.context/memory-baseline/chrome-results.json` and `chrome-final-check.json`.

For Edge or another Chromium installation, pass `--chrome /path/to/browser` (or
set `CHROME`). The shared optimizations also ship to Firefox, but Firefox was not
installed on the baseline machine; its SpiderMonkey memory behavior remains a
separate measurement rather than an extrapolation from V8.

## Optimization backlog

Each item needs a before/after benchmark and the full test suite. Convert a
hypothesis into a claimed saving only after measurement.

### P0 — low-risk retained-memory wins (first pass implemented)

- **Copy-on-write Clean Verbatim.** Implemented: unchanged word objects are shared;
  only text/timing repairs are cloned. Identity tests also verify that source
  words are never mutated.
- **Bound raw tap retention by characters and entry count.** Implemented: at most
  four current-video entries and 1,000,000 total UTF-16 code units. Oversized and
  evicted bodies cannot remain through the global latest-entry bridge. A cache-miss
  switch refetches the signed track (including auto-translation) if YouTube serves
  it from its own cache without emitting a new download.
- **Release stale-video state.** Implemented: fetch-only/live video changes cannot
  inherit old raw bodies, and controller release clears tap state. Cached
  same-video language switching remains covered by the existing language tests.

### P1 — peaks and exceptional-path accumulation

- **Abort obsolete fetches and response consumption.** Generation counters ignore
  stale results but do not currently cancel their network/body work. Measure with
  10/25/50 delayed requests, then resolve all requests and verify recovery.
- **Avoid avoidable chunk-build copies.** Measure initial-load and rechunk peaks;
  do not trade a small allocation saving for behavior changes.
- **Measure the eight-body worst case and loading overlap.** Raw response, parsed
  payload, old timeline, new timeline, and response cloning can coexist.

### P1 — Safari whole-tab and per-frame baseline

- Build a dedicated Safari A/B run with Stable Captions enabled versus disabled,
  using identical paused pages and a separate test window.
- Record WebContent `phys_footprint` after warm-up, using repeated samples and
  medians. Map every process belonging to the test window, including cross-site
  frames; do not attribute unrelated background-tab changes to the extension.
- Test 0/1/4/8 nonplaying embeds, ordinary non-video YouTube pages, paused watch
  pages, playing watch pages, and background tabs.
- Only then prioritize script splitting, minification, CSS duplication, or font
  loading. Source bytes alone are not a RAM measurement.

### P2 — larger redesigns, only if the measured cost justifies them

- Compact timeline storage (for example, numeric timing arrays plus string
  storage) with a benchmark for lookup and rechunk CPU cost.
- Windowed caption retention instead of whole-video retention, including backward
  seeks, language changes, and style/clean-setting rebuilds.
- Popup WebGL/compositing/font experiments and explicit disposal, based on 50
  open/close cycles and GPU-process measurements rather than source inspection.
- Live-mode observer narrowing and allocation-rate work, while preserving caption
  diffs and CC-off behavior.

## Acceptance gates

1. `npm test` passes, including focused identity/lifetime tests for the change.
2. Caption text/timing and style output are unchanged except for intentional
   cache-eviction behavior, which must retain a correct reload fallback.
3. Report retained delta and peak delta separately, with ranges where noisy.
4. Confirm no continuing post-GC growth across repeated navigation or popup cycles.
5. A whole-tab Safari measurement is required before publishing user-facing MB/tab
   claims. Engine-lab numbers are diagnostics, not Safari A/B results.
