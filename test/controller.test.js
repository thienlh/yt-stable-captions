const test = require('node:test');
const assert = require('node:assert/strict');

// Loaded before `window` exists, so main.js does not auto-start.
require('../src/content/track-provider.js');
require('../src/content/main.js');

const { StableCaptionsController, TrackProvider } = globalThis.YTSC;

// ---- A fake page: just enough of window/document/location for the controller ----

const page = {
  search: '?v=A',
  pathname: '/watch',
  ccPressed: 'true',
};
globalThis.location = {
  get search() { return page.search; },
  get pathname() { return page.pathname; },
  get href() { return `https://www.youtube.com${page.pathname}${page.search}`; },
};
globalThis.window = globalThis;
globalThis.document = {
  documentElement: { dataset: {} },
  querySelector(selector) {
    if (selector === '.ytp-subtitles-button') {
      return { getAttribute: () => page.ccPressed };
    }
    return null; // no <video>: the frame loop has nothing to paint
  },
  getElementById: () => null,
  addEventListener() {},
};
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};

const watch = (id) => {
  page.search = `?v=${id}`;
  page.pathname = '/watch';
};

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

// Lets every pending promise callback run.
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

const payload = (label) => ({ words: [{ text: label, startMs: 0, endMs: 100 }] });

/**
 * A controller with fakes. `fetches` holds one deferred per fetchJson3 call (our
 * own track fetch), `refetches` one per fetchUrl call (a tap refetched as json3).
 */
function makeController({ tracksAfter = 0 } = {}) {
  const fetches = [];
  const refetches = [];
  let trackPolls = 0;
  const overlay = {
    calls: [],
    mount() { this.calls.push('mount'); },
    render(chunk) { this.calls.push(chunk ? `render:${chunk.text}` : 'render:null'); },
    clear() { this.calls.push('clear'); },
    destroy() { this.calls.push('destroy'); },
    setLift(steps) { this.lift = steps; },
  };
  // The real provider's language helpers, with the player and network faked.
  const provider = Object.assign(new TrackProvider(), {
    getTracksWithSource() {
      trackPolls++;
      if (trackPolls <= tracksAfter) return { tracks: [], source: 'none' };
      return { tracks: [{ baseUrl: `https://yt/api/timedtext?v=${page.search.slice(3)}` }], source: 'test' };
    },
    pickBest: (tracks) => tracks[0] || null,
    fetchJson3(track) {
      const d = deferred();
      fetches.push({ url: track.baseUrl, ...d });
      return d.promise;
    },
    fetchUrl(url) {
      const d = deferred();
      refetches.push({ url, ...d });
      return d.promise;
    },
  });
  const controller = new StableCaptionsController({
    provider,
    parser: { parseWords: (p) => p.words || [] },
    chunker: { build: (words) => words.map((w) => ({ ...w, words: [w] })) },
    disfluency: { clean: (words) => words },
    lookup: { atTime: (cues) => cues[0] || null },
    overlay,
    pollMs: 1,
  });
  return { controller, fetches, refetches, overlay };
}

const shown = (controller) => controller.cues.map((c) => c.text).join(' ');

test.beforeEach(() => {
  watch('A');
  page.ccPressed = 'true';
  delete globalThis.__ytscTimedtext;
});

// ---- Navigation races ----

test("a slow fetch for the previous video does not replace the new video's captions", async () => {
  const { controller, fetches } = makeController();
  controller.reload();
  await settle();
  watch('B');
  controller.reload();
  await settle();
  assert.equal(fetches.length, 2);

  fetches[1].resolve(payload('captions-B'));
  await settle();
  assert.equal(shown(controller), 'captions-B');

  fetches[0].resolve(payload('captions-A'));
  await settle();
  assert.equal(shown(controller), 'captions-B');
  assert.equal(controller.mode, 'timeline');
});

