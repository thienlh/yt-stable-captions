#!/usr/bin/env node
// Real Chromium A/B memory measurement using only Node's built-in WebSocket/fetch.
// Launches isolated temporary profiles; never attaches to the user's Chrome session.
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEFAULT_URL = 'https://www.youtube-nocookie.com/embed/aircAruvnKk?autoplay=0&cc_load_policy=1&rel=0';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CDP {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`${pending.method}: DevTools connection closed`));
      }
      this.pending.clear();
    });
  }

  static async open(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('DevTools WebSocket open timed out')), 10000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', (event) => {
        clearTimeout(timer);
        reject(new Error(`DevTools WebSocket error: ${event.message || 'unknown'}`));
      }, { once: true });
    });
    return new CDP(socket);
  }

  send(method, params = {}, timeoutMs = 30000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

function parseArgs(argv) {
  const options = {
    chrome: process.env.CHROME || DEFAULT_CHROME,
    extension: path.join(ROOT, 'dist', 'chrome'),
    url: DEFAULT_URL,
    runs: 3,
    settleMs: 8000,
    warmup: true,
    headless: false,
    captions: true,
    captionSettleMs: 5000,
    debugController: false,
    fixture: null,
    allowNoVideo: false,
    mode: 'both',
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--chrome') options.chrome = argv[++index];
    else if (arg === '--extension') options.extension = path.resolve(argv[++index]);
    else if (arg === '--url') options.url = argv[++index];
    else if (arg === '--runs') options.runs = Number(argv[++index]);
    else if (arg === '--settle-ms') options.settleMs = Number(argv[++index]);
    else if (arg === '--mode') options.mode = argv[++index];
    else if (arg === '--json') options.json = path.resolve(argv[++index]);
    else if (arg === '--headful') options.headless = false;
    else if (arg === '--headless') options.headless = true;
    else if (arg === '--no-cc') options.captions = false;
    else if (arg === '--allow-no-video') options.allowNoVideo = true;
    else if (arg === '--debug-controller') options.debugController = true;
    else if (arg === '--fixture') {
      options.fixture = path.resolve(argv[++index]);
      options.debugController = true;
    } else if (arg === '--no-warmup') options.warmup = false;
    else if (arg === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/browser-memory-chrome.js [options]\n\n` +
    `Runs an isolated extension-off/on comparison using dist/chrome.\n\n` +
    `Options:\n` +
    `  --url <url>         Test page (default: paused captioned YouTube embed)\n` +
    `  --runs <n>          Fresh browser launches per mode (default: 3)\n` +
    `  --mode off|on|both  Extension mode (default: both)\n` +
    `  --extension <dir>   Unpacked extension (default: dist/chrome)\n` +
    `  --chrome <path>     Chrome/Chromium executable (or set CHROME)\n` +
    `  --settle-ms <n>     Settle time after load/reload (default: 8000)\n` +
    `  --no-warmup         Measure first load instead of reloading once first\n` +
    `  --no-cc             Leave the player's CC control untouched\n` +
    `  --allow-no-video    Permit non-video pages (CC is not required there)\n` +
    `  --debug-controller  Expose controller diagnostics; use for probes, not results\n` +
    `  --fixture <path>    Install real JSON3 as a controlled active timeline\n` +
    `  --headful           Use a visible isolated window (default)\n` +
    `  --headless          Try headless mode; regular Chrome may not activate extensions\n` +
    `  --json <path>       Save raw measurements and summaries`);
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Evaluation failed');
  }
  return result.result?.value;
}

async function waitForDocument(client, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(client, 'document.readyState') === 'complete') return;
    } catch { /* navigation can destroy the previous execution context */ }
    await sleep(250);
  }
  throw new Error('Document load timed out');
}

async function navigate(client, url, settleMs) {
  const response = await client.send('Page.navigate', { url });
  if (response.errorText) throw new Error(response.errorText);
  await waitForDocument(client);
  await sleep(settleMs);
}

async function preparePlayer(client, options) {
  if (options.captions) {
    const pressed = await evaluate(client, `document.querySelector('.ytp-subtitles-button')?.getAttribute('aria-pressed') || null`);
    if (pressed === 'true') {
      // Force the player to request its signed track instead of relying on the
      // extension's live-DOM fallback or an already-rendered caption window.
      await evaluate(client, `document.querySelector('.ytp-subtitles-button').click(); true`);
      await sleep(400);
    }
    await evaluate(client, `(() => {
      const button = document.querySelector('.ytp-subtitles-button');
      if (button && button.getAttribute('aria-pressed') !== 'true') button.click();
      return button?.getAttribute('aria-pressed') || null;
    })()`);
    await sleep(options.captionSettleMs);
  }
  await evaluate(client, 'document.querySelector(\'video\')?.pause(); true');
}

