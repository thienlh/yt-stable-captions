const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../site/index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const chromeStore = 'https://chromewebstore.google.com/detail/stable-captions/pnbjnjdceehalphkhaibplklhjoboodd';
const firefoxStore = 'https://addons.mozilla.org/firefox/addon/stable-captions/';
const safariBeta = 'https://testflight.apple.com/join/htQvssyM';
const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
const chrome = `${mac} AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36`;
const safari = `${mac} AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15`;

// Only model the DOM used by the inline install/picker script.
function setup(userAgent = chrome, maxTouchPoints = 0) {
  const installMarkup = html.match(/<a class="install" href="([^"]+)">([^<]+)<\/a>/);
  assert.ok(installMarkup, 'primary install remains a direct anchor, not a summary');
  const install = {
    href: installMarkup[1],
    textContent: installMarkup[2],
    children: [],
    append(child) { this.children.push(child); },
  };
  const summary = { focused: false, focus() { this.focused = true; } };
  const links = Array.from({ length: 4 }, () => new EventTarget());
  const picker = Object.assign(new EventTarget(), {
    open: false,
    contains(target) { return target === summary || links.includes(target); },
    querySelector(selector) { assert.equal(selector, 'summary'); return summary; },
    querySelectorAll(selector) { assert.equal(selector, 'a'); return links; },
  });
  const sticker = { textContent: 'beta!' };
  const elements = {
    'header .install': install,
    '.browser-picker': picker,
    '#get .sticker': { cloneNode: () => ({ ...sticker }) },
  };
  const document = Object.assign(new EventTarget(), {
    querySelector(selector) {
      assert.ok(elements[selector], `unexpected selector: ${selector}`);
      return elements[selector];
    },
  });
  vm.runInNewContext(script, {
    document,
    navigator: { userAgent, maxTouchPoints },
    matchMedia: () => ({ matches: false }),
  });
  return { install, picker, summary, links, document };
}

for (const [name, ua, touch, label, href] of [
  ['Chrome', chrome, 0, 'Add to Chrome', chromeStore],
  ['Edge', `${chrome} Edg/130.0.0.0`, 0, 'Add to Edge', chromeStore],
  ['Firefox', `${mac} Gecko/20100101 Firefox/132.0`, 0, 'Add to Firefox', firefoxStore],
  ['Mac Safari', safari, 0, 'Help test in Safari', safariBeta],
  ['iPad desktop UA', safari, 5, 'Add to Chrome', chromeStore],
  ['unknown browser', '', 0, 'Add to Chrome', chromeStore],
]) {
  test(`site install links directly to the store for ${name}`, () => {
    const { install } = setup(ua, touch);
    assert.equal(install.href, href);
    assert.equal(install.textContent, label);
    assert.equal(install.children.length, href === safariBeta ? 1 : 0);
  });
}

test('hero and separate picker expose all browsers without JavaScript', () => {
  assert.match(html, /<details class="browser-picker">\s*<summary>Other browsers<\/summary>/);
  for (const className of ['browser-links', 'browser-options']) {
    const nav = html.match(new RegExp(`<nav class="${className}"[^>]*>([\\s\\S]*?)<\\/nav>`))[1];
    for (const [browser, href] of [['Chrome', chromeStore], ['Edge', chromeStore], ['Firefox', firefoxStore], ['Safari', safariBeta]]) {
      assert.ok(nav.includes(`<a href="${href}">${browser}`), `${className} links to ${browser}`);
    }
    assert.match(nav, /Safari[\s\S]*beta/);
  }
});

test('Escape closes the picker and restores focus to its summary', () => {
  const { picker, summary } = setup();
  const keydown = (key) => Object.assign(new Event('keydown'), { key });
  picker.open = true;
  picker.dispatchEvent(keydown('Tab'));
  assert.equal(picker.open, true);
  picker.dispatchEvent(keydown('Escape'));
  assert.equal(picker.open, false);
  assert.equal(summary.focused, true);
  summary.focused = false;
  picker.dispatchEvent(keydown('Escape'));
  assert.equal(summary.focused, false, 'closed picker does not steal focus');
});

test('outside clicks and browser selection dismiss the picker', () => {
  const { picker, summary, links, document, install } = setup();
  const click = (target) => {
    const event = new Event('click');
    Object.defineProperty(event, 'target', { value: target });
    document.dispatchEvent(event);
  };
  picker.open = true;
  click(summary);
  assert.equal(picker.open, true, 'inside clicks are left to native details behavior');
  click(install);
  assert.equal(picker.open, false, 'primary install is outside the picker');
  for (const link of links) {
    picker.open = true;
    link.dispatchEvent(new Event('click'));
    assert.equal(picker.open, false);
  }
});