test("a failed fetch for the previous video does not drop the new video into live mode", async () => {
  const { controller, fetches } = makeController();
  controller.reload();
  await settle();
  watch('B');
  controller.reload();
  await settle();
  fetches[1].resolve(payload('captions-B'));
  await settle();

  fetches[0].reject(new Error('timedtext empty body'));
  await settle();
  assert.equal(shown(controller), 'captions-B');
  assert.equal(controller.mode, 'timeline');
  assert.equal(controller.live, null);
});

test('going A → B → A while the player is still booting loads A once', async () => {
  const { controller, fetches } = makeController({ tracksAfter: 4 });
  controller.reload();
  watch('B');
  controller.reload();
  watch('A');
  controller.reload();
  await settle();
  await settle();
  assert.equal(fetches.length, 1);
  assert.match(fetches[0].url, /v=A/);
});

// ---- The player's own caption download (tap) vs. our fetch ----

const tap = (lang) => ({
  url: `https://yt/api/timedtext?v=A&lang=${lang}&signed=1`,
  body: JSON.stringify(payload(`tapped-${lang}`)),
  videoId: 'A',
  lang,
});

test("the player's caption download wins over our fetch that finishes later", async () => {
  const { controller, fetches } = makeController();
  controller.reload();
  await settle();
  await controller.onTap(tap('de'));
  assert.equal(shown(controller), 'tapped-de');

  fetches[0].resolve(payload('best-track-en'));
  await settle();
  assert.equal(shown(controller), 'tapped-de', 'keeps the language the player picked');
});

test('the raw tap cache is bounded by entries and total characters', () => {
  const { controller } = makeController();
  for (let i = 0; i < 5; i++) {
    controller.rememberTap({ ...tap(`lang-${i}`), url: `https://yt/api/timedtext?v=A&signature=${i}`, body: 'x'.repeat(10) });
  }
  assert.equal(controller.taps.length, 4, 'keeps only the four newest entries');

  controller.tapCacheCharLimit = 25;
  controller.rememberTap({ ...tap('latest'), url: 'https://yt/api/timedtext?v=A&signature=latest', body: 'y'.repeat(10) });
  assert.equal(controller.taps.length, 2);
  assert.equal(controller.taps.reduce((sum, entry) => sum + entry.body.length, 0), 20);

  const oversized = { ...tap('huge'), url: 'https://yt/api/timedtext?v=A&signature=huge', body: 'z'.repeat(100) };
  globalThis.__ytscTimedtext = oversized;
  controller.rememberTap(oversized);
  assert.equal(controller.taps.length, 0, 'an over-budget body is not retained');
  assert.equal(globalThis.__ytscTimedtext, undefined, 'the global bridge does not retain it either');
});

// The player downloaded another format (not JSON), so the tap is refetched as json3.
const xmlTap = (lang) => ({ ...tap(lang), body: '<timedtext/>' });

test("the player's download still wins when its json3 refetch finishes after our fetch", async () => {
  const { controller, fetches, refetches } = makeController();
  controller.reload();
  await settle();
  const tapping = controller.onTap(xmlTap('de'));
  fetches[0].resolve(payload('best-track-en'));
  await settle();
  refetches[0].resolve(payload('tapped-de'));
  await tapping;
  assert.equal(shown(controller), 'tapped-de', 'keeps the language the player picked');
});

test('the newest caption download wins when two refetches overlap', async () => {
  for (const order of [[0, 1], [1, 0]]) {
    const { controller, fetches, refetches } = makeController();
    controller.reload();
    await settle();
    fetches[0].resolve(payload('best-track-en'));
    await settle();
    const taps = [controller.onTap(xmlTap('de')), controller.onTap(xmlTap('fr'))];
    const results = [payload('tapped-de'), payload('tapped-fr')];
    for (const i of order) {
      refetches[i].resolve(results[i]);
      await settle();
    }
    await Promise.all(taps);
    assert.equal(shown(controller), 'tapped-fr', `refetches finishing in order ${order}`);
  }
});

