const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/core/language-preference.js');

const { CaptionLanguagePreference: Preference } = globalThis.YTSC;
const at = (n) => 1700000000000 + n * 1000;
const history = (languages) => languages.map((language, i) => ({ language, selectedAt: at(i) }));

test('the first manual selection becomes the preferred language immediately', () => {
  let events = [];
  assert.equal(Preference.preferred(events), null);
  events = Preference.record(events, ' VI_vn ', at(0));
  assert.equal(Preference.preferred(events), 'vi-vn');
});

test('the latest manual selection replaces the previous preference', () => {
  let events = Preference.record([], 'vi', at(0));
  events = Preference.record(events, 'fr', at(1));
  assert.equal(Preference.preferred(events), 'fr');
  assert.equal(events.length, 1);
});

test('old rolling history migrates to its latest valid selection', () => {
  const events = history(['vi', 'vi', 'vi', 'fr']);
  assert.equal(Preference.preferred(events), 'fr');
  assert.deepEqual(Preference.clean(events), [{ language: 'fr', selectedAt: at(3) }]);
});

test('malformed entries are ignored and invalid updates keep the preference', () => {
  const dirty = [
    null,
    { language: '', selectedAt: 1 },
    { language: 'vi' },
    { language: 'fr', selectedAt: 'yesterday' },
    { language: 'en', selectedAt: at(4) },
  ];
  assert.deepEqual(Preference.clean(dirty), [{ language: 'en', selectedAt: at(4) }]);
  assert.equal(Preference.preferred(dirty), 'en');
  const current = Preference.record([], 'vi', at(5));
  assert.deepEqual(Preference.record(current, 'fr', NaN), current);
  assert.equal(Preference.preferred(current), 'vi');
});
