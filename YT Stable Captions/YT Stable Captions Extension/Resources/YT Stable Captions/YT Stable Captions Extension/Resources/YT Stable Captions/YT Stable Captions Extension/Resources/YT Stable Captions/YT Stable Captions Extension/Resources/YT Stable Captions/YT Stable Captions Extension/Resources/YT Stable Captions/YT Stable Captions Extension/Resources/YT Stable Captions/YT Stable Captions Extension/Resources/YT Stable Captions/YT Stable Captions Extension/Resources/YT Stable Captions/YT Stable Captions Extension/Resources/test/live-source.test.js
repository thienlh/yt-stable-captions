const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/core/text-utils.js');
require('../src/core/rolling-merger.js');
require('../src/core/chunker.js');
require('../src/content/live-source.js');

const { LiveWordDiff, LiveChunker } = globalThis.YTSC;

test('live diff returns only newly spoken words from rolling windows', () => {
  const d = new LiveWordDiff();
  assert.deepEqual(d.push('Was'), ['Was']);
  assert.deepEqual(d.push('Was bedeutet'), ['bedeutet']);
  assert.deepEqual(d.push('Was bedeutet dieses Wort?'), ['dieses', 'Wort?']);
});

test('live diff handles a scrolled-off row and new text in one snapshot', () => {
  const d = new LiveWordDiff();
  d.push('row one words row two');
  assert.deepEqual(d.push('row two and more'), ['and', 'more']);
});

test('live diff ignores partial re-renders and last-word corrections', () => {
  const d = new LiveWordDiff();
  d.push('wir lernen das Wort');
  assert.deepEqual(d.push('wir lernen'), []); // half-rendered snapshot
  assert.deepEqual(d.push('wir lernen das Worte heute'), ['heute']);
});

test('live chunker emits whole chunks only, capped in size', () => {
  const c = new LiveChunker({ maxWords: 4 });
  assert.deepEqual(c.push(['one', 'two', 'three'], 0), []);
  const closed = c.push(['four', 'five'], 100);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].text, 'one two three four');
  assert.equal(c.flush().text, 'five');
  assert.equal(c.flush(), null);
});

test('live chunker closes at sentence end', () => {
  const c = new LiveChunker();
  const closed = c.push(['Das', 'ist', 'fertig.', 'Und'], 0);
  assert.deepEqual(closed.map((x) => x.text), ['Das ist fertig.']);
});
