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
  assert.equal(Settings.STYLE_LABELS.tiktok, 'Short');
});
