const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/content/track-provider.js');
require('../src/content/main.js');

const { TrackProvider, StableCaptionsController } = globalThis.YTSC;
const EN = { languageCode: 'en', kind: 'asr', baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=en&kind=asr' };
const VI = { languageCode: 'vi', baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=vi' };

/** What timedtext-tap.js publishes when the player downloads `url`. */
const tap = (url) => ({ videoId: 'abc', url, body: '{}' });

function setup({ tracks = [EN], translationLanguages = [{ languageCode: 'vi' }], player } = {}) {
  const provider = new TrackProvider();
  provider.getTracksWithSource = () => ({ tracks, translationLanguages, source: 'test' });
  provider.fetchJson3 = async () => { throw new Error('the shortcut must not fetch tracks itself'); };
  const calls = [];
  provider.getPlayer = () => (player === undefined ? { setOption: (...args) => calls.push(args) } : player);
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
  controller.useTimeline = (payload, url) => {
    controller.loaded.push(url);
    controller.loadedUrl = url;
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
  assert.equal(controller.browserCaptions, true);
  assert.equal(controller.live, 1);
  assert.equal(controller.toasts.length, 0, 'no success toast before the translation arrives');

  await controller.onTap(tap(`${EN.baseUrl}&tlang=vi`));
  await switching;
  assert.deepEqual(controller.loaded, [`${EN.baseUrl}&tlang=vi`]);
  assert.match(controller.toasts[0], /auto-translated/);

  // The player answers its earlier track from cache, so the tapped original is reused.
  await controller.toggleCaptionLanguage();
  assert.deepEqual(calls[1], ['captions', 'track', { languageCode: 'en', kind: 'asr' }]);
  assert.equal(controller.browserCaptions, false);
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
  assert.equal(controller.browserCaptions, true);
});

test('unsupported YouTube translation languages leave captions unchanged', async () => {
  const { controller, calls } = setup({ translationLanguages: [{ languageCode: 'fr' }] });

  await controller.toggleCaptionLanguage();
  assert.equal(calls.length, 0);
  assert.equal(controller.browserCaptions, false);
  assert.match(controller.toasts[0], /captions unavailable/);
});

test('without the player API nothing switches', async () => {
  const { controller } = setup({ player: null });

  await controller.toggleCaptionLanguage();
  assert.equal(controller.browserCaptions, false);
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
  controller.loadFromTap = async (entry) => { loaded.push(entry.url); return true; };
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

test('a failing load of the requested tap ends the switch', async () => {
  const { controller } = setup();
  controller.loadFromTap = async () => { throw new Error('bad payload'); };

  const switching = controller.toggleCaptionLanguage();
  await assert.rejects(controller.onTap(tap(`${EN.baseUrl}&tlang=vi`)), /bad payload/);
  await switching;
  assert.equal(controller.toasts[0], 'Tiếng Việt captions did not load');
  assert.equal(controller.languageSwitching, false);
});
