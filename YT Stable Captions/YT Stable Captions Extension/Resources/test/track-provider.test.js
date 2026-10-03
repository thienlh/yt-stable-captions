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
