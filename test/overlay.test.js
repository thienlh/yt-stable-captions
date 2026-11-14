const test = require('node:test');
const assert = require('node:assert/strict');

// A tiny DOM: parent links, isConnected, classList and the few calls overlay.js makes.
class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.parentNode = null;
    this.style = {
      props: {},
      setProperty(name, value) { this.props[name] = value; },
      removeProperty(name) { delete this.props[name]; },
    };
    this.attributes = {};
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
      contains: (name) => classes.has(name),
    };
    this.offsetWidth = 0;
  }
  get isConnected() { return this === root || Boolean(this.parentNode?.isConnected); }
  set textContent(value) {
    this.children.forEach((c) => { c.parentNode = null; });
    this.children = [];
    this._text = value || undefined;
  }
  get textContent() { return this._text ?? this.children.map((c) => c.textContent).join(''); }
  appendChild(child) {
    child.remove?.();
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
    this.parentNode = null;
  }
  setAttribute(name, value) { this.attributes[name] = value; }
}

const root = new FakeElement('html');
const player = root.appendChild(new FakeElement('div'));
globalThis.document = {
  documentElement: root,
  body: root,
  createElement: (tag) => new FakeElement(tag),
  createTextNode: (text) => Object.assign(new FakeElement('#text'), { _text: text }),
  querySelector: (selector) => (selector === '.html5-video-player' ? player : null),
};
globalThis.getComputedStyle = () => ({ position: 'relative' });
globalThis.ResizeObserver = class { observe() {} disconnect() {} };

require('../src/content/overlay.js');
const { CaptionOverlay } = globalThis.YTSC;

const nativeHidden = () => root.children.some((c) => c.id === 'ytsc-hide-native');
const overlayShown = () => player.children.some((c) => c.id === 'ytsc-overlay');

test('destroy gives native captions back, and a later mount takes over again', () => {
  const overlay = new CaptionOverlay();
  overlay.mount();
  overlay.render({ text: 'hello', words: [{ text: 'hello', startMs: 0 }] }, 0);
  assert.ok(nativeHidden());
  assert.ok(overlayShown());

  overlay.destroy();
  assert.ok(!nativeHidden(), 'native captions are visible again');
  assert.ok(!overlayShown());

  overlay.mount();
  overlay.render({ text: 'again', words: [{ text: 'again', startMs: 0 }] }, 0);
  assert.ok(nativeHidden());
  assert.ok(overlayShown());
  assert.equal(overlay.el.textContent, 'again');
});

test('destroy before any mount is harmless', () => {
  const overlay = new CaptionOverlay();
  overlay.destroy();
  assert.equal(overlay.el, null);
});

test('a caption lift set before mount, or kept across a remount, still applies', () => {
  const overlay = new CaptionOverlay();
  overlay.setLift(3);
  overlay.mount();
  assert.equal(overlay.el.style.props['--ytsc-lift'], '3');

  overlay.destroy();
  overlay.mount();
  assert.equal(overlay.el.style.props['--ytsc-lift'], '3');

  overlay.setLift(0);
  assert.ok(!('--ytsc-lift' in overlay.el.style.props), 'default position leaves no override');
  overlay.destroy();
});

test('emoji keep their full sequences and the surrounding word timing', () => {
  const overlay = new CaptionOverlay();
  const first = 'happy😊!';
  const sequences = ['☺️', '👩🏽‍💻', '👨‍👩‍👧‍👦', '🇻🇳', '1️⃣', '🏴\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}'];
  const second = sequences.join('');
  const chunk = { words: [
    { text: first, startMs: 0 },
    { text: second, startMs: 1000 },
    { text: '123 plain text', startMs: 2000 },
  ] };
  overlay.render(chunk, 0);
  assert.equal(overlay.el.textContent, `${first} ${second} 123 plain text`);
  assert.equal(overlay.spans.length, 3, 'emoji do not become extra timed words');
  assert.deepEqual(overlay.spans[0].children.map((node) => node.textContent), ['happy', '😊', '!']);
  assert.deepEqual(overlay.spans[1].children.map((node) => node.textContent), sequences);
  assert.ok(overlay.spans[1].children.every((node) => node.className === 'ytsc-emoji'));
  assert.equal(overlay.spans[2].children.length, 0, 'ordinary text needs no extra spans');
  assert.ok(overlay.spans[0].classList.contains('ytsc-active'));
  overlay.render(chunk, 1000);
  assert.ok(!overlay.spans[0].classList.contains('ytsc-active'));
  assert.ok(overlay.spans[1].classList.contains('ytsc-active'));
  overlay.destroy();
});