function footprint(pid) {
  const output = execFileSync('/usr/bin/footprint', ['-p', String(pid), '-f', 'bytes', '--noCategories'], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  return {
    current: Number(output.match(/Footprint:\s*(\d+) B/)?.[1]),
    peak: Number(output.match(/phys_footprint_peak:\s*(\d+) B/)?.[1]),
  };
}

async function rendererPid(browserClient, pageClient) {
  const before = await browserClient.send('SystemInfo.getProcessInfo');
  await evaluate(pageClient, '(() => { const end = performance.now() + 400; while (performance.now() < end) {} return true; })()');
  const after = await browserClient.send('SystemInfo.getProcessInfo');
  const previous = new Map(before.processInfo.map((process) => [process.id, process.cpuTime]));
  const candidates = after.processInfo
    // A PID absent from the first snapshot may be a different newly-created
    // renderer; treating its cumulative CPU time as a delta can misattribute it.
    .filter((process) => process.type === 'renderer' && previous.has(process.id))
    .map((process) => ({ id: process.id, cpuDelta: process.cpuTime - previous.get(process.id) }))
    .sort((a, b) => b.cpuDelta - a.cpuDelta);
  const expected = candidates.filter((process) => process.cpuDelta >= 0.25 && process.cpuDelta <= 0.55);
  if (expected.length !== 1) {
    throw new Error(`Ambiguous target renderer after controlled 400 ms spin: ${JSON.stringify(candidates)}`);
  }
  return {
    pid: expected[0].id,
    rendererCount: candidates.length,
    cpuDelta: expected[0].cpuDelta,
  };
}

async function launchAndMeasure(options, mode, run) {
  const profile = fs.mkdtempSync(path.join(ROOT, '.context', 'chrome-memory-'));
  const enabled = mode === 'on';
  const args = [
    options.headless ? '--headless=new' : '--start-maximized',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-features=Translate,MediaRouter',
    '--mute-audio',
    '--window-size=1280,800',
  ];
  if (enabled) {
    // Chrome 137+ ignores --load-extension without this opt-in. The remote-debugging
    // endpoint and this flag exist only in the disposable profile launched above.
    args.push('--enable-unsafe-extension-debugging');
  }
  args.push('about:blank');
  const chrome = spawn(options.chrome, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  chrome.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-20000); });
  let browserClient;
  let pageClient;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    const deadline = Date.now() + 20000;
    while (!fs.existsSync(portFile)) {
      if (chrome.exitCode !== null) throw new Error(`Chrome exited during startup:\n${stderr}`);
      if (Date.now() > deadline) throw new Error(`DevToolsActivePort was not created:\n${stderr}`);
      await sleep(100);
    }
    const [port, browserPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
    browserClient = await CDP.open(`ws://127.0.0.1:${port}${browserPath}`);
    if (enabled) await browserClient.send('Extensions.loadUnpacked', { path: options.extension });
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((target) => target.type === 'page');
    if (!page) throw new Error('No page target in isolated Chrome');
    pageClient = await CDP.open(page.webSocketDebuggerUrl);
    await pageClient.send('Page.enable');
    await pageClient.send('Runtime.enable');
    await pageClient.send('Performance.enable');
    await pageClient.send('HeapProfiler.enable');
    if (options.debugController) {
      await pageClient.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `(() => {
          let namespace;
          Object.defineProperty(window, 'YTSC', {
            configurable: true,
            get() { return namespace; },
            set(value) {
              const Controller = value?.StableCaptionsController;
              const start = Controller?.prototype?.start;
              if (start && !start.__ytscMemoryWrapped) {
                const wrapped = new Proxy(start, {
                  apply(target, instance, args) {
                    window.__ytscController = instance;
                    return Reflect.apply(target, instance, args);
                  },
                });
                Object.defineProperty(wrapped, '__ytscMemoryWrapped', { value: true });
                Controller.prototype.start = wrapped;
              }
              namespace = value;
            },
          });
        })();`,
      });
    }
    await navigate(pageClient, options.url, options.settleMs);
    await preparePlayer(pageClient, options);
    if (options.warmup) {
      await navigate(pageClient, options.url, options.settleMs);
      await preparePlayer(pageClient, options);
    }
    if (options.fixture && enabled) {
      const body = fs.readFileSync(options.fixture, 'utf8');
      const payload = JSON.parse(body);
      const installed = await evaluate(pageClient, `(() => {
        const controller = window.__ytscController;
        if (!controller) throw new Error('No Stable Captions controller for fixture installation');
        const url = 'https://www.youtube.com/api/timedtext?v=' + encodeURIComponent(controller.currentVideoId()) + '&lang=en&fmt=json3';
        if (!controller.useTimeline(${JSON.stringify(payload)}, url, 'controlled memory fixture', 'tap')) {
          throw new Error('Fixture produced no timeline');
        }
        const entry = { url, body: ${JSON.stringify(body)}, videoId: controller.currentVideoId(), lang: 'en', at: Date.now() };
        window.__ytscTimedtext = entry;
        controller.rememberTap(entry);
        return { mode: controller.mode, words: controller.words.length, cues: controller.cues.length };
      })()`);
      if (installed.mode !== 'timeline' || !installed.words) throw new Error(`Fixture installation failed: ${JSON.stringify(installed)}`);
      await sleep(1000);
    }

    for (let index = 0; index < 3; index++) {
      await pageClient.send('HeapProfiler.collectGarbage');
      await sleep(150);
    }
    const state = await evaluate(pageClient, `(() => {
      const video = document.querySelector('video');
      return {
        href: location.href,
        title: document.title,
        ytsc: Boolean(window.YTSC),
        started: Boolean(window.YTSC_STARTED),
        overlay: Boolean(document.getElementById('ytsc-overlay')),
        tapChars: window.__ytscTimedtext?.body?.length || 0,
        style: document.documentElement.dataset.ytscStyle || null,
        ccPressed: document.querySelector('.ytp-subtitles-button')?.getAttribute('aria-pressed') || null,
        videoPaused: video?.paused ?? null,
        videoReadyState: video?.readyState ?? null,
        controller: window.__ytscController ? {
          mode: window.__ytscController.mode,
          source: window.__ytscController.source,
          videoId: window.__ytscController.videoId,
          words: window.__ytscController.words.length,
          cues: window.__ytscController.cues.length,
          taps: window.__ytscController.taps.length,
          cacheCharLimit: window.__ytscController.tapCacheCharLimit,
          cachedTapChars: window.__ytscController.taps.reduce((sum, tap) => sum + tap.body.length, 0),
        } : null,
      };
    })()`);
    if (enabled && (!state.ytsc || !state.started)) {
      throw new Error(`Stable Captions did not activate${options.headless ? ' in headless Chrome; retry with --headful' : ''}: ${JSON.stringify(state)}`);
    }
    if (!enabled && state.ytsc) throw new Error('Extension state leaked into the extension-off profile');
    if (!options.allowNoVideo && (state.videoPaused !== true || state.videoReadyState < 2)) {
      throw new Error(`No loaded, paused video ready for measurement: ${JSON.stringify(state)}`);
    }
    if (options.captions && !options.allowNoVideo && state.ccPressed !== 'true') {
      throw new Error(`Native CC was not enabled for the controlled comparison: ${JSON.stringify(state)}`);
    }
    if (options.fixture && enabled) {
      const controller = state.controller;
      const fixtureChars = fs.readFileSync(options.fixture, 'utf8').length;
      const expectedCachedChars = fixtureChars <= controller?.cacheCharLimit ? fixtureChars : 0;
      if (controller?.mode !== 'timeline' || !controller.words || !controller.cues ||
          controller.cachedTapChars !== expectedCachedChars || state.tapChars !== expectedCachedChars) {
        throw new Error(`Controlled timeline precondition failed: ${JSON.stringify(state)}`);
      }
    }

    const performance = await pageClient.send('Performance.getMetrics');
    const metrics = Object.fromEntries(performance.metrics.map((metric) => [metric.name, metric.value]));
    const renderer = await rendererPid(browserClient, pageClient);
    const memory = footprint(renderer.pid);
    return {
      mode,
      run,
      state,
      jsHeapUsed: metrics.JSHeapUsedSize,
      jsHeapTotal: metrics.JSHeapTotalSize,
      documents: metrics.Documents,
      nodes: metrics.Nodes,
      jsEventListeners: metrics.JSEventListeners,
      renderer,
      footprint: memory,
    };
  } finally {
    try { if (pageClient) await pageClient.send('Page.stopLoading'); } catch { /* already closing */ }
    pageClient?.close();
    try { if (browserClient) await browserClient.send('Browser.close', {}, 5000); } catch { /* already closed */ }
    browserClient?.close();
    if (chrome.exitCode === null) {
      await Promise.race([
        new Promise((resolve) => chrome.once('exit', resolve)),
        sleep(5000).then(() => { if (chrome.exitCode === null) chrome.kill('SIGTERM'); }),
      ]);
    }
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarize(samples) {
  const summary = { runs: samples.length };
  for (const [name, select] of Object.entries({
    jsHeapUsed: (sample) => sample.jsHeapUsed,
    jsHeapTotal: (sample) => sample.jsHeapTotal,
    footprint: (sample) => sample.footprint.current,
    footprintPeak: (sample) => sample.footprint.peak,
    nodes: (sample) => sample.nodes,
    jsEventListeners: (sample) => sample.jsEventListeners,
  })) {
    const values = samples.map(select).filter(Number.isFinite);
    summary[name] = {
      median: median(values),
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }
  summary.states = samples.map((sample) => sample.state);
  return summary;
}

function mib(value) {
  return Number.isFinite(value) ? (value / 1024 / 1024).toFixed(2) : '—';
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return printHelp();
  if (!Number.isInteger(options.runs) || options.runs < 1) throw new Error('--runs must be positive');
  if (!['off', 'on', 'both'].includes(options.mode)) throw new Error('--mode must be off, on, or both');
  if (!fs.existsSync(options.chrome)) throw new Error(`Chrome not found: ${options.chrome}`);
  fs.mkdirSync(path.join(ROOT, '.context'), { recursive: true });

  const modes = options.mode === 'both' ? ['off', 'on'] : [options.mode];
  const report = {
    createdAt: new Date().toISOString(),
    url: options.url,
    headless: options.headless,
    warmup: options.warmup,
    controlledFixture: options.fixture,
    settleMs: options.settleMs,
    samples: [],
    summary: {},
  };
  for (let run = 0; run < options.runs; run++) {
    for (const mode of modes) {
      process.stderr.write(`[chrome-memory] run ${run + 1}/${options.runs}, extension ${mode}\n`);
      const sample = await launchAndMeasure(options, mode, run + 1);
      report.samples.push(sample);
      process.stderr.write(`[chrome-memory] heap=${mib(sample.jsHeapUsed)} MiB, renderer=${mib(sample.footprint.current)} MiB, tapChars=${sample.state.tapChars}\n`);
    }
  }
  for (const mode of modes) report.summary[mode] = summarize(report.samples.filter((sample) => sample.mode === mode));
  if (modes.length === 2) {
    report.delta = {};
    for (const key of ['jsHeapUsed', 'jsHeapTotal', 'footprint', 'footprintPeak', 'nodes', 'jsEventListeners']) {
      report.delta[key] = report.summary.on[key].median - report.summary.off[key].median;
    }
  }

  console.log(`\nChromium isolated-profile memory: ${options.url}`);
  if (options.fixture) console.log('Active timeline is installed from a controlled JSON3 fixture before measurement.');
  console.log('');
  console.log('| Extension | Runs | JS heap used MiB | Range | Renderer footprint MiB | Range | Nodes | Listeners |');
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const [mode, summary] of Object.entries(report.summary)) {
    console.log(`| ${mode} | ${summary.runs} | ${mib(summary.jsHeapUsed.median)} | ${mib(summary.jsHeapUsed.min)}–${mib(summary.jsHeapUsed.max)} | ${mib(summary.footprint.median)} | ${mib(summary.footprint.min)}–${mib(summary.footprint.max)} | ${summary.nodes.median} | ${summary.jsEventListeners.median} |`);
  }
  if (report.delta) {
    console.log(`\nOn − off medians: JS heap ${mib(report.delta.jsHeapUsed)} MiB; renderer footprint ${mib(report.delta.footprint)} MiB; peak ${mib(report.delta.footprintPeak)} MiB.`);
    console.log('Renderer footprint includes page/media/DOM variance; the paired JS heap is the more direct extension metric.');
  }
  if (options.json) {
    fs.mkdirSync(path.dirname(options.json), { recursive: true });
    fs.writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Saved ${path.relative(ROOT, options.json)}`);
  }
}

main().catch((error) => {
  console.error(`[chrome-memory] ${error.stack || error.message}`);
  process.exitCode = 1;
});
