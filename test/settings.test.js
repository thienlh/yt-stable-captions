const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../src/core/settings.js');

const { Settings } = globalThis.YTSC;
const css = fs.readFileSync(path.join(__dirname, '../src/content/styles.css'), 'utf8');

test('every size has a matching styles.css rule (medium is the base value)', () => {
  const base = Number(css.match(/--ytsc-size:\s*([\d.]+);/)[1]);
  assert.equal(base, Settings.SIZE_VALUES.medium, 'base --ytsc-size is medium');
  for (const size of Settings.SIZES.filter((s) => s !== 'medium')) {
    const rule = css.match(new RegExp(`data-ytsc-size="${size}"\\] #ytsc-overlay \\{ --ytsc-size: ([\\d.]+); \\}`));
    assert.ok(rule, `styles.css rule for ${size}`);
    assert.equal(Number(rule[1]), Settings.SIZE_VALUES[size], `${size} value`);
  }
});

test('every window level has a styles.css rule (defaults are the base values)', () => {
  for (const level of Settings.WINDOWS.frosted.levels.filter((l) => l !== 'medium')) {
    assert.match(css, new RegExp(`data-ytsc-frosted-window="${level}"\\]`), `frosted ${level}`);
  }
  for (const level of Settings.WINDOWS.tiktok.levels.filter((l) => l !== 'off')) {
    assert.match(css, new RegExp(`data-ytsc-tiktok-window="${level}"\\]`), `short ${level}`);
  }
});

test('defaults are valid values, with clean verbatim on', () => {
  const d = Settings.DEFAULTS;
  assert.ok(Settings.STYLES.includes(d.style));
  assert.ok(Settings.SIZES.includes(d.size));
  assert.ok(Settings.WINDOWS.frosted.levels.includes(d.frostedWindow));
  assert.ok(Settings.WINDOWS.tiktok.levels.includes(d.tiktokWindow));
  assert.equal(d.clean, true);
  assert.equal(d.highlight, true);
  assert.equal(Settings.STYLE_LABELS.tiktok, 'Short');
});

test('sizes saved on the old ladder keep how they look', () => {
  const { sizeMigration, SIZE_VALUES } = Settings;
  const OLD = { tiny: 0.03, xsmall: 0.036, small: 0.042, medium: 0.048 };
  for (const [size, value] of Object.entries(OLD)) {
    const patch = sizeMigration({ size });
    assert.equal(SIZE_VALUES[patch.size], value, `old ${size}`);
    assert.equal(patch.sizeLadder, 2);
  }
  assert.equal(sizeMigration({ size: 'xxlarge' }).size, 'xxlarge', 'old XXL gets the largest step');
});

test('size migration runs once, and leaves an unsaved size on the new default', () => {
  const { sizeMigration } = Settings;
  assert.equal(sizeMigration({ size: 'tiny', sizeLadder: 2 }), null, 'already moved');
  assert.deepEqual(sizeMigration({}), { sizeLadder: 2 }, 'nothing saved');
  assert.deepEqual(sizeMigration(), { sizeLadder: 2 });
});

test('word highlight off has a styles.css rule that beats both styles', () => {
  assert.match(css, /html\[data-ytsc-highlight="false"\] #ytsc-overlay \.ytsc-word\.ytsc-active/);
  const off = css.indexOf('data-ytsc-highlight="false"');
  assert.ok(off > css.lastIndexOf('html[data-ytsc-style="tiktok"] #ytsc-overlay .ytsc-word.ytsc-active'), 'comes after the Short rule');
});
