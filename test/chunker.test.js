const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/core/text-utils.js');
require('../src/core/rolling-merger.js');
require('../src/core/json3-parser.js');
require('../src/core/cue-lookup.js');
require('../src/core/chunker.js');
require('../src/core/disfluency.js');

const { Json3Parser, CaptionChunker, Disfluency, cueAtTime } = globalThis.YTSC;

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

test('manual lyric lines stay whole, wrap, and do not swallow a repeated line', () => {
  const words = new Json3Parser().parseWords({
    events: [
      { tStartMs: 14883, dDurationMs: 4070, segs: [{ utf8: 'Sau bao năm lang thang anh vẫn quay về nhà' }] },
      { tStartMs: 18953, dDurationMs: 3964, segs: [{ utf8: 'Mang theo bao lo âu anh vẫn quay về nhà' }] },
      { tStartMs: 45325, dDurationMs: 3956, segs: [{ utf8: 'Tell yourself don’t live like this' }] },
      { tStartMs: 49281, dDurationMs: 3959, segs: [{ utf8: 'Tell yourself don’t live like this' }] },
      { tStartMs: 76441, dDurationMs: 3600, segs: [{ utf8: 'bao nhiêu đêm anh mong nhớ,\nbao nhiêu đêm anh chờ' }] },
      { tStartMs: 88393, dDurationMs: 3405, segs: [{ utf8: 'Để về đâu về đâu' }] },
      { tStartMs: 91798, dDurationMs: 2620, segs: [{ utf8: 'Về đâu khi cơn giông kéo đến' }] },
    ],
  });
  const chunks = new CaptionChunker().build(words);
  assert.deepEqual(
    chunks.map((c) => c.text),
    [
      'Sau bao năm lang thang anh vẫn quay về nhà',
      'Mang theo bao lo âu anh vẫn quay về nhà',
      'Tell yourself don’t live like this',
      'Tell yourself don’t live like this',
      'bao nhiêu đêm anh mong nhớ, bao nhiêu đêm anh chờ',
      'Để về đâu về đâu',
      'Về đâu khi cơn giông kéo đến',
    ]
  );
  // Long lines wrap near the middle. The authored newline is kept as the break.
  assert.equal(chunks[0].words.find((w) => w.lineBreak)?.text, 'anh');
  const wrapped = new CaptionChunker().build(
    new Json3Parser().parseWords({
      events: [
        {
          tStartMs: 0,
          dDurationMs: 4000,
          segs: [{ utf8: 'Và bao nhiêu đêm anh cô đơn lang thang tìm về một nơi xa vắng' }],
        },
      ],
    })
  );
  assert.equal(wrapped[0].words.find((w) => w.lineBreak)?.text, 'lang');
  assert.equal(chunks[2].words.some((w) => w.lineBreak), true);
  assert.equal(chunks[4].words.find((w) => w.lineBreak)?.text, 'bao');
  assert.equal(chunks[0].endMs, 18953);
  assert.ok(chunks[0].words.every((w) => w.estimated));
});

test('a one-word lyric cue stays on its own line and is not cleaned away', () => {
  const words = new Json3Parser().parseWords({
    events: [
      { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'come back' }] },
      { tStartMs: 1000, dDurationMs: 800, segs: [{ utf8: 'stay' }] },
      { tStartMs: 1800, dDurationMs: 800, segs: [{ utf8: 'Ah' }] },
      { tStartMs: 2600, dDurationMs: 800, segs: [{ utf8: 'Stay' }] },
      { tStartMs: 3400, dDurationMs: 800, segs: [{ utf8: 'Stay' }] },
    ],
  });
  assert.ok(words.filter((w) => w.text === 'stay' || w.text === 'Ah' || w.text === 'Stay').every((w) => w.estimated && w.cueStart));
  const chunks = new CaptionChunker().build(new Disfluency().clean(words));
  assert.deepEqual(chunks.map((c) => c.text), ['come back', 'stay', 'Ah', 'Stay', 'Stay']);
  assert.equal(chunks[0].endMs, 1000);
});

test('untimed one-word auto-captions are still grouped into chunks', () => {
  const words = new Json3Parser().parseWords({
    events: [
      { tStartMs: 0, dDurationMs: 400, segs: [{ utf8: 'Wir' }] },
      { tStartMs: 400, dDurationMs: 400, segs: [{ utf8: 'sprechen' }] },
      { tStartMs: 800, dDurationMs: 500, segs: [{ utf8: 'Deutsch.' }] },
    ],
  });
  assert.equal(words.some((w) => w.estimated || w.cueStart), false);
  assert.deepEqual(new CaptionChunker().build(words).map((c) => c.text), ['Wir sprechen Deutsch.']);
});

test('formatted captions with their own line breaks stay short single lines and keep highlight timing', () => {
  const words = new Json3Parser().parseWords({
    events: [
      { tStartMs: 3431, dDurationMs: 3849, segs: [{ utf8: 'Like, long introductions are\nno good.' }] },
      { tStartMs: 7280, dDurationMs: 1450, segs: [{ utf8: 'Sam knows.' }] },
      { tStartMs: 8730, dDurationMs: 1560, segs: [{ utf8: 'Alright, ready,\neverybody?' }] },
      { tStartMs: 11300, dDurationMs: 1990, segs: [{ utf8: "I'm not gonna ask if the mic\nis working like in" }] },
      { tStartMs: 13290, dDurationMs: 1420, segs: [{ utf8: 'every talk so far.' }] },
    ],
  });
  assert.equal(words.some((w) => w.estimated || w.cueStart || w.lineBreak), false);
  const chunks = new CaptionChunker().build(words);
  assert.deepEqual(chunks.map((c) => c.text), [
    'Like, long introductions are',
    'no good.',
    'Sam knows.',
    'Alright, ready, everybody?',
    "I'm not gonna ask if the",
    'mic is working like in every',
    'talk so far.',
  ]);
  for (const chunk of chunks) assert.equal(chunk.words.some((w) => w.lineBreak), false);
});

test('parseWords spreads manual sentence timing and drops rolling repeats', () => {
  const parser = new Json3Parser();
  const manual = parser.parseWords({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'aa bb' }] }] });
  assert.deepEqual(manual, [
    { text: 'aa', startMs: 0, endMs: 500, estimated: true, cueStart: true },
    { text: 'bb', startMs: 500, endMs: 1000, estimated: true },
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
