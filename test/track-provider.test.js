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

test('the default caption track is the audio track index, not the selected translation', () => {
  const english = { languageCode: 'en', kind: 'asr', baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=en&kind=asr' };
  const vietnamese = { languageCode: 'vi', baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=vi' };
  const resp = {
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [english, vietnamese],
        audioTracks: [{ defaultCaptionTrackIndex: 0, hasDefaultTrack: true }],
      },
    },
  };
  assert.equal(TrackProvider.defaultTrackFromResponse(resp), english);
  assert.equal(TrackProvider.defaultTrackFromResponse({}), null);
  assert.equal(TrackProvider.sameVideo(english, 'abc'), true);
  assert.equal(TrackProvider.sameVideo(english, 'other'), false);

  const carried = TrackProvider.videoOriginal({
    observed: { track: english, translationLanguage: 'vi' },
    preferred: 'vi-VN',
  });
  assert.equal(carried.track, english);
  assert.equal(carried.translationLanguage, null);
  const byIndex = TrackProvider.videoOriginal({
    defaultTrack: english,
    observed: { track: vietnamese, translationLanguage: null },
    preferred: 'vi',
  });
  assert.equal(byIndex.track, english);
  assert.equal(byIndex.translationLanguage, null);
});

test('a settings label matches caption tracks and not quality rows', () => {
  const tracks = [{ languageCode: 'en', kind: 'asr', name: { simpleText: 'English (auto-generated)' } }];
  const translations = [{ languageCode: 'vi', languageName: { simpleText: 'Vietnamese' } }];
  assert.equal(TrackProvider.matchesCaptionLabel('English (auto-generated)', tracks, translations), true);
  assert.equal(TrackProvider.matchesCaptionLabel('English', tracks, translations), true);
  assert.equal(TrackProvider.matchesCaptionLabel('Vietnamese', tracks, translations), true);
  assert.equal(TrackProvider.matchesCaptionLabel('1080p', tracks, translations), false);
  assert.equal(TrackProvider.matchesCaptionLabel('Normal', tracks, translations), false);
  assert.equal(TrackProvider.matchesCaptionLabel('', tracks, translations), false);
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
