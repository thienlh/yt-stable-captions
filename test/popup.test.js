const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const popup = fs.readFileSync(path.join(__dirname, '../src/popup/popup.js'), 'utf8');
const statusStart = popup.indexOf('  const VIDEO_SITES =');
const statusEnd = popup.indexOf('\n  // ---------- Start ----------');
assert.ok(statusStart >= 0 && statusEnd > statusStart, 'popup status section remains extractable');
const statusScript = popup.slice(statusStart, statusEnd);

function setup(url, granted) {
  const checks = [];
  const status = { hidden: false, dataset: {} };
  const grant = { hidden: true, addEventListener() {} };
  const statusText = { textContent: '' };
  const elements = { status, grant, 'status-text': statusText };
  const context = {
    $: (id) => elements[id],
    api: {
      permissions: {
        async contains(sites) {
          checks.push(sites);
          return sites.origins.every((origin) => granted.includes(origin));
        },
      },
      tabs: { query: async () => [{ url }] },
    },
  };
  vm.runInNewContext(statusScript, context);
  return { showStatus: context.showStatus, checks, status, grant, statusText };
}

for (const [name, url, required] of [
  ['YouTube', 'https://www.youtube.com/watch?v=abc', ['https://www.youtube.com/*']],
  ['youtube-nocookie', 'https://www.youtube-nocookie.com/embed/abc', ['https://www.youtube-nocookie.com/*']],
  ['HackerTube', 'https://hackertube.org/watch/abc', ['https://hackertube.org/*', 'https://www.youtube-nocookie.com/*']],
]) {
  test(`popup status only requires the active page's permissions on ${name}`, async () => {
    // Deliberately leave every unrelated video-site permission ungranted.
    const { showStatus, checks, status, grant, statusText } = setup(url, required);
    await showStatus();
    assert.equal(checks.length, 1);
    assert.deepEqual(Array.from(checks[0].origins), required);
    assert.equal(status.hidden, false);
    assert.equal(grant.hidden, true);
    assert.equal(statusText.textContent, 'on the tube');
  });
}

test('popup still asks for access when the active page permission is missing', async () => {
  const granted = ['https://www.youtube-nocookie.com/*', 'https://hackertube.org/*'];
  const { showStatus, checks, status, grant } = setup('https://www.youtube.com/watch?v=abc', granted);
  await showStatus();
  assert.deepEqual(Array.from(checks[0].origins), ['https://www.youtube.com/*']);
  assert.equal(status.hidden, true);
  assert.equal(grant.hidden, false);
});

test('HackerTube status asks for its caption iframe permission', async () => {
  const { showStatus, checks, status, grant } = setup('https://hackertube.org/watch/abc', ['https://hackertube.org/*']);
  await showStatus();
  assert.deepEqual(Array.from(checks[0].origins), ['https://hackertube.org/*', 'https://www.youtube-nocookie.com/*']);
  assert.equal(status.hidden, true);
  assert.equal(grant.hidden, false);
});
