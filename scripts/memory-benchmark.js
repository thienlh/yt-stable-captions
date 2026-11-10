#!/usr/bin/env node
// Reproducible retained-memory ledger for the real parser/chunker/controller.
// Node reports JS heap after explicit GC. JavaScriptCore reports process footprint
// (current and peak), which is useful for Safari-engine comparisons without claiming
// to include WebKit DOM, compositing, or other Safari-process memory.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DRIVER = path.join(__dirname, 'memory-jsc-driver.js');
const DEFAULT_JSC = '/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc';
const SCENARIOS = [
  'empty', 'code', 'raw', 'payload', 'words', 'timeline-no-clean',
  'timeline', 'released', 'cleared', 'cache8',
];

function parseArgs(argv) {
  const options = { root: ROOT, runs: 5, scale: 1, engines: ['node', 'jsc'], scenarios: SCENARIOS, jscArgs: [] };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--child') options.child = true;
    else if (arg === '--fixture') options.fixture = path.resolve(argv[++index]);
    else if (arg === '--scenario') options.scenarios = [argv[++index]];
    else if (arg === '--scale') options.scale = Number(argv[++index]);
    else if (arg === '--runs') options.runs = Number(argv[++index]);
    else if (arg === '--engines') options.engines = argv[++index].split(',');
    else if (arg === '--jsc') options.jsc = argv[++index];
    else if (arg === '--jsc-arg') options.jscArgs.push(argv[++index]);
    else if (arg === '--source-root') options.root = path.resolve(argv[++index]);
    else if (arg === '--json') options.json = path.resolve(argv[++index]);
    else if (arg === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function runNodeChild(options) {
  globalThis.arguments = [options.root, options.fixture, options.scenarios[0], String(options.scale)];
  globalThis.load = (file) => vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
  globalThis.readFile = (file) => fs.readFileSync(file, 'utf8');
  globalThis.print = (line) => process.stdout.write(`${line}\n`);
  vm.runInThisContext(fs.readFileSync(DRIVER, 'utf8'), { filename: DRIVER });
  for (let index = 0; index < 3; index++) globalThis.gc();
  const memory = process.memoryUsage();
  process.stdout.write(`__MEMORY__${JSON.stringify(memory)}\n`);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarize(samples) {
  const currents = samples.map((sample) => sample.current);
  const peaks = samples.map((sample) => sample.peak).filter(Number.isFinite);
  return {
    current: median(currents),
    currentMin: Math.min(...currents),
    currentMax: Math.max(...currents),
    peak: peaks.length ? median(peaks) : null,
    metadata: samples[samples.length - 1].metadata,
    samples,
  };
}

function runNode(options) {
  const samples = [];
  for (let run = 0; run < options.runs; run++) {
    const result = spawnSync(process.execPath, [
      '--expose-gc', __filename, '--child', '--fixture', options.fixture,
      '--source-root', options.root, '--scenario', options.scenarios[0], '--scale', String(options.scale),
    ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`Node child failed:\n${result.stdout}\n${result.stderr}`);
    const memoryMatch = result.stdout.match(/^__MEMORY__(.*)$/m);
    const metadataLine = result.stdout.split('\n').find((line) => line.startsWith('{'));
    if (!memoryMatch || !metadataLine) throw new Error(`Could not parse Node output:\n${result.stdout}`);
    const memory = JSON.parse(memoryMatch[1]);
    samples.push({ current: memory.heapUsed, rss: memory.rss, metadata: JSON.parse(metadataLine) });
  }
  return summarize(samples);
}

function runJsc(options) {
  const executable = options.jsc || process.env.JSC || DEFAULT_JSC;
  const samples = [];
  for (let run = 0; run < options.runs; run++) {
    const result = spawnSync(executable, [
      ...options.jscArgs, '--footprint', DRIVER, '--', options.root, options.fixture,
      options.scenarios[0], String(options.scale),
    ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`JavaScriptCore failed:\n${result.stdout}\n${result.stderr}`);
    const output = `${result.stdout}\n${result.stderr}`;
    const current = Number(output.match(/Current Footprint:\s*(\d+)/)?.[1]);
    const peak = Number(output.match(/Peak Footprint:\s*(\d+)/)?.[1]);
    const metadataLine = result.stdout.split('\n').find((line) => line.startsWith('{'));
    if (!current || !metadataLine) throw new Error(`Could not parse JavaScriptCore output:\n${output}`);
    samples.push({ current, peak, metadata: JSON.parse(metadataLine) });
  }
  return summarize(samples);
}

function mib(bytes) {
  return bytes === null ? '—' : (bytes / 1024 / 1024).toFixed(2);
}

function printHelp() {
  console.log(`Usage: node --expose-gc scripts/memory-benchmark.js --fixture <caption.json3> [options]\n\n` +
    `Options:\n` +
    `  --scenario <name>   Run one scenario (default: all; use "scaled" with --scale N)\n` +
    `  --scale <n>         Repeat the fixture timeline N times for the scaled scenario\n` +
    `  --runs <n>          Fresh processes per scenario (default: 5)\n` +
    `  --engines node,jsc  Engines to measure (default: both)\n` +
    `  --jsc <path>        JavaScriptCore binary override (or set JSC)\n` +
    `  --jsc-arg <option>  Pass an engine option; repeat for multiple options\n` +
    `  --source-root <dir> Load extension sources from another checkout/archive\n` +
    `  --json <path>       Save raw samples and summaries as JSON\n\n` +
    `Scenarios: ${SCENARIOS.join(', ')}, scaled\n` +
    `Node current = heapUsed after GC; JSC current/peak = process phys_footprint.\n` +
    `JSC excludes Safari DOM/GPU/network-process costs.`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return printHelp();
  if (options.child) return runNodeChild(options);
  if (!options.fixture) throw new Error('--fixture is required');
  if (!Number.isInteger(options.runs) || options.runs < 1) throw new Error('--runs must be a positive integer');
  if (!Number.isInteger(options.scale) || options.scale < 1) throw new Error('--scale must be a positive integer');

  const report = {
    createdAt: new Date().toISOString(),
    fixture: options.fixture,
    sourceRoot: options.root,
    fixtureBytes: fs.statSync(options.fixture).size,
    runs: options.runs,
    scale: options.scale,
    engines: {},
  };
  for (const engine of options.engines) {
    report.engines[engine] = {};
    for (const scenario of options.scenarios) {
      const scoped = { ...options, scenarios: [scenario] };
      process.stderr.write(`[memory] ${engine} ${scenario} (${options.runs} runs)\n`);
      report.engines[engine][scenario] = engine === 'node' ? runNode(scoped) : runJsc(scoped);
    }
  }

  for (const [engine, scenarios] of Object.entries(report.engines)) {
    const baseline = scenarios.empty?.current || 0;
    console.log(`\n${engine === 'node' ? 'Node / V8 retained heap' : 'JavaScriptCore process footprint'}\n`);
    console.log('| Scenario | Current MiB | Range | Δ empty MiB | Peak MiB | Words | Cues | Extra word objects | Cached bodies |');
    console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const [scenario, result] of Object.entries(scenarios)) {
      const range = `${mib(result.currentMin)}–${mib(result.currentMax)}`;
      const metadata = result.metadata || {};
      console.log(`| ${scenario} | ${mib(result.current)} | ${range} | ${mib(result.current - baseline)} | ${mib(result.peak)} | ${metadata.words ?? 0} | ${metadata.cues ?? 0} | ${metadata.additionalWordObjects ?? 0} | ${metadata.tapEntries ?? 0} |`);
    }
  }
  if (options.json) {
    fs.mkdirSync(path.dirname(options.json), { recursive: true });
    fs.writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nSaved ${path.relative(ROOT, options.json)}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`[memory] ${error.message}`);
  process.exitCode = 1;
}
