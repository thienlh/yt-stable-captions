const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/core/text-utils.js');
require('../src/core/chunker.js');
require('../src/core/disfluency.js');

const { Disfluency, CaptionChunker } = globalThis.YTSC;

/** Words 300ms apart, 250ms long, from a plain sentence. */
const timed = (sentence) =>
  sentence.split(' ').map((text, i) => ({ text, startMs: i * 300, endMs: i * 300 + 250 }));
const cleanText = (sentence, opts) =>
  new Disfluency(opts).clean(timed(sentence)).map((w) => w.text).join(' ');

test('drops fillers in English, German and Vietnamese', () => {
  assert.equal(cleanText('So, um, we started. Uh, it worked.'), 'So we started. It worked.');
  assert.equal(cleanText('Also, äh, ich glaube, ähm, dass'), 'Also, ich glaube, dass');
  assert.equal(cleanText('Thì, ờ, mình nghĩ là, ừm, tụi mình'), 'Thì, mình nghĩ là, tụi mình');
});

test('strips a leftover comma after a conjunction that only set off a filler', () => {
  assert.equal(cleanText('Und, äh, am Anfang'), 'Und am Anfang');
  assert.equal(cleanText('And, uh, then we left'), 'And then we left');
  assert.equal(cleanText('But, um, wait.'), 'But wait.');
  assert.equal(cleanText('và, ờ, rồi đi'), 'và rồi đi');
});

test('keeps a clause comma that is not just wrapping a filler', () => {
  assert.equal(cleanText('ich glaube, ähm, dass'), 'ich glaube, dass');
});

test('keeps words that only look like fillers', () => {
  // "à" is also a Vietnamese particle; "like"/"you know" are opt-in.
  assert.equal(cleanText('Anh đi à'), 'Anh đi à');
  assert.equal(cleanText('I like it, you know'), 'I like it, you know');
});

test('keeps a repeated phrase in a manual caption', () => {
  const words = timed('là nhà là nhà của nhau').map((word) => ({ ...word, estimated: true }));
  assert.equal(new Disfluency().clean(words).map((w) => w.text).join(' '), 'là nhà là nhà của nhau');
});

test('collapses repeats, keeping the last copy', () => {
  assert.equal(cleanText('I I I think the the main thing'), 'I think the main thing');
  assert.equal(cleanText('nobody, nobody believed it'), 'nobody believed it');
  assert.equal(cleanText('không ai, không ai tin'), 'không ai tin');
});

test('sees repeats through fillers', () => {
  assert.equal(cleanText("It's, um, it's surreal."), "It's surreal.");
  assert.equal(cleanText('but, uh, but here we are'), 'but here we are');
});

test('repairs capitals and sentence punctuation', () => {
  assert.equal(cleanText('It happened. Um, it just did.'), 'It happened. It just did.');
  assert.equal(cleanText('That was it um.'), 'That was it.');
  assert.equal(cleanText('Um, hello'), 'Hello');
});

test('absorbs dropped time into the previous word', () => {
  const words = [
    { text: 'So,', startMs: 0, endMs: 200 },
    { text: 'um,', startMs: 200, endMs: 900 },
    { text: 'we', startMs: 900, endMs: 1100 },
  ];
  const out = new Disfluency().clean(words);
  assert.deepEqual(out, [
    { text: 'So', startMs: 0, endMs: 900 },
    { text: 'we', startMs: 900, endMs: 1100 },
  ]);
  assert.equal(words[0].endMs, 200, 'input is not mutated');
  // Without absorbing, the 700ms "gap" would be a pause and split the chunk.
  assert.deepEqual(new CaptionChunker().build(out).map((c) => c.text), ['So we']);
});

test('aggressive mode also drops discourse markers', () => {
  assert.equal(
    cleanText('And, like, when we started, I mean, it was, you know, hard', { aggressive: true }),
    'And when we started, it was, hard'
  );
});

test('drop option removes only the chosen kinds', () => {
  assert.equal(cleanText('So, um, I I think', { drop: ['repeat'] }), 'So, um, I think');
  assert.equal(cleanText('So, um, I I think', { drop: ['filler'] }), 'So I I think');
});

test('turns [Music] tags into a standalone ♪', () => {
  assert.equal(cleanText('[Music] So today we'), '♪ So today we');
  assert.equal(cleanText('[Musik] Also, äh, ich'), '♪ Also, ich');
  assert.equal(cleanText('[âm nhạc] Xin chào'), '♪ Xin chào', 'multi-word tag');
  assert.equal(cleanText('[Applause] [Laughter] thanks'), '[Applause] [Laughter] thanks', 'other tags stay');
  assert.equal(cleanText('[Musical] notes'), '[Musical] notes', 'whole-tag match only');
  assert.equal(cleanText('[Music] um. Hi'), '♪ Hi', 'the note takes no punctuation from dropped words');
});

test('merges consecutive music tags into one note spanning their time', () => {
  const words = [
    { text: '[Music]', startMs: 0, endMs: 2000 },
    { text: '[Music]', startMs: 2000, endMs: 5000 },
    { text: 'Hello', startMs: 5200, endMs: 5500 },
  ];
  const out = new Disfluency().clean(words);
  assert.deepEqual(out.map((w) => [w.text, w.startMs, w.endMs]), [['♪', 0, 5000], ['Hello', 5200, 5500]]);
  // The note is its own chunk even without a pause before the next words.
  assert.deepEqual(new CaptionChunker().build(out).map((c) => c.text), ['♪', 'Hello']);
});

test('handles empty and filler-only input', () => {
  const d = new Disfluency();
  assert.deepEqual(d.clean([]), []);
  assert.deepEqual(d.clean(timed('um uh')), []);
});
