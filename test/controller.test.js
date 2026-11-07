const test = require('node:test');
const assert = require('node:assert/strict');

// Loaded before `window` exists, so main.js does not auto-start.
require('../src/content/main.js');

const { StableCaptionsController } = globalThis.YTSC;

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
// The json3 rewrite of a tapped URL (the real one lives in track-provider.js).
globalThis.YTSC.TrackProvider = { withJson3: (url) => `${url}&fmt=json3` };
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
  };
  const provider = {
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
  };
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

test('leaving the watch page (e.g. to the mini player) gives native captions back', async () => {
  const { controller, fetches, overlay } = makeController();
  controller.reload();
  await settle();
  fetches[0].resolve(payload('captions-A'));
  await settle();
  page.pathname = '/';
  page.search = '';
  overlay.calls.length = 0;
  await controller.reload();
  assert.equal(controller.mode, 'idle');
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
