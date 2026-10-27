const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/core/text-utils.js');
require('../src/core/rolling-merger.js');

const { TextUtils, RollingTextMerger } = globalThis.YTSC;

test('normalize strips zero-width chars and collapses whitespace', () => {
  assert.equal(TextUtils.normalize('  hello\u200b  world \n '), 'hello world');
});

test('comparableWord ignores case and edge punctuation', () => {
  assert.equal(TextUtils.comparableWord('"Hello!"'), 'hello');
  assert.equal(TextUtils.comparableWord('Wort?'), 'wort');
});

test('sentenceIsComplete detects terminal punctuation', () => {
  assert.equal(TextUtils.sentenceIsComplete('Das ist gut.'), true);
  assert.equal(TextUtils.sentenceIsComplete('Was bedeutet das?'), true);
  assert.equal(TextUtils.sentenceIsComplete('noch nicht fertig'), false);
});

test('merger keeps the longer window when one is a prefix', () => {
  const m = new RollingTextMerger();
  assert.equal(m.merge('Was bedeutet', 'Was bedeutet dieses Wort?'), 'Was bedeutet dieses Wort?');
});

test('merger joins on suffix/prefix overlap without duplication', () => {
  const m = new RollingTextMerger();
  assert.equal(m.merge('Wir lernen', 'lernen Deutsch.'), 'Wir lernen Deutsch.');
});

test('merger concatenates disjoint text', () => {
  const m = new RollingTextMerger();
  assert.equal(m.merge('Hallo Welt', 'Wie geht es?'), 'Hallo Welt Wie geht es?');
});

test('splitWords attaches stray punctuation to its word', () => {
  assert.deepEqual(TextUtils.splitWords('hello , world !'), ['hello,', 'world!']);
  assert.deepEqual(TextUtils.splitWords('« Bonjour » ? ¿ Qué ?'), ['«Bonjour»?', '¿Qué?']);
  assert.deepEqual(TextUtils.splitWords('wait ... ( really ) .'), ['wait...', '(really).']);
});

test('splitWords keeps dashes, symbols and bare quotes as tokens', () => {
  assert.deepEqual(TextUtils.splitWords('rock & roll — yes " no'), ['rock', '&', 'roll', '—', 'yes', '"', 'no']);
  assert.deepEqual(TextUtils.splitWords(', then'), [',', 'then']);
  assert.deepEqual(TextUtils.splitWords('so ('), ['so', '(']);
});