test('a tap refetch for a video the viewer has left is dropped', async () => {
  const { controller, fetches, refetches } = makeController();
  controller.reload();
  await settle();
  const tapping = controller.onTap(xmlTap('de'));
  watch('B');
  controller.reload();
  await settle();
  fetches[1].resolve(payload('captions-B'));
  await settle();
  refetches[0].resolve(payload('tapped-de'));
  await tapping;
  assert.equal(shown(controller), 'captions-B');
});

test('a fetch-only video does not retain the previous video\'s raw taps', async () => {
  const { controller, fetches } = makeController();
  controller.reload();
  await settle();
  const first = tap('de');
  globalThis.__ytscTimedtext = first;
  await controller.onTap(first);
  assert.equal(controller.taps.length, 1);

  watch('B');
  controller.reload();
  await settle();
  fetches[1].resolve(payload('captions-B'));
  await settle();
  assert.equal(shown(controller), 'captions-B');
  assert.equal(controller.taps.length, 0);
  assert.equal(globalThis.__ytscTimedtext, undefined);
});

test("our fetch failing after the player's download does not throw it away for live mode", async () => {
  const { controller, fetches } = makeController();
  controller.reload();
  await settle();
  await controller.onTap(tap('de'));

  fetches[0].reject(new Error('timedtext empty body'));
  await settle();
  assert.equal(shown(controller), 'tapped-de');
  assert.equal(controller.mode, 'timeline');
  assert.equal(controller.live, null);
});

test('a tapped video is not reloaded from scratch when the same video navigates again', async () => {
  const { controller, fetches } = makeController({ tracksAfter: 2 });
  const booting = controller.reload();
  await controller.onTap(tap('de')); // arrives before the player exposed its tracks
  await booting;
  await controller.reload();
  await settle();
  assert.equal(shown(controller), 'tapped-de');
  assert.equal(fetches.length, 0);
});

// ---- Native captions come back when we have nothing to show ----

test('a mini-player tap is not retained on a non-watch page', async () => {
  const { controller } = makeController();
  page.pathname = '/';
  page.search = '';
  const miniPlayerTap = tap('de');
  globalThis.__ytscTimedtext = miniPlayerTap;
  await controller.onTap(miniPlayerTap);
  assert.equal(controller.taps.length, 0);
  assert.equal(globalThis.__ytscTimedtext, undefined);
});

test('leaving the watch page (e.g. to the mini player) gives native captions back', async () => {
  const { controller, fetches, overlay } = makeController();
  controller.reload();
  await settle();
  fetches[0].resolve(payload('captions-A'));
  await settle();
  controller.rememberTap(tap('de'));
  globalThis.__ytscTimedtext = tap('de');
  page.pathname = '/';
  page.search = '';
  overlay.calls.length = 0;
  await controller.reload();
  assert.equal(controller.mode, 'idle');
  assert.equal(controller.taps.length, 0, 'leaving the video releases raw caption bodies');
  assert.equal(globalThis.__ytscTimedtext, undefined);
  assert.ok(overlay.calls.includes('destroy'), 'removes the overlay and the native-caption hider');
});

test('a video without caption tracks gives native captions back', async () => {
  const { controller, overlay } = makeController();
  controller.provider.pickBest = () => null;
  await controller.reload();
  assert.equal(controller.mode, 'none');
  assert.ok(overlay.calls.includes('destroy'));
});

test('live mode without its source module gives native captions back', async () => {
  const { controller, fetches, overlay } = makeController();
  const { LiveDomSource } = globalThis.YTSC;
  delete globalThis.YTSC.LiveDomSource;
  try {
    controller.reload();
    await settle();
    fetches[0].reject(new Error('timedtext empty body'));
    await settle();
    assert.equal(controller.mode, 'none');
    assert.ok(overlay.calls.includes('destroy'));
    assert.ok(!overlay.calls.includes('mount'));
  } finally {
    if (LiveDomSource) globalThis.YTSC.LiveDomSource = LiveDomSource;
  }
});

