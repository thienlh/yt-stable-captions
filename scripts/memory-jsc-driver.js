// Run with JavaScriptCore's jsc binary, normally through memory-benchmark.js.
// This is a memory harness, not part of the extension build.
/* global arguments, gc, load, print, readFile */

var module = { exports: {} }; // Core files also support CommonJS under Node.
var exports = module.exports;

var args = arguments.slice();
var root = args[0];
var fixture = args[1];
var scenario = args[2] || 'timeline';
var scale = Number(args[3] || 1);
var retained = null;
globalThis.window = {};
globalThis.cancelAnimationFrame = function () {};
globalThis.clearTimeout = function () {};

function loadSources() {
  [
    'src/core/settings.js',
    'src/core/language-preference.js',
    'src/core/text-utils.js',
    'src/core/rolling-merger.js',
    'src/core/json3-parser.js',
    'src/core/cue-lookup.js',
    'src/core/chunker.js',
    'src/core/disfluency.js',
    'src/content/track-provider.js',
    'src/content/live-source.js',
    'src/content/overlay.js',
    'src/content/main.js',
  ].forEach(function (file) { load(root + '/' + file); });
}

function scaledPayload(body, factor) {
  var original = JSON.parse(body);
  if (factor === 1) return original;
  var events = original.events || [];
  var last = events.filter(function (event) { return event.segs; }).slice(-1)[0];
  var span = last ? (last.tStartMs || 0) + (last.dDurationMs || 0) + 1000 : 1000;
  var copies = [];
  for (var copy = 0; copy < factor; copy++) {
    events.forEach(function (event) {
      var clone = JSON.parse(JSON.stringify(event));
      clone.tStartMs = (clone.tStartMs || 0) + copy * span;
      copies.push(clone);
    });
  }
  var scaled = Object.assign({}, original, { events: copies });
  // Parse a fresh response so no input event/segment objects are shared with the work below.
  return JSON.parse(JSON.stringify(scaled));
}

function makeController() {
  var NS = globalThis.YTSC;
  var overlay = {
    clear: function () {},
    destroy: function () {},
    mount: function () {},
    render: function () {},
  };
  var controller = new NS.StableCaptionsController({
    provider: {},
    parser: new NS.Json3Parser(),
    chunker: new NS.CaptionChunker(),
    disfluency: new NS.Disfluency(),
    lookup: new NS.CueLookup(),
    overlay: overlay,
  });
  controller.noteLoadedCaption = function () {};
  controller.attachVideo = function () {};
  return controller;
}

function makeTimeline(body, clean) {
  var controller = makeController();
  controller.cleanEnabled = function () { return clean; };
  var payload = JSON.parse(body);
  var url = 'https://www.youtube.com/api/timedtext?v=benchmark&lang=en&fmt=json3';
  if (!controller.useTimeline(payload, url, 'memory benchmark', 'tap')) {
    throw new Error('Fixture produced no caption words');
  }
  var entry = { url: url, body: body, videoId: 'benchmark', lang: 'en', at: Date.now() };
  window.__ytscTimedtext = entry; // the real tap bridge publishes before rememberTap
  controller.rememberTap(entry);
  return controller;
}

if (scenario !== 'empty') loadSources();

var body = '';
var payload = null;
if (scenario !== 'empty' && scenario !== 'code') body = readFile(fixture);
if (scenario === 'scaled') body = JSON.stringify(scaledPayload(body, scale));

if (scenario === 'raw') {
  retained = { body: body };
} else if (scenario === 'payload') {
  retained = { payload: JSON.parse(body) };
} else if (scenario === 'words') {
  payload = JSON.parse(body);
  retained = { words: new globalThis.YTSC.Json3Parser().parseWords(payload) };
  payload = null;
} else if (scenario === 'timeline' || scenario === 'timeline-no-clean' || scenario === 'scaled') {
  retained = { controller: makeTimeline(body, scenario !== 'timeline-no-clean') };
} else if (scenario === 'released') {
  var released = makeTimeline(body, true);
  released.release('idle');
  retained = { controller: released };
} else if (scenario === 'cleared') {
  var cleared = makeTimeline(body, true);
  cleared.release('idle');
  cleared.taps = [];
  window.__ytscTimedtext = null;
  retained = { controller: cleared };
} else if (scenario === 'cache8') {
  var cached = makeController();
  for (var index = 0; index < 8; index++) {
    // Round-trip the string itself, preserving whitespace, to model eight distinct
    // network-owned strings with identical content rather than eight shared references.
    var cachedBody = JSON.parse(JSON.stringify({ body: body })).body;
    cached.rememberTap({
      url: 'https://www.youtube.com/api/timedtext?v=benchmark&lang=en&signature=' + index,
      body: cachedBody,
      videoId: 'benchmark',
      lang: 'en',
      at: Date.now() + index,
    });
  }
  cachedBody = ''; // do not retain the last offered body when every entry was evicted
  window.__ytscTimedtext = cached.taps[cached.taps.length - 1];
  retained = { controller: cached };
} else if (scenario !== 'empty' && scenario !== 'code') {
  throw new Error('Unknown scenario: ' + scenario);
}

var words = retained && retained.controller ? retained.controller.words : retained && retained.words || [];
var cues = retained && retained.controller ? retained.controller.cues : [];
var taps = retained && retained.controller ? retained.controller.taps : [];
var sharedWords = 0;
var additionalWordObjects = 0;
if (retained && retained.controller && words.length && cues.length) {
  var originalWordSet = new Set(words);
  var distinctCueWords = new Set();
  cues.forEach(function (cue) {
    cue.words.forEach(function (word) {
      if (!distinctCueWords.has(word) && originalWordSet.has(word)) sharedWords++;
      distinctCueWords.add(word);
    });
  });
  additionalWordObjects = distinctCueWords.size - sharedWords;
  originalWordSet = null;
  distinctCueWords = null;
}

body = '';
payload = null;
for (var collection = 0; collection < 5; collection++) gc();

print(JSON.stringify({
  scenario: scenario,
  scale: scale,
  sourceChars: scenario === 'empty' || scenario === 'code' ? 0 : readFile(fixture).length,
  words: words.length,
  cues: cues.length,
  sharedWords: sharedWords,
  additionalWordObjects: additionalWordObjects,
  tapEntries: taps.length,
  tapBodyBytes: taps.reduce(function (sum, entry) { return sum + entry.body.length; }, 0),
  currentCaption: cues.length ? cues[0].text : '',
}));
