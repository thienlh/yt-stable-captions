/**
 * Publishes docs/stable-captions.md as the only page on the site.
 * Usage: node scripts/build-site.js
 */
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const root = path.join(__dirname, '..');
const markdown = fs.readFileSync(path.join(root, 'docs/stable-captions.md'), 'utf8');
const body = marked.parse(markdown, { gfm: true });

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stable Captions</title>
<meta name="description" content="Short, stable captions for YouTube. Each chunk appears whole and stays put.">
<style>
  :root {
    --bg: #fbfaf8;
    --ink: #1c1c20;
    --dim: #6e6f78;
    --line: #e7e6e2;
    --accent: #4f6fb4;
    --code: #f1f0ec;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #17181d;
      --ink: #e8e8ee;
      --dim: #9293a0;
      --line: #2c2d36;
      --accent: #9bb6e8;
      --code: #26272f;
    }
  }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font: 19px/1.55 "Iowan Old Style", Palatino, Georgia, serif;
  }
  main {
    max-width: 38rem;
    margin: 0 auto;
    padding: 4.5rem 1.5rem 6rem;
  }
  h1 {
    font-weight: 400;
    font-size: 2.75rem;
    line-height: 1.1;
    letter-spacing: -0.02em;
    margin: 0 0 1rem;
  }
  h2 {
    font: 600 0.75rem/1.2 ui-sans-serif, system-ui, sans-serif;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--dim);
    margin: 2.75rem 0 0.85rem;
  }
  p { margin: 0 0 1rem; }
  a { color: var(--accent); }
  ul { margin: 0 0 1rem; padding-left: 1.2rem; }
  li { margin: 0.35rem 0; }
  li p { margin: 0; }
  code {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.85em;
    background: var(--code);
    padding: 0.1em 0.35em;
    border-radius: 4px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font: 15px/1.4 ui-sans-serif, system-ui, sans-serif;
    margin: 0.5rem 0 1rem;
  }
  th, td {
    text-align: left;
    padding: 0.45rem 0.75rem 0.45rem 0;
    border-bottom: 1px solid var(--line);
    vertical-align: baseline;
  }
  th { color: var(--dim); font-weight: 600; }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;

const out = path.join(root, '_site');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, 'CNAME'), 'stable.monster\n');
