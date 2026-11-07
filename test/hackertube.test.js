const test = require('node:test');
const assert = require('node:assert/strict');
const manifest = require('../manifest.json');
require('../src/content/main.js');

const { StableCaptionsController } = globalThis.YTSC;

function videoIdAt(url) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { value: new URL(url), configurable: true });
  try {
    return StableCaptionsController.prototype.currentVideoId();
  } finally {
    if (previous) Object.defineProperty(globalThis, 'location', previous);
    else delete globalThis.location;
  }
}

test('video IDs come from YouTube watch pages and privacy-enhanced embeds', () => {
  assert.equal(videoIdAt('https://www.youtube.com/watch?v=mScpHTIi-kM'), 'mScpHTIi-kM');
  assert.equal(videoIdAt('https://www.youtube-nocookie.com/embed/mScpHTIi-kM?rel=0&autoplay=1'), 'mScpHTIi-kM');
  assert.equal(videoIdAt('https://www.youtube.com/'), null);
  assert.equal(videoIdAt('https://www.youtube-nocookie.com/embed/'), null);
  assert.equal(videoIdAt('https://hackertube.org/watch/mScpHTIi-kM'), null);
});

test('every caption content script runs in HackerTube\'s YouTube iframe', () => {
  for (const script of manifest.content_scripts) {
    assert.equal(script.all_frames, true);
    assert.ok(script.matches.includes('https://www.youtube-nocookie.com/embed/*'));
  }
  assert.ok(manifest.host_permissions.includes('https://www.youtube-nocookie.com/*'));
  assert.ok(manifest.host_permissions.includes('https://hackertube.org/*'));
  assert.ok(manifest.web_accessible_resources[0].matches.includes('https://www.youtube-nocookie.com/*'));
});
