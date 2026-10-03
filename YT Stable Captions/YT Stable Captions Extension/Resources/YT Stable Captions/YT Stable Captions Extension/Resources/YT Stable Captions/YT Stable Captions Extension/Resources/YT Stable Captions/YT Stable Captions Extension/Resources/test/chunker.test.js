const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/core/text-utils.js');
require('../src/core/rolling-merger.js');
require('../src/core/json3-parser.js');
require('../src/core/cue-lookup.js');
require('../src/core/chunker.js');

const { Json3Parser, CaptionChunker, cueAtTime } = globalThis.YTSC;

const w = (text, startMs, endMs = startMs + 300) => ({ text, startMs, endMs });

test('chunks stay short: max words and max chars', () => {
  const words = 'one two three four five six seven eight'.split(' ').map((t, i) => w(t, i * 300));
  const chunks = new CaptionChunker({ maxWords: 6 }).build(words);
  assert.deepEqual(chunks.map((c) => c.text), ['one two three four five six', 'seven eight']);
  for (const c of new CaptionChunker({ maxChars: 12 }).build(words)) {
    assert.ok(c.text.length <= 12, c.text);
  }
});

test('chunks break at sentence ends, commas and pauses', () => {
  const chunks = new CaptionChunker().build([
    w('Hallo.', 0),
    w('Wir', 300),
    w('lernen', 600),
    w('heute,', 900),
    w('glaube', 1200),
    w('ich', 1500),
    w('später', 3000), // 1.2s pause
  ]);
  assert.deepEqual(chunks.map((c) => c.text), ['Hallo.', 'Wir lernen heute,', 'glaube ich', 'später']);
});

test('chunk end is held briefly but never overlaps the next chunk', () => {
  const chunks = new CaptionChunker({ maxWords: 1, holdMs: 500 }).build([w('a', 0, 200), w('b', 400), w('c', 5000, 5200)]);
  assert.equal(chunks[0].endMs, 400);
  assert.equal(chunks[1].endMs, 1200);
  assert.equal(cueAtTime(chunks, 1500), null);
  assert.equal(cueAtTime(chunks, 5100).text, 'c');
});

test('parseWords uses ASR per-word offsets and caps lingering words', () => {
  const words = new Json3Parser().parseWords({
    events: [
      { tStartMs: 0, dDurationMs: 99999, wWinId: 0 },
      {
        tStartMs: 1000,
        dDurationMs: 6000,
        wWinId: 1,
        segs: [{ utf8: 'Liebe' }, { utf8: ' Freunde', tOffsetMs: 400 }, { utf8: ' der', tOffsetMs: 900 }],
      },
      { tStartMs: 2500, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] },
      { tStartMs: 2510, dDurationMs: 5000, wWinId: 1, segs: [{ utf8: 'Sonne' }] },
    ],
  });
  assert.deepEqual(words, [
    { text: 'Liebe', startMs: 1000, endMs: 1400 },
    { text: 'Freunde', startMs: 1400, endMs: 1900 },
    { text: 'der', startMs: 1900, endMs: 2510 },
    { text: 'Sonne', startMs: 2510, endMs: 4510 },
  ]);
});

test('parseWords spreads manual sentence timing and drops rolling repeats', () => {
  const parser = new Json3Parser();
  const manual = parser.parseWords({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'aa bb' }] }] });
  assert.deepEqual(manual, [
    { text: 'aa', startMs: 0, endMs: 500 },
    { text: 'bb', startMs: 500, endMs: 1000 },
  ]);

  const rolling = parser.parseWords({
    events: [
      { tStartMs: 0, dDurationMs: 900, segs: [{ utf8: 'Was' }] },
      { tStartMs: 500, dDurationMs: 900, segs: [{ utf8: 'Was bedeutet' }] },
      { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: 'Was bedeutet dieses Wort?' }] },
    ],
  });
  assert.deepEqual(rolling.map((x) => x.text), ['Was', 'bedeutet', 'dieses', 'Wort?']);
});