// ---- Live mode follows the CC toggle ----

test('turning CC off in live mode clears the shown caption right away', async () => {
  let source = null;
  globalThis.YTSC.LiveChunker = class { setStyle() {} };
  globalThis.YTSC.LiveDomSource = class {
    constructor({ onChunk }) { this.onChunk = onChunk; source = this; }
    start() {}
    stop() {}
    observe() {}
  };
  const { controller, fetches, overlay } = makeController();
  controller.reload();
  await settle();
  fetches[0].reject(new Error('timedtext empty body'));
  await settle();
  assert.equal(controller.mode, 'live');

  source.onChunk({ text: 'hello there', words: [{ text: 'hello' }, { text: 'there' }] });
  assert.equal(overlay.calls.at(-1), 'render:hello there');

  page.ccPressed = 'false';
  controller.renderNow(); // what the aria-pressed observer calls
  assert.equal(overlay.calls.at(-1), 'render:null');
  controller.stop();
});

// ---- Caption position (Shift+K/J) is per video and never stored ----

const shifted = (key, mods = {}) => {
  const e = { key, shiftKey: true, altKey: false, ctrlKey: false, metaKey: false, target: null, ...mods };
  e.defaultPrevented = false;
  e.preventDefault = () => { e.defaultPrevented = true; };
  e.stopImmediatePropagation = () => {};
  return e;
};

test('Shift+K/J moves the captions for this video, within range', async () => {
  const { controller, fetches, overlay } = makeController();
  const toasts = [];
  controller.showToast = (text) => toasts.push(text);
  controller.reload();
  await settle();
  fetches[0].resolve(payload('captions-A'));
  await settle();

  controller.onPositionKey(shifted('K'));
  controller.onPositionKey(shifted('K', { repeat: true }));
  assert.equal(overlay.lift, 2);
  assert.equal(toasts.at(-1), 'Caption position: up 2');

  for (let i = 0; i < 30; i++) controller.onPositionKey(shifted('K'));
  assert.equal(overlay.lift, controller.liftRange.max);
  for (let i = 0; i < 30; i++) controller.onPositionKey(shifted('J'));
  assert.equal(overlay.lift, controller.liftRange.min);

  // YouTube's play/pause key, typed plainly and with Caps Lock on.
  for (const plain of [shifted('k', { shiftKey: false }), shifted('K', { shiftKey: false })]) {
    controller.onPositionKey(plain);
    assert.equal(plain.defaultPrevented, false);
  }
  assert.equal(overlay.lift, controller.liftRange.min);
  controller.stop();
});

test('the caption position resets on the next video and leaves storage alone', async () => {
  const { controller, fetches, overlay } = makeController();
  controller.showToast = () => {};
  controller.reload();
  await settle();
  fetches[0].resolve(payload('captions-A'));
  await settle();
  controller.onPositionKey(shifted('K'));
  controller.onPositionKey(shifted('K'));
  assert.equal(overlay.lift, 2);

  watch('B');
  controller.reload();
  await settle();
  assert.equal(overlay.lift, 0);
  fetches[1].resolve(payload('captions-B'));
  await settle();
  controller.onPositionKey(shifted('K'));
  assert.equal(overlay.lift, 1, 'counts from the default, not from video A');
  controller.stop();
});

test('Shift+K does nothing while captions are off', async () => {
  const { controller, fetches, overlay } = makeController();
  controller.showToast = () => {};
  controller.reload();
  await settle();
  fetches[0].resolve(payload('captions-A'));
  await settle();
  page.ccPressed = 'false';
  const e = shifted('K');
  controller.onPositionKey(e);
  assert.equal(e.defaultPrevented, false);
  assert.equal(overlay.lift, undefined);
  controller.stop();
});
