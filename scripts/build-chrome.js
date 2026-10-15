// Stages the Chrome Web Store zip in dist/. Same files as the Firefox build,
// without the Gecko manifest key (Chrome warns about it).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const out = path.join(root, 'dist', 'chrome');
const SKIP = new Set([
  '.git', '.github', '.conductor', 'safari', '.gitignore', 'dist', 'node_modules',
  '_site', 'test', 'playground', 'design', 'docs', 'scripts', 'package.json', 'README.md',
]);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const name of fs.readdirSync(root)) {
  if (SKIP.has(name) || name.startsWith('.')) continue;
  fs.cpSync(path.join(root, name), path.join(out, name), {
    recursive: true,
    filter: (src) => path.basename(src) !== '.DS_Store',
  });
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
delete manifest.browser_specific_settings;
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const zip = path.join(root, 'dist', `stable-captions-chrome-${manifest.version}.zip`);
fs.rmSync(zip, { force: true });
execFileSync('zip', ['-qr', '-X', zip, '.'], { cwd: out });
console.log(`Staged ${path.relative(root, out)}/ and ${path.relative(root, zip)}`);
