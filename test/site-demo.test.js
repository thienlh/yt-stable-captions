const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../site/demo.js'), 'utf8');

class El {
  constructor() {
    this.dataset = {};
    this.style = { setProperty() {} };
    const classes = new Set();
    this.classList = {
      add: (...n) => n.forEach((c) => classes.add(c)),
      remove: (...n) => n.forEach((c) => classes.delete(c)),
      contains: (c) => classes.has(c),
    };
    this.offsetWidth = 0;
    this.textContent = '';
  }
  appendChild(child) { return child; }
  append() {}
  replaceChildren() {}
  querySelector() { return null; }
}

const PlayerState = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3 };

/** Runs the tour on a fake clock. `tick(ms)` plays frames 100ms apart. */
function loadDemo() {
  let now = 0;
  let pendingFrame = null;
  const keydown = [];
  const screen = new El();
  const overlay = new El();
  const toast = new El();
  const sandbox = {
    performance: { now: () => now },
    requestAnimationFrame(fn) { pendingFrame = fn; return 1; },
    setTimeout: () => 0, // toasts and the clean-captions hold are not under test
    clearTimeout() {},
    ResizeObserver: class { observe() {} },
    Element: El,
    location: { origin: 'https://stable.monster' },
    document: {
      head: { appendChild() {} },
      createElement: () => new El(),
      createTextNode: () => new El(),
      querySelector: (s) => (s === '.screen' ? screen : null),
      querySelectorAll: () => [],
      getElementById: (id) => ({ 'ytsc-overlay': overlay, 'ytsc-toast': toast })[id] || null,
    },
    matchMedia: () => ({ matches: false }),
    addEventListener(type, fn) { if (type === 'keydown') keydown.push(fn); },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox);

  const tick = (ms) => {
    for (let t = 0; t < ms; t += 100) {
      now += 100;
      const frame = pendingFrame;
      pendingFrame = null;
      frame?.();
    }
  };
  const press = (key, { shiftKey = false, altKey = false, code = '' } = {}) => {
    const event = {
      key, code, shiftKey, altKey, ctrlKey: false, metaKey: false, repeat: false, target: null,
      preventDefault() {}, stopPropagation() {},
    };
    keydown.forEach((fn) => fn(event));
  };
  return { sandbox, screen, overlay, tick, press, seconds: () => now / 1000 };
}

test('an idle visitor sees the tour start over at the end of the loop', () => {
  const demo = loadDemo();
  demo.tick(85_000);
  assert.equal(demo.screen.dataset.ytscStyle, 'tiktok');
  assert.equal(demo.screen.dataset.ytscTiktokWindow, '50');
  demo.tick(8_000); // past the 92s loop
  assert.equal(demo.screen.dataset.ytscStyle, 'frosted');
  assert.equal(demo.screen.dataset.ytscTiktokWindow, 'off');
  assert.equal(demo.screen.dataset.ytscSize, 'medium');
});

test("a visitor's own changes are not wiped by the loop restart while they are trying keys", () => {
  const demo = loadDemo();
  demo.tick(90_000);
  demo.press('w'); // Short background 50% → 75%
  assert.equal(demo.screen.dataset.ytscTiktokWindow, '75');
  demo.tick(5_000); // the loop ends at 92s
  assert.equal(demo.screen.dataset.ytscStyle, 'tiktok', 'still what the visitor set');
  assert.equal(demo.screen.dataset.ytscTiktokWindow, '75');
  demo.press('+');
  assert.equal(demo.screen.dataset.ytscSize, 'xlarge'); // the tour had set Large
});

test('once the visitor stops, the tour restarts from its first step', () => {
  const demo = loadDemo();
  demo.tick(90_000);
  demo.press('w');
  demo.tick(25_000); // past the loop end, and idle for the 20s the tour waits
  assert.equal(demo.screen.dataset.ytscStyle, 'frosted');
  assert.equal(demo.screen.dataset.ytscTiktokWindow, 'off');
  // The restart happened at most a few seconds ago, so the tour is at its start:
  // captions came on, but the size step (9s in) has not fired, nor every missed step at once.
  assert.equal(demo.screen.dataset.ytscSize, 'medium');
  demo.tick(10_000);
  assert.equal(demo.screen.dataset.ytscSize, 'large', 'the tour runs again');
});

test('the clip keeps looping after a player call throws once', () => {
  const demo = loadDemo();
  let seeks = 0;
  let stateCalls = 0;
  const player = {
    getCurrentTime: () => 200, // past the clip end
    getPlayerState() {
      stateCalls++;
      if (stateCalls === 1) throw new Error('player not ready');
      return PlayerState.PLAYING;
    },
    seekTo() { seeks++; },
    playVideo() {},
    getOptions: () => [],
  };
  demo.sandbox.YT = { Player: function Player() { return player; }, PlayerState };
  demo.sandbox.onYouTubeIframeAPIReady();
  demo.tick(300);
  assert.ok(seeks >= 2, `the clip end keeps sending the player back (seeks: ${seeks})`);
});
