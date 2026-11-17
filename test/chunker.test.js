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
  const chunks = new CaptionChunker({ maxWords: 6, strandWords: 0 }).build(words);
  assert.deepEqual(chunks.map((c) => c.text), ['one two three four five six', 'seven eight']);
  for (const c of new CaptionChunker({ maxChars: 12, strandWords: 0 }).build(words)) {
    assert.ok(c.text.length <= 12, c.text);
  }
});

test('Boring fills one line; the other styles keep short bursts', () => {
  const words = 'one two three four five six seven eight nine ten eleven twelve'.split(' ').map((t, i) => w(t, i * 300));
  assert.deepEqual(new CaptionChunker({ style: 'boring' }).build(words).map((c) => c.text), [
    'one two three four five six seven',
    'eight nine ten eleven twelve',
  ]);
  for (const style of [undefined, 'frosted', 'tiktok']) {
    assert.equal(new CaptionChunker({ style }).build(words)[0].text, 'one two three four five six', style);
  }
});

test('setStyle changes the chunk length of the next build', () => {
  const words = 'one two three four five six seven eight'.split(' ').map((t, i) => w(t, i * 300));
  const chunker = new CaptionChunker({ strandWords: 0 });
  chunker.setStyle('boring');
  assert.deepEqual(chunker.build(words).map((c) => c.text), ['one two three four five six seven', 'eight']);
  chunker.setStyle('frosted');
  assert.deepEqual(chunker.build(words).map((c) => c.text), ['one two three four five six', 'seven eight']);
});

test('Boring breaks at a comma only once the chunk is longer', () => {
  const words = [w('So', 0), w('one,', 300), w('two', 600), w('three,', 900), w('four', 1200)];
  assert.deepEqual(new CaptionChunker().build(words).map((c) => c.text), ['So one, two three,', 'four']);
  assert.deepEqual(new CaptionChunker({ style: 'boring' }).build(words).map((c) => c.text), ['So one, two three, four']);
});

const sentence = (text) => text.split(' ').map((t, i) => w(t, i * 300));

test('a sentence end a few words past a full chunk joins it when it fits', () => {
  const chunks = new CaptionChunker().build(sentence('And I would want to do that. Then more'));
  assert.deepEqual(chunks.map((c) => c.text), ['And I would want to do that.', 'Then more']);
});

test('a stranded sentence end that does not fit moves the cut back to the last comma', () => {
  const chunks = new CaptionChunker().build(sentence('but then, actually, the paper would come along, and then'));
  assert.deepEqual(chunks.map((c) => c.text), ['but then, actually,', 'the paper would come along,', 'and then']);
});

test('without a comma, a stranded sentence end splits the sentence about evenly', () => {
  const chunks = new CaptionChunker().build(sentence('How hard could it be to walk up the stairs?'));
  assert.deepEqual(chunks.map((c) => c.text), ['How hard could it be to', 'walk up the stairs?']);
});

test('a longer run to the sentence end is cut at the size cap as usual', () => {
  const chunks = new CaptionChunker().build(sentence('I would kick it up into high gear like this.'));
  assert.deepEqual(chunks.map((c) => c.text), ['I would kick it up into', 'high gear like this.']);
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
  const chunks = new CaptionChunker({ maxWords: 1, holdMs: 500, strandWords: 0 }).build([w('a', 0, 200), w('b', 400), w('c', 5000, 5200)]);
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
    'Like, long introductions',
    'are no good.',
    'Sam knows.',
    'Alright, ready, everybody?',
    "I'm not gonna ask if the",
    'mic is working like',
    'in every talk so far.',
  ]);
  for (const chunk of chunks) assert.equal(chunk.words.some((w) => w.lineBreak), false);
});

