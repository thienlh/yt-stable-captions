const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/core/text-utils.js');
require('../src/core/rolling-merger.js');
require('../src/core/json3-parser.js');
require('../src/core/cue-lookup.js');

const { Json3Parser } = globalThis.YTSC;
const { cueAtTime } = globalThis.YTSC;

test('word-level events merge into phrase cues and keep real end times', () => {
  const cues = new Json3Parser().parse({
    events: [
      { tStartMs: 0, dDurationMs: 700, segs: [{ utf8: 'Wir ' }] },
      { tStartMs: 700, dDurationMs: 700, segs: [{ utf8: 'sprechen ' }] },
      { tStartMs: 1300, dDurationMs: 800, segs: [{ utf8: 'Deutsch.' }] },
      { tStartMs: 2500, dDurationMs: 1000, segs: [{ utf8: 'Danach.' }] },
    ],
  });
  assert.deepEqual(cues, [
    { startMs: 0, endMs: 2100, text: 'Wir sprechen Deutsch.', index: 0 },
    { startMs: 2500, endMs: 3500, text: 'Danach.', index: 1 },
  ]);
  assert.equal(cueAtTime(cues, 0)?.text, 'Wir sprechen Deutsch.');
  assert.equal(cueAtTime(cues, 2099)?.index, 0);
  assert.equal(cueAtTime(cues, 2100), null);
  assert.equal(cueAtTime(cues, 2500)?.index, 1);
  assert.equal(cueAtTime(cues, 3500), null);
});

test('events without durations infer an end from the next cue', () => {
  const cues = new Json3Parser().parse({
    events: [
      { tStartMs: 1000, segs: [{ utf8: 'Hallo ' }] },
      { tStartMs: 2000, segs: [{ utf8: 'Welt' }] },
    ],
  });
  assert.equal(cues[0].text, 'Hallo Welt');
  assert.equal(cues[0].startMs, 1000);
  assert.equal(cues[0].endMs, 3800);
  assert.equal(cueAtTime(cues, 3799)?.text, 'Hallo Welt');
  assert.equal(cueAtTime(cues, 3800), null);
});

test('empty and malformed caption events are ignored', () => {
  const parser = new Json3Parser();
  assert.deepEqual(parser.parse({ events: [] }), []);
  assert.deepEqual(parser.parse({ events: [{ tStartMs: 10, segs: [{ utf8: '  ' }] }] }), []);
  assert.deepEqual(parser.parse({}), []);
});

test('rolling ASR windows replace prefixes instead of duplicating words', () => {
  const cues = new Json3Parser().parse({
    events: [
      { tStartMs: 0, dDurationMs: 900, segs: [{ utf8: 'Was' }] },
      { tStartMs: 500, dDurationMs: 900, segs: [{ utf8: 'Was bedeutet' }] },
      { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: 'Was bedeutet dieses Wort?' }] },
    ],
  });
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, 'Was bedeutet dieses Wort?');
  assert.equal(cues[0].text.includes('Was Was'), false);
});

test('aAppend events merge by overlap without repeating shared words', () => {
  const cues = new Json3Parser().parse({
    events: [
      { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Wir lernen' }] },
      { tStartMs: 800, dDurationMs: 1200, aAppend: 1, segs: [{ utf8: 'lernen Deutsch.' }] },
    ],
  });
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, 'Wir lernen Deutsch.');
});

test('rollup rows become stable two-line cues instead of one giant cue', () => {
  const cues = new Json3Parser().parse({
    events: [
      { tStartMs: 0, dDurationMs: 1180400, wWinId: 0 },
      { tStartMs: 480, dDurationMs: 5720, wWinId: 1, segs: [{ utf8: 'Liebe Freunde der Sonne, herzlich' }] },
      { tStartMs: 3629, dDurationMs: 2571, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] },
      { tStartMs: 3639, dDurationMs: 5201, wWinId: 1, segs: [{ utf8: 'willkommen zu einem neuen Video. Wir' }] },
      { tStartMs: 6190, dDurationMs: 2650, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] },
      { tStartMs: 6200, dDurationMs: 5280, wWinId: 1, segs: [{ utf8: 'wollen heute über das Wort erst' }] },
      { tStartMs: 8830, dDurationMs: 2650, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] },
      { tStartMs: 8840, dDurationMs: 5120, wWinId: 1, segs: [{ utf8: 'sprechen. Was bedeutet dieses Wort? In' }] },
      { tStartMs: 11470, dDurationMs: 2490, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] },
      { tStartMs: 11480, dDurationMs: 5639, wWinId: 1, segs: [{ utf8: 'welchen Kontexten benutzen wir das?' }] },
      { tStartMs: 13950, dDurationMs: 3169, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] },
      { tStartMs: 13960, dDurationMs: 5520, wWinId: 1, segs: [{ utf8: 'Diese Fragen werde ich euch heute in' }] },
      { tStartMs: 17109, dDurationMs: 2371, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] },
      { tStartMs: 17119, dDurationMs: 7721, wWinId: 1, segs: [{ utf8: 'diesem Video beantworten und wir' }] },
      { tStartMs: 19470, dDurationMs: 5370, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] },
      { tStartMs: 19480, dDurationMs: 5360, wWinId: 1, segs: [{ utf8: 'benutzen dafür natürlich unsere Fantasie' }] },
      { tStartMs: 25230, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] },
      { tStartMs: 25240, dDurationMs: 6160, wWinId: 1, segs: [{ utf8: 'Fantasie an. [räuspern]' }] },
      { tStartMs: 28710, dDurationMs: 2690, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] },
      { tStartMs: 28720, dDurationMs: 4999, wWinId: 1, segs: [{ utf8: 'Und bevor es losgeht, möchte ich mich' }] },
    ],
  });

  assert.equal(cues.length, 5);
  assert.deepEqual(cues[3], {
    startMs: 17119,
    endMs: 25240,
    text: 'diesem Video beantworten und wir benutzen dafür natürlich unsere Fantasie',
    index: 3,
  });
  assert.equal(cues[4].text, 'Fantasie an. [räuspern] Und bevor es losgeht, möchte ich mich');
  assert.equal(cueAtTime(cues, 20000)?.index, 3);
  assert.equal(cueAtTime(cues, 26000)?.index, 4);
});

test('parseWords folds punctuation segs into the neighbouring word', () => {
  const words = new Json3Parser().parseWords({
    events: [
      {
        tStartMs: 0,
        dDurationMs: 2000,
        segs: [
          { utf8: 'hello' },
          { utf8: ' ,', tOffsetMs: 300 },
          { utf8: ' world', tOffsetMs: 400 },
          { utf8: ' !', tOffsetMs: 800 },
        ],
      },
    ],
  });
  assert.deepEqual(
    words.map((w) => [w.text, w.startMs, w.endMs]),
    [['hello,', 0, 300], ['world!', 400, 800]]
  );
});
