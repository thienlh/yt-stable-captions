const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/content/track-provider.js');

const { TrackProvider } = globalThis.YTSC;

test('tracksFromResponse keeps only timedtext tracks with baseUrl', () => {
  const resp = {
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          { languageCode: 'en', kind: 'asr', baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=en' },
          { languageCode: 'en', baseUrl: '' },
          { languageCode: 'fr' },
        ],
      },
    },
  };
  const tracks = TrackProvider.tracksFromResponse(resp);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].languageCode, 'en');
  assert.deepEqual(TrackProvider.tracksFromResponse(null), []);
  assert.deepEqual(TrackProvider.tracksFromResponse({}), []);
});

test('pickBest prefers manual over ASR, and English first', () => {
  const p = new TrackProvider();
  const tracks = [
    { languageCode: 'vi', kind: 'asr', vssId: '.auto', baseUrl: 'https://x/timedtext?a=1' },
    { languageCode: 'en', kind: 'asr', vssId: '.en-auto', baseUrl: 'https://x/timedtext?a=2' },
    { languageCode: 'en', baseUrl: 'https://x/timedtext?a=3' },
  ];
  assert.equal(p.pickBest(tracks).baseUrl, 'https://x/timedtext?a=3');
  assert.equal(p.pickBest([]), null);
  const autoOnly = tracks.slice(0, 2);
  assert.equal(p.pickBest(autoOnly).baseUrl, 'https://x/timedtext?a=2');
});

test('language choice prefers an exact region and manual tracks over ASR', () => {
  const p = new TrackProvider();
  const tracks = [
    { languageCode: 'en', kind: 'asr', baseUrl: 'https://x/timedtext?lang=en&kind=asr' },
    { languageCode: 'en', baseUrl: 'https://x/timedtext?lang=en' },
    { languageCode: 'pt', baseUrl: 'https://x/timedtext?lang=pt' },
    { languageCode: 'pt-BR', baseUrl: 'https://x/timedtext?lang=pt-BR' },
  ];
  assert.equal(p.pickLanguage(tracks, 'en-US').kind, undefined);
  assert.equal(p.pickLanguage(tracks, 'pt-BR').languageCode, 'pt-BR');
  assert.equal(p.pickLanguage(tracks, 'pt-PT').languageCode, 'pt');
  assert.equal(p.pickLanguage(tracks, 'vi'), null);
});

test('translation languages match browser regional locales', () => {
  const p = new TrackProvider();
  const languages = [{ languageCode: 'en' }, { languageCode: 'vi' }];
  assert.equal(p.findTranslationLanguage(languages, 'vi-VN').languageCode, 'vi');
  assert.equal(p.findTranslationLanguage(languages, 'fr'), null);
  const resp = { captions: { playerCaptionsTracklistRenderer: { translationLanguages: languages } } };
  assert.deepEqual(TrackProvider.translationLanguagesFromResponse(resp), languages);
});

test('selectionFromUrl restores the source track and translation', () => {
  const manual = { languageCode: 'en', baseUrl: 'https://x/timedtext?lang=en' };
  const asr = { languageCode: 'en', kind: 'asr', baseUrl: 'https://x/timedtext?lang=en&kind=asr' };
  const selection = TrackProvider.selectionFromUrl(
    'https://www.youtube.com/api/timedtext?v=abc&lang=en&kind=asr&tlang=vi',
    [manual, asr]
  );
  assert.equal(selection.track, asr);
  assert.equal(selection.translationLanguage, 'vi');
  assert.equal(TrackProvider.languageFromUrl(asr.baseUrl), 'en');
  assert.equal(TrackProvider.languageFromUrl(`${asr.baseUrl}&tlang=vi-VN`), 'vi-vn');
  assert.equal(TrackProvider.languageFromUrl('not a url'), null);
});
