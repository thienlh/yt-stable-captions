const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = [
  fs.readFileSync(path.join(__dirname, '../src/core/settings.js'), 'utf8'),
  fs.readFileSync(path.join(__dirname, '../src/content/settings-bridge.js'), 'utf8'),
].join('\n');

// Storage and the stylesheet fetch both settle on a later turn.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Runs the bridge the way a content script would: one extension API, a real
// documentElement, and a fetch we control. No browser and no jsdom.
function load({ root, fetch: fetchImpl, stored = {} }) {
  const nodes = [];
  const documentElement = {
    dataset: {},
    appendChild(node) { nodes.push(node); },
  };
  const calls = [];
  const sandbox = {
    document: {
      documentElement,
      createElement(tag) { return { tagName: tag, textContent: '' }; },
    },
    fetch(url) {
      calls.push(url);
      return fetchImpl(url);
    },
    window: { addEventListener() {} },
    chrome: {
      runtime: { getURL: (file) => root + file },
      storage: {
        sync: {
          get() { return Promise.resolve(stored); },
          set() { return Promise.resolve(); },
        },
        onChanged: { addListener() {} },
      },
    },
  };
  vm.runInNewContext(source, sandbox);
  return {
    nodes,
    documentElement,
    calls,
    sheet: nodes.find((node) => node.id === 'ytsc-styles'),
  };
}

test('Safari loads styles.css with a link and does not fetch it', () => {
  const root = 'safari-web-extension://id/';
  const { sheet, calls } = load({
    root,
    fetch: () => { throw new Error('Safari should not fetch the sheet'); },
  });
  assert.equal(sheet.tagName, 'link');
  assert.equal(sheet.rel, 'stylesheet');
  assert.equal(sheet.href, `${root}src/content/styles.css`);
  assert.deepEqual(calls, []);
});

test('Chrome and Firefox inline the fetched stylesheet', async () => {
  const css = '#ytsc-overlay{color:#fff}';
  const root = 'chrome-extension://id/';
  const { sheet, calls } = load({
    root,
    fetch: () => Promise.resolve({ ok: true, text: () => Promise.resolve(css) }),
  });
  assert.equal(sheet.tagName, 'style');
  assert.equal(sheet.textContent, '');
  await flush();
  assert.deepEqual(calls, [`${root}src/content/styles.css`]);
  assert.equal(sheet.textContent, css);
});

test('a rejected stylesheet fetch still applies saved settings', async () => {
  const { sheet, documentElement } = load({
    root: 'moz-extension://id/',
    stored: { style: 'boring', size: 'large', sizeLadder: 2 },
    fetch: () => Promise.reject(new Error('network')),
  });
  await flush();
  assert.equal(sheet.tagName, 'style');
  assert.equal(sheet.textContent, '');
  assert.equal(documentElement.dataset.ytscStyle, 'boring');
  assert.equal(documentElement.dataset.ytscSize, 'large');
  assert.equal(documentElement.dataset.ytscClean, 'true');
});

test('an unsuccessful stylesheet response is not inlined', async () => {
  const { sheet, documentElement } = load({
    root: 'chrome-extension://id/',
    fetch: () => Promise.resolve({
      ok: false,
      status: 404,
      text() { throw new Error('error body should not be inlined'); },
    }),
  });
  await flush();
  assert.equal(sheet.textContent, '');
  assert.equal(documentElement.dataset.ytscStyle, 'frosted');
  assert.equal(documentElement.dataset.ytscSize, 'medium');
});