test('parseWords spreads manual sentence timing and drops rolling repeats', () => {
  const parser = new Json3Parser();
  const manual = parser.parseWords({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'aa bb' }] }] });
  assert.deepEqual(manual, [
    { text: 'aa', startMs: 0, endMs: 500, estimated: true, preserveLine: true, cueStart: true },
    { text: 'bb', startMs: 500, endMs: 1000, estimated: true, preserveLine: true },
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

// Reconstructed from the reported screenshot, not a downloaded video fixture.
const lectureText = 'So the number of rules you find is about the same as the number of examples you have.';

test('the reported lecture sentence uses short timed chunks in every style', () => {
  const words = new Json3Parser().parseWords({ events: [
    { tStartMs: 189000, dDurationMs: 5000, segs: [{ utf8: lectureText }] },
  ] });
  assert.ok(words.every((word) => word.estimated && !word.preserveLine));
  const snapshot = structuredClone(words);
  for (const style of ['frosted', 'tiktok', 'boring']) {
    for (const clean of [false, true]) {
      const input = clean ? new Disfluency().clean(words) : words;
      const chunks = new CaptionChunker({ style }).build(input);
      assert.ok(chunks.length > 1, style);
      assert.equal(chunks.map((chunk) => chunk.text).join(' '), lectureText);
      assert.equal(chunks[0].startMs, 189000);
      for (const [i, chunk] of chunks.entries()) {
        assert.ok(chunk.words.length <= (style === 'boring' ? 7 : 6), chunk.text);
        assert.ok(chunk.text.length <= (style === 'boring' ? 42 : 30), chunk.text);
        assert.equal(chunk.words.some((word) => word.lineBreak), false);
        assert.equal(cueAtTime(chunks, chunk.startMs), chunk);
        assert.ok(chunk.endMs > chunk.startMs);
        if (chunks[i + 1]) assert.ok(chunk.endMs <= chunks[i + 1].startMs);
      }
    }
  }
  assert.deepEqual(words, snapshot, 'style changes and cleaning leave source timing intact');
});

test('long unpunctuated manual captions and occasional authored wraps still split', () => {
  const texts = [lectureText.slice(0, -1), lectureText.replace('find is', 'find\nis'), lectureText];
  const words = new Json3Parser().parseWords({ events: texts.map((text, i) => ({
    tStartMs: i * 5000, dDurationMs: 5000, segs: [{ utf8: text }],
  })) });
  const chunks = new CaptionChunker().build(new Disfluency().clean(words));
  assert.equal(chunks.map((chunk) => chunk.text).join(' '), texts.join(' ').replace(/\s+/g, ' '));
  assert.ok(chunks.every((chunk) => chunk.text.length <= 30));
  assert.ok(chunks.every((chunk) => chunk.words.every((word) => !word.lineBreak && !word.preserveLine)));
  for (const start of [0, 5000, 10000]) assert.equal(cueAtTime(chunks, start).startMs, start);
});

test('estimated word timing alone does not suppress size, sentence or pause breaks', () => {
  const words = [
    ...sentence(lectureText),
    w('Next.', 10000),
    w('Later', 12000), w('words', 12300),
  ].map((word) => ({ ...word, estimated: true }));
  const chunks = new CaptionChunker().build(words);
  assert.ok(chunks.every((chunk) => chunk.text.length <= 30));
  assert.deepEqual(chunks.slice(-2).map((chunk) => chunk.text), ['Next.', 'Later words']);
  assert.ok(chunks.some((chunk) => chunk.text.endsWith('have.')));
});

test('punctuated lyrics, repeats and filler-shaped lyrics stay whole in every style', () => {
  const texts = ['Ah, come back to me.', 'Ah, come back to me.', 'Stay', 'Stay'];
  const words = new Json3Parser().parseWords({ events: texts.map((text, i) => ({
    tStartMs: i * 3000, dDurationMs: 3000, segs: [{ utf8: text }],
  })) });
  assert.ok(words.every((word) => word.estimated && word.preserveLine));
  for (const style of ['frosted', 'tiktok', 'boring']) {
    const chunks = new CaptionChunker({ style }).build(new Disfluency().clean(words));
    assert.deepEqual(chunks.map((chunk) => chunk.text), texts);
    assert.deepEqual(chunks.map((chunk) => chunk.startMs), [0, 3000, 6000, 9000]);
    assert.equal(chunks[0].endMs, 3000);
  }
});

test('an oversized lyric cue splits safely without cleaning away sung repetitions', () => {
  const text = 'Ah come back come back to me and stay with me until the morning light shines through';
  const words = new Json3Parser().parseWords({ events: [
    { tStartMs: 0, dDurationMs: 8000, segs: [{ utf8: text }] },
    { tStartMs: 8000, dDurationMs: 3000, segs: [{ utf8: 'Ah come back' }] },
  ] });
  const chunks = new CaptionChunker().build(new Disfluency().clean(words));
  assert.equal(chunks.slice(0, -1).map((chunk) => chunk.text).join(' '), text);
  assert.ok(chunks.slice(0, -1).every((chunk) => chunk.text.length <= 30));
  assert.equal(chunks.at(-1).text, 'Ah come back');
  assert.equal(chunks.at(-1).startMs, 8000);
});

test('slow manual cues stay continuously visible when split, while real cue gaps remain', () => {
  const text = 'Ah come back come back to me and stay with me until the morning light shines through';
  const words = new Json3Parser().parseWords({ events: [
    { tStartMs: 0, dDurationMs: 30000, segs: [{ utf8: text }] },
    { tStartMs: 32000, dDurationMs: 3000, segs: [{ utf8: 'Ah come back' }] },
  ] });
  const slowWords = words.filter((word) => word.startMs < 30000);
  for (let i = 1; i < slowWords.length; i++) {
    assert.equal(slowWords[i - 1].endMs, slowWords[i].startMs, 'estimated intervals must stay continuous');
  }
  assert.equal(slowWords.at(-1).endMs, 30000);
  for (const style of ['frosted', 'tiktok', 'boring']) {
    for (const clean of [false, true]) {
      const chunks = new CaptionChunker({ style }).build(clean ? new Disfluency().clean(words) : words);
      const slowChunks = chunks.slice(0, -1);
      assert.ok(slowChunks.length > 1);
      assert.equal(slowChunks.map((chunk) => chunk.text).join(' '), text);
      for (let i = 1; i < slowChunks.length; i++) {
        assert.equal(slowChunks[i - 1].endMs, slowChunks[i].startMs, `${style}: no blank interval between chunks`);
        assert.ok(cueAtTime(chunks, slowChunks[i].startMs - 1));
      }
      for (const time of [21471, 22058, 26765, 26911, 29999]) assert.ok(cueAtTime(chunks, time));
      assert.equal(cueAtTime(chunks, 31000), null, 'silence between authored cues is still blank');
      assert.equal(cueAtTime(chunks, 32000)?.text, 'Ah come back');
    }
  }
});

test('word-timed auto-captions retain exact starts and normal short chunking', () => {
  const texts = lectureText.split(' ');
  const words = new Json3Parser().parseWords({ events: [{
    tStartMs: 189000,
    dDurationMs: 6000,
    segs: texts.map((text, i) => ({ utf8: `${i ? ' ' : ''}${text}`, tOffsetMs: i * 300 })),
  }] });
  assert.equal(words.some((word) => word.estimated || word.preserveLine || word.lineBreak), false);
  assert.deepEqual(words.map((word) => word.startMs), texts.map((_, i) => 189000 + i * 300));
  const chunks = new CaptionChunker().build(new Disfluency().clean(words));
  assert.equal(chunks.map((chunk) => chunk.text).join(' '), lectureText);
  assert.ok(chunks.every((chunk) => chunk.text.length <= 30));
});
