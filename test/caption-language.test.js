const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/content/track-provider.js');
require('../src/content/main.js');

const { TrackProvider, StableCaptionsController } = globalThis.YTSC;
const EN = { languageCode: 'en', kind: 'asr', baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=en&kind=asr' };
const VI = { languageCode: 'vi', baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=vi' };

/** What timedtext-tap.js publishes when the player downloads `url`. */
const tap = (url) => ({ videoId: 'abc', url, body: '{}' });

function setup({ tracks = [EN], translationLanguages = [{ languageCode: 'vi' }], defaultTrack = null, player } = {}) {
  const provider = new TrackProvider();
  provider.getTracksWithSource = () => ({ tracks, translationLanguages, defaultTrack, source: 'test' });
  provider.fetchJson3 = async () => { throw new Error('unexpected direct JSON3 track fetch'); };
  provider.fetchUrl = () => new Promise(() => {}); // no player download unless the test supplies one
  const calls = [];
  // One player object: the shortcut and the menu hook must wrap the same setOption.
  const fallbackPlayer = { setOption: (...args) => calls.push(args) };
  provider.getPlayer = () => (player === undefined ? fallbackPlayer : player);
  const controller = new StableCaptionsController({
    provider,
    parser: {},
    chunker: {},
    disfluency: {},
    lookup: {},
    overlay: {},
  });
  controller.currentVideoId = () => 'abc';
  controller.tapFor = () => null;
  controller.browserLanguage = () => 'vi-VN';
  controller.loadedUrl = tracks[0]?.baseUrl || null;
  controller.loaded = [];
  controller.useTimeline = (payload, url, label, source) => {
    controller.loaded.push(url);
    controller.loadedUrl = url;
    controller.noteLoadedCaption(url, source);
    return true;
  };
  controller.live = 0;
  controller.startLiveMode = () => { controller.live++; };
  controller.toasts = [];
  controller.showToast = (text) => controller.toasts.push(text);
  return { controller, calls };
}

test('Shift+L auto-translates through the player track and restores the source track', async () => {
  const { controller, calls } = setup();
  controller.rememberTap(tap(EN.baseUrl)); // the player's original download

  const switching = controller.toggleCaptionLanguage();
  assert.deepEqual(calls, [
    ['captions', 'track', { languageCode: 'en', kind: 'asr', translationLanguage: { languageCode: 'vi' } }],
  ]);
  assert.equal(controller.live, 1);
  assert.equal(controller.toasts.length, 0, 'no success toast before the translation arrives');

  await controller.onTap(tap(`${EN.baseUrl}&tlang=vi`));
  await switching;
  assert.deepEqual(controller.loaded, [`${EN.baseUrl}&tlang=vi`]);
  assert.match(controller.toasts[0], /auto-translated/);

  // The player answers its earlier track from cache, so the tapped original is reused.
  await controller.toggleCaptionLanguage();
  assert.deepEqual(calls[1], ['captions', 'track', { languageCode: 'en', kind: 'asr' }]);
  assert.equal(controller.loaded.at(-1), EN.baseUrl);
  assert.doesNotMatch(controller.toasts[1], /auto-translated/);
});

test('an existing browser-language track is selected in the player, not fetched', async () => {
  const { controller, calls } = setup({ tracks: [EN, VI] });

  const switching = controller.toggleCaptionLanguage();
  assert.deepEqual(calls, [['captions', 'track', { languageCode: 'vi' }]]);
  await controller.onTap(tap(VI.baseUrl));
  await switching;
  assert.deepEqual(controller.loaded, [VI.baseUrl]);
  assert.equal(controller.toasts[0], 'Captions: Tiếng Việt');
});

test('a later player download keeps the switched language', async () => {
  const { controller } = setup({ tracks: [EN, VI] });
  const switching = controller.toggleCaptionLanguage();
  await controller.onTap(tap(VI.baseUrl));
  await switching;

  // CC off/on: the player downloads its current (switched) track again.
  const again = tap(`${VI.baseUrl}&sig=2`);
  await controller.onTap(again);
  assert.equal(controller.loaded.at(-1), again.url);
  assert.equal(controller.activeCaptionLanguage, 'vi');
});

test('unsupported YouTube translation languages leave captions unchanged', async () => {
  const { controller, calls } = setup({ translationLanguages: [{ languageCode: 'fr' }] });

  await controller.toggleCaptionLanguage();
  assert.equal(calls.length, 0);
  assert.match(controller.toasts[0], /captions unavailable/);
});

test('without the player API nothing switches', async () => {
  const { controller } = setup({ player: null });

  await controller.toggleCaptionLanguage();
  assert.equal(controller.toasts[0], 'Could not switch caption language');
});

test('a switch whose captions never arrive says so and stops filtering taps', async () => {
  const { controller } = setup();
  controller.selectionTimeoutMs = 5;

  await controller.toggleCaptionLanguage();
  assert.equal(controller.toasts[0], 'Tiếng Việt captions did not load');
  assert.equal(controller.pendingSelection, null);
  await controller.onTap(tap(`${EN.baseUrl}&sig=2`));
  assert.equal(controller.loaded.length, 1);
});

test('during a switch, only the requested translated tap is accepted', async () => {
  const { controller } = setup();
  const loaded = [];
  controller.loadFromTap = async (entry, payloadPromise) => {
    if (payloadPromise) return new Promise(() => {}); // cache-miss fetch stays pending; the player tap must win
    loaded.push(entry.url);
    return true;
  };
  const switching = controller.toggleCaptionLanguage();

  await controller.onTap(tap(`${EN.baseUrl}&sig=2`));
  assert.equal(loaded.length, 0);
  await controller.onTap(tap(`${EN.baseUrl}&tlang=vi`));
  await switching;
  assert.deepEqual(loaded, [`${EN.baseUrl}&tlang=vi`]);
  assert.equal(controller.pendingSelection, null);
});

test('manual and ASR tracks in one language are told apart', () => {
  const { controller } = setup();
  const manual = { track: { languageCode: 'en' }, translationLanguage: null };
  assert.equal(controller.entryMatchesSelection(tap(EN.baseUrl), manual), false);
  assert.equal(controller.entryMatchesSelection(tap(EN.baseUrl), { track: EN, translationLanguage: null }), true);
});

test('the original selection reads auto-translation from the player track', () => {
  const { controller } = setup({
    tracks: [{ languageCode: 'en', baseUrl: 'https://x/timedtext?lang=en' }, EN],
    player: {
      setOption() {},
      getOption: () => ({ languageCode: 'en', kind: 'asr', translationLanguage: { languageCode: 'de' } }),
    },
  });
  controller.loadedUrl = null;

  const original = controller.captureOriginalSelection(controller.provider.getTracksWithSource().tracks);
  assert.equal(original.track, EN);
  assert.equal(original.translationLanguage, 'de');
});

test('a translation only matches when its source track matches too', () => {
  const { controller } = setup();
  const asrToVi = { track: EN, translationLanguage: 'vi' };
  const manualToVi = tap('https://www.youtube.com/api/timedtext?v=abc&lang=en&tlang=vi');
  assert.equal(controller.entryMatchesSelection(manualToVi, asrToVi), false);
  assert.equal(controller.entryMatchesSelection(tap(`${EN.baseUrl}&tlang=vi`), asrToVi), true);

  // A cached translation of another source track is not replayed.
  controller.rememberTap(manualToVi);
  assert.equal(controller.cachedTap(asrToVi), null);
});

test('a stalled load of the requested tap still ends the switch at the timeout', async () => {
  const { controller } = setup();
  controller.selectionTimeoutMs = 5;
  controller.loadFromTap = () => new Promise(() => {}); // e.g. a json3 re-download that never answers

  const switching = controller.toggleCaptionLanguage();
  void controller.onTap(tap(`${EN.baseUrl}&tlang=vi`));
  await switching;
  assert.equal(controller.toasts[0], 'Tiếng Việt captions did not load');
  assert.equal(controller.languageSwitching, false);
});

test('a stalled reload of a cached tap ends the switch at the timeout', async () => {
  const { controller, calls } = setup();
  controller.selectionTimeoutMs = 5;
  controller.rememberTap(tap(`${EN.baseUrl}&tlang=vi`)); // the player answers this from cache
  controller.loadFromTap = () => new Promise(() => {}); // e.g. a json3 re-download that never answers

  await controller.toggleCaptionLanguage();
  assert.equal(controller.live, 1, 'live captions show the new language while the cached one reloads');
  assert.equal(controller.toasts[0], 'Tiếng Việt captions did not load');
  assert.equal(controller.languageSwitching, false);
  assert.equal(controller.pendingSelection, null);

  // The shortcut keeps working afterwards.
  void controller.toggleCaptionLanguage();
  assert.equal(calls.length, 2);
});

test('a cached JSON download shows at once, without live captions', async () => {
  const { controller } = setup();
  controller.rememberTap(tap(`${EN.baseUrl}&tlang=vi`));

  await controller.toggleCaptionLanguage();
  assert.equal(controller.live, 0);
  assert.deepEqual(controller.loaded, [`${EN.baseUrl}&tlang=vi`]);
  assert.match(controller.toasts[0], /auto-translated/);
});

test('an evicted selection is refetched when the player cache emits no download', async () => {
  for (const translationLanguage of [null, 'vi']) {
    const { controller } = setup();
    controller.tapCacheCharLimit = 0;
    controller.cacheMissRefetchMs = 0;
    controller.rememberTap(tap(EN.baseUrl));
    assert.equal(controller.taps.length, 0, 'the raw response was evicted');

    const requests = [];
    controller.provider.fetchUrl = async (url) => {
      requests.push(url);
      return { controlled: true };
    };
    const selection = { track: EN, translationLanguage };
    const loaded = await controller.switchPlayerCaptions(selection);
    assert.equal(loaded, true);
    assert.equal(requests.length, 1);
    const request = new URL(requests[0]);
    assert.equal(request.searchParams.get('fmt'), 'json3');
    assert.equal(request.searchParams.get('lang'), 'en');
    assert.equal(request.searchParams.get('tlang'), translationLanguage);
    assert.deepEqual(controller.loaded, [requests[0]]);
  }
});

test('a prompt player tap cancels the cache-miss refetch', async () => {
  const { controller } = setup();
  controller.cacheMissRefetchMs = 10;
  let refetches = 0;
  controller.provider.fetchUrl = async () => { refetches++; return {}; };
  const switching = controller.toggleCaptionLanguage();
  await controller.onTap(tap(`${EN.baseUrl}&tlang=vi`));
  await switching;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(refetches, 0, 'does not duplicate a timely player download');
});

test('a fresh download finishes the switch while a cached one reloads', async (t) => {
  globalThis.location = new URL('https://www.youtube.com/watch?v=abc'); // withJson3 resolves against it
  t.after(() => { delete globalThis.location; });
  const { controller } = setup();
  controller.rememberTap({ ...tap(`${EN.baseUrl}&tlang=vi`), body: '<timedtext/>' });
  let finishCached;
  controller.provider.fetchUrl = () => new Promise((resolve) => { finishCached = resolve; });

  const switching = controller.toggleCaptionLanguage();
  assert.equal(controller.live, 1);
  await controller.onTap(tap(`${EN.baseUrl}&tlang=vi&sig=2`));
  await switching;
  assert.deepEqual(controller.loaded, [`${EN.baseUrl}&tlang=vi&sig=2`]);
  assert.match(controller.toasts[0], /auto-translated/, 'the superseded reload does not report a failure');

  finishCached({});
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(controller.loaded, [`${EN.baseUrl}&tlang=vi&sig=2`]);
});

test('a failing load of the requested tap ends the switch', async () => {
  const { controller } = setup();
  controller.loadFromTap = async () => { throw new Error('bad payload'); };

  const switching = controller.toggleCaptionLanguage();
  await assert.rejects(controller.onTap(tap(`${EN.baseUrl}&tlang=vi`)), /bad payload/);
  await switching;
  assert.equal(controller.toasts[0], 'Tiếng Việt captions did not load');
  assert.equal(controller.languageSwitching, false);
});

test('a slow download from an earlier switch does not replace newer captions', async (t) => {
  globalThis.location = new URL('https://www.youtube.com/watch?v=abc'); // withJson3 resolves against it
  t.after(() => { delete globalThis.location; });
  const { controller, calls } = setup();
  controller.selectionTimeoutMs = 5;
  controller.rememberTap(tap(EN.baseUrl));
  let finishStale;
  controller.provider.fetchUrl = () => new Promise((resolve) => { finishStale = resolve; });

  // The translated tap is not JSON, so it is downloaded again, and that outlasts the timeout.
  const switching = controller.toggleCaptionLanguage();
  void controller.onTap({ ...tap(`${EN.baseUrl}&tlang=vi`), body: '<timedtext/>' });
  await switching;

  // Shift+L again restores the original, then the stale download finishes.
  await controller.toggleCaptionLanguage();
  assert.deepEqual(calls[1], ['captions', 'track', { languageCode: 'en', kind: 'asr' }]);
  assert.equal(controller.loaded.at(-1), EN.baseUrl);
  finishStale({});
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(controller.loaded.at(-1), EN.baseUrl);
  assert.equal(controller.loaded.length, 1);
});

test('a late download of another language cannot interrupt the requested one', async (t) => {
  globalThis.location = new URL('https://www.youtube.com/watch?v=abc'); // withJson3 resolves against it
  t.after(() => { delete globalThis.location; });
  const { controller } = setup();
  controller.rememberTap(tap(EN.baseUrl));
  let finishRequested;
  controller.provider.fetchUrl = () => new Promise((resolve) => { finishRequested = resolve; });

  // The requested translation is not JSON, so it is downloaded again.
  const switching = controller.toggleCaptionLanguage();
  void controller.onTap({ ...tap(`${EN.baseUrl}&tlang=vi`), body: '<timedtext/>' });
  // An older English download arrives while that is in flight.
  await controller.onTap(tap(`${EN.baseUrl}&sig=2`));
  assert.deepEqual(controller.loaded, [], 'the wrong language is not shown');

  finishRequested({});
  await switching;
  assert.deepEqual(controller.loaded, [`${EN.baseUrl}&tlang=vi`]);
  assert.match(controller.toasts[0], /auto-translated/);
});

test('a caption-menu choice discards the shortcut download still in flight', async (t) => {
  globalThis.location = new URL('https://www.youtube.com/watch?v=abc'); // withJson3 resolves against it
  t.after(() => { delete globalThis.location; });
  const FR = { languageCode: 'fr', name: { simpleText: 'French' }, baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=fr' };
  const { controller } = setup({
    tracks: [EN, FR],
    translationLanguages: [{ languageCode: 'vi', languageName: { simpleText: 'Vietnamese' } }],
  });
  controller.reportManualLanguage = () => {};
  let finishStale;
  controller.provider.fetchUrl = () => new Promise((resolve) => { finishStale = resolve; });

  const switching = controller.toggleCaptionLanguage();
  void controller.onTap({ ...tap(`${EN.baseUrl}&tlang=vi`), body: '<timedtext/>' });
  controller.onCaptionMenuEvent({ isTrusted: true, type: 'click', target: menuRow('French') });
  controller.provider.getPlayer().setOption('captions', 'track', { languageCode: 'fr' });
  await switching;

  // The Vietnamese download finishes after the user picked French.
  finishStale({});
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(controller.loaded, [], 'the abandoned language is not shown');

  await controller.onTap(tap(FR.baseUrl));
  assert.deepEqual(controller.loaded, [FR.baseUrl]);
});

test('a learned language overrides the browser fallback on Shift+L', async () => {
  const { controller, calls } = setup({ translationLanguages: [{ languageCode: 'fr' }] });
  controller.browserLanguage = () => 'en-GB';
  controller.learnedCaptionLanguage = () => 'fr';

  const switching = controller.toggleCaptionLanguage();
  assert.deepEqual(calls, [[
    'captions',
    'track',
    { languageCode: 'en', kind: 'asr', translationLanguage: { languageCode: 'fr' } },
  ]]);
  await controller.onTap(tap(`${EN.baseUrl}&tlang=fr`));
  await switching;
  assert.equal(controller.loaded.at(-1), `${EN.baseUrl}&tlang=fr`);
});

test('Shift+L follows the language on screen back to the video\'s first track', async () => {
  const { controller, calls } = setup();
  controller.rememberTap(tap(EN.baseUrl));
  controller.noteLoadedCaption(EN.baseUrl);
  controller.loadedUrl = `${EN.baseUrl}&tlang=vi`;
  controller.noteCaptionLanguage('vi');

  await controller.toggleCaptionLanguage();
  assert.deepEqual(calls[0], ['captions', 'track', { languageCode: 'en', kind: 'asr' }]);
  assert.equal(controller.originalSelection.track, EN);
});

test('Shift+L from a third language goes to the preferred language', async () => {
  const { controller, calls } = setup();
  controller.noteLoadedCaption(EN.baseUrl);
  controller.loadedUrl = 'https://www.youtube.com/api/timedtext?v=abc&lang=fr';
  controller.noteCaptionLanguage('fr');

  const switching = controller.toggleCaptionLanguage();
  assert.deepEqual(calls[0], [
    'captions', 'track', { languageCode: 'en', kind: 'asr', translationLanguage: { languageCode: 'vi' } },
  ]);
  await controller.onTap(tap(`${EN.baseUrl}&tlang=vi`));
  await switching;
});

test('a later video that opens already translated toggles back to its source track', async () => {
  const { controller, calls } = setup();
  controller.rememberTap(tap(EN.baseUrl));
  // YouTube carried Vietnamese onto this video, so the first download is a translation.
  controller.noteLoadedCaption(`${EN.baseUrl}&tlang=vi`);
  assert.equal(controller.originalSelection.track, EN);
  assert.equal(controller.originalSelection.translationLanguage, null);
  assert.equal(controller.activeCaptionLanguage, 'vi');

  const switching = controller.toggleCaptionLanguage();
  assert.deepEqual(calls[0], ['captions', 'track', { languageCode: 'en', kind: 'asr' }]);
  await switching;
  assert.equal(controller.activeCaptionLanguage, 'en');
});

test('a carried translation to the offered fallback language toggles back to its source track', async () => {
  // A pt-PT browser with only pt-BR auto-translation: Shift+L picks pt-BR,
  // and YouTube carries that onto the next video.
  const { controller, calls } = setup({ translationLanguages: [{ languageCode: 'pt-BR' }] });
  controller.browserLanguage = () => 'pt-PT';
  controller.rememberTap(tap(EN.baseUrl));
  controller.loadedUrl = `${EN.baseUrl}&tlang=pt-BR`;
  controller.noteLoadedCaption(controller.loadedUrl);
  assert.equal(controller.originalSelection.track, EN);
  assert.equal(controller.originalSelection.translationLanguage, null);

  const switching = controller.toggleCaptionLanguage();
  assert.deepEqual(calls[0], ['captions', 'track', { languageCode: 'en', kind: 'asr' }]);
  await switching;
});

test('a zh-TW browser auto-translates to Traditional Chinese, and back to the source', async () => {
  const { controller, calls } = setup({ translationLanguages: [{ languageCode: 'zh-Hans' }, { languageCode: 'zh-Hant' }] });
  controller.browserLanguage = () => 'zh-TW';
  controller.rememberTap(tap(EN.baseUrl));

  const switching = controller.toggleCaptionLanguage();
  assert.deepEqual(calls[0], ['captions', 'track', { languageCode: 'en', kind: 'asr', translationLanguage: { languageCode: 'zh-Hant' } }]);
  await controller.onTap(tap(`${EN.baseUrl}&tlang=zh-Hant`));
  await switching;

  const back = controller.toggleCaptionLanguage();
  assert.deepEqual(calls[1], ['captions', 'track', { languageCode: 'en', kind: 'asr' }]);
  await back;
});

test('a carried fallback-language track is a placeholder for the source track', () => {
  const HANT = { languageCode: 'zh-Hant', baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=zh-Hant' };
  const { controller } = setup({ tracks: [EN, HANT], translationLanguages: [] });
  controller.browserLanguage = () => 'zh-TW';
  controller.noteLoadedCaption(HANT.baseUrl);
  assert.equal(controller.originalSelection.track, HANT);
  controller.noteLoadedCaption(EN.baseUrl);
  assert.equal(controller.originalSelection.track, EN);
});

test('the player default track stays original when the preferred language is already selected', async () => {
  const { controller, calls } = setup({ tracks: [EN, VI], defaultTrack: EN });
  controller.rememberTap(tap(EN.baseUrl));
  controller.noteLoadedCaption(VI.baseUrl);
  assert.equal(controller.originalSelection.track, EN);
  assert.equal(controller.originalSelection.translationLanguage, null);

  const switching = controller.toggleCaptionLanguage();
  assert.deepEqual(calls[0], ['captions', 'track', { languageCode: 'en', kind: 'asr' }]);
  await switching;
});

test('a video that starts translated restores that translation, not the default track', async () => {
  const { controller, calls } = setup({ translationLanguages: [{ languageCode: 'vi' }, { languageCode: 'fr' }], defaultTrack: EN });
  await controller.onTap(tap(`${EN.baseUrl}&tlang=fr`)); // the player's first download
  assert.equal(controller.originalSelection.track, EN);
  assert.equal(controller.originalSelection.translationLanguage, 'fr');

  const there = controller.toggleCaptionLanguage();
  await controller.onTap(tap(`${EN.baseUrl}&tlang=vi`));
  await there;
  const back = controller.toggleCaptionLanguage();
  assert.deepEqual(calls[1], ['captions', 'track', { languageCode: 'en', kind: 'asr', translationLanguage: { languageCode: 'fr' } }]);
  await controller.onTap(tap(`${EN.baseUrl}&tlang=fr&sig=2`));
  await back;
  assert.equal(controller.originalSelection.translationLanguage, 'fr');
});

test('a video that starts on a manual track restores it, not the default ASR track', async () => {
  const MANUAL = { languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=en' };
  const { controller, calls } = setup({ tracks: [EN, MANUAL], defaultTrack: EN });
  await controller.onTap(tap(MANUAL.baseUrl));
  assert.equal(controller.originalSelection.track, MANUAL);

  const there = controller.toggleCaptionLanguage();
  await controller.onTap(tap(`${MANUAL.baseUrl}&tlang=vi`));
  await there;
  void controller.toggleCaptionLanguage();
  assert.deepEqual(calls[1], ['captions', 'track', { languageCode: 'en' }]);
});

test('the player\'s first download replaces our own fetch as the original', () => {
  const MANUAL = { languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=en' };
  const { controller } = setup({ tracks: [EN, MANUAL], defaultTrack: EN });
  controller.noteLoadedCaption(EN.baseUrl, 'fetch');
  assert.equal(controller.originalSelection.track, EN);
  controller.noteLoadedCaption(MANUAL.baseUrl, 'tap');
  assert.equal(controller.originalSelection.track, MANUAL);
  // Later player downloads are choices, not the start.
  controller.noteLoadedCaption(`${EN.baseUrl}&tlang=fr`, 'tap');
  assert.equal(controller.originalSelection.track, MANUAL);
});

test('a carried preferred language does not replace the source track found first', () => {
  const { controller } = setup({ tracks: [EN, VI] });
  controller.noteLoadedCaption(EN.baseUrl);
  controller.noteLoadedCaption(VI.baseUrl);
  assert.equal(controller.originalSelection.track, EN);
  assert.equal(controller.activeCaptionLanguage, 'vi');
});

test('a later menu language does not replace the video source', () => {
  const FR = { languageCode: 'fr', baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=fr' };
  const { controller } = setup({ tracks: [EN, FR] });
  controller.noteLoadedCaption(EN.baseUrl);
  controller.noteLoadedCaption(FR.baseUrl);
  assert.equal(controller.originalSelection.track, EN);
  assert.equal(controller.activeCaptionLanguage, 'fr');
});

test('a preferred-language placeholder gives way to the source track', () => {
  const { controller } = setup({ tracks: [EN, VI] });
  controller.noteLoadedCaption(VI.baseUrl);
  assert.equal(controller.originalSelection.track, VI);
  controller.noteLoadedCaption(EN.baseUrl);
  assert.equal(controller.originalSelection.track, EN);
});

test('Shift+L selects a different script instead of treating it as the original', async () => {
  const HANT = { languageCode: 'zh-Hant', baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=zh-Hant' };
  const HANS = { languageCode: 'zh-Hans', baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=zh-Hans' };
  const { controller, calls } = setup({ tracks: [HANT, HANS], translationLanguages: [] });
  controller.browserLanguage = () => 'zh-Hans';
  controller.rememberTap(tap(HANT.baseUrl));
  controller.rememberTap(tap(HANS.baseUrl));
  controller.noteLoadedCaption(HANT.baseUrl);

  const toHans = controller.toggleCaptionLanguage();
  assert.deepEqual(calls[0], ['captions', 'track', { languageCode: 'zh-Hans' }]);
  await toHans;

  const toHant = controller.toggleCaptionLanguage();
  assert.deepEqual(calls[1], ['captions', 'track', { languageCode: 'zh-Hant' }]);
  await toHant;
});

test('Shift+L does nothing when the video is already in the preferred language', async () => {
  const { controller, calls } = setup({ tracks: [VI], translationLanguages: [] });
  controller.loadedUrl = VI.baseUrl;
  controller.noteLoadedCaption(VI.baseUrl);

  await controller.toggleCaptionLanguage();
  assert.equal(calls.length, 0);
  assert.equal(controller.toasts[0], 'Captions: Tiếng Việt');
});

function menuRow(label, inMenu = true) {
  const row = {
    closest(selector) {
      if (selector === '.ytp-menuitem') return row;
      if (selector === '.ytp-settings-menu, .ytp-popup') return inMenu ? {} : null;
      return null;
    },
    querySelector(selector) {
      if (selector === '.ytp-menuitem-label') return { textContent: label };
      return null;
    },
  };
  return row;
}

test('only a trusted click on a caption row arms learning', () => {
  const { controller } = setup({
    tracks: [{ ...EN, name: { simpleText: 'English (auto-generated)' } }],
    translationLanguages: [{ languageCode: 'vi', languageName: { simpleText: 'Vietnamese' } }],
  });
  controller.onCaptionMenuEvent({ isTrusted: false, type: 'click', target: menuRow('Vietnamese') });
  assert.equal(controller.captionChoiceAt, 0);
  controller.onCaptionMenuEvent({ isTrusted: true, type: 'click', target: menuRow('1080p') });
  assert.equal(controller.captionChoiceAt, 0);
  controller.onCaptionMenuEvent({ isTrusted: true, type: 'click', target: menuRow('Vietnamese', false) });
  assert.equal(controller.captionChoiceAt, 0);
  controller.onCaptionMenuEvent({ isTrusted: true, type: 'click', target: menuRow('Vietnamese') });
  assert.ok(controller.captionMenuArmed());
});

test('the latest caption-menu choice is learned, including the video\'s first language', async () => {
  const { controller } = setup({
    tracks: [{ ...EN, name: { simpleText: 'English (auto-generated)' } }],
    translationLanguages: [
      { languageCode: 'vi', languageName: { simpleText: 'Vietnamese' } },
      { languageCode: 'fr', languageName: { simpleText: 'French' } },
    ],
  });
  const reported = [];
  controller.reportManualLanguage = (language) => reported.push(language);
  controller.noteLoadedCaption(EN.baseUrl);

  assert.equal(controller.armCaptionMenuChoice('Vietnamese'), true);
  await controller.onTap(tap(`${EN.baseUrl}&tlang=vi`));
  assert.deepEqual(reported, ['vi']);

  assert.equal(controller.armCaptionMenuChoice('French'), true);
  await controller.onTap(tap(`${EN.baseUrl}&tlang=fr`));
  assert.deepEqual(reported, ['vi', 'fr'], 'a later choice on the same video wins');

  assert.equal(controller.armCaptionMenuChoice('English (auto-generated)'), true);
  await controller.onTap(tap(`${EN.baseUrl}&sig=2`));
  assert.deepEqual(reported, ['vi', 'fr', 'en'], 'choosing the language the video started in counts');
});

test('player track changes are learned only after a caption-menu choice', () => {
  const { controller } = setup({
    translationLanguages: [{ languageCode: 'vi', languageName: { simpleText: 'Vietnamese' } }],
  });
  const reported = [];
  controller.reportManualLanguage = (language) => reported.push(language);
  controller.watchPlayer();
  const player = controller.provider.getPlayer();

  player.setOption('captions', 'track', { languageCode: 'fr' });
  assert.deepEqual(reported, [], 'an automatic player change is ignored');

  assert.equal(controller.armCaptionMenuChoice('Vietnamese'), true);
  player.setOption('captions', 'track', {
    languageCode: 'en', kind: 'asr', translationLanguage: { languageCode: 'vi' },
  });
  assert.deepEqual(reported, ['vi']);
  player.setOption('captions', 'track', { languageCode: 'fr' });
  assert.deepEqual(reported, ['vi'], 'one gesture learns one choice');
});

test('a caption-menu choice during Shift+L wins over the pending switch', async () => {
  const FR = { languageCode: 'fr', name: { simpleText: 'French' }, baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=fr' };
  const { controller } = setup({
    tracks: [EN, FR],
    translationLanguages: [{ languageCode: 'vi', languageName: { simpleText: 'Vietnamese' } }],
  });
  controller.selectionTimeoutMs = 50;
  const reported = [];
  controller.reportManualLanguage = (language) => reported.push(language);

  const switching = controller.toggleCaptionLanguage();
  assert.ok(controller.pendingSelection, 'the shortcut is waiting for the Vietnamese download');

  controller.onCaptionMenuEvent({ isTrusted: true, type: 'click', target: menuRow('French') });
  assert.ok(controller.captionMenuArmed());
  controller.provider.getPlayer().setOption('captions', 'track', { languageCode: 'fr' });
  assert.deepEqual(reported, ['fr'], 'the menu choice is learned while the shortcut waits');
  assert.equal(controller.pendingSelection, null);

  await switching;
  assert.deepEqual(controller.toasts, [], 'no "did not load" toast for the replaced switch');
  assert.equal(controller.languageSwitching, false);

  await controller.onTap(tap(FR.baseUrl));
  assert.equal(controller.loaded.at(-1), FR.baseUrl, 'the menu choice\'s download loads');
  assert.deepEqual(reported, ['fr'], 'one gesture learns one choice');
});

test('downloads without a caption-menu choice are not learned', async () => {
  const { controller } = setup({
    translationLanguages: [{ languageCode: 'vi', languageName: { simpleText: 'Vietnamese' } }],
  });
  const reported = [];
  controller.reportManualLanguage = (language) => reported.push(language);
  controller.noteLoadedCaption(EN.baseUrl);

  await controller.onTap(tap(`${EN.baseUrl}&tlang=vi`));
  assert.deepEqual(reported, []);

  controller.armCaptionMenuChoice('Vietnamese');
  controller.languageSwitching = true;
  controller.learnManualSelection(tap(`${EN.baseUrl}&tlang=vi`), 'en');
  assert.deepEqual(reported, [], 'a shortcut switch is not a manual choice');
});
