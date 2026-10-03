// Stages the Safari build in dist/safari (input for safari-web-extension-converter)
// and zips it (input for App Store Connect's packager). The only difference from the
// Chrome/Firefox build: the toolbar uses the monochrome glyph, which Safari renders as
// a template image (grey, or the accent colour when the extension can run on the tab).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const out = path.join(root, 'dist', 'safari');
const SKIP = new Set(['.git', 'safari', '.gitignore', 'dist', 'node_modules', 'test', 'playground', 'design', 'docs', 'scripts', 'package.json', 'README.md']);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const name of fs.readdirSync(root)) {
  if (SKIP.has(name)) continue;
  fs.cpSync(path.join(root, name), path.join(out, name), {
    recursive: true,
    filter: (src) => path.basename(src) !== '.DS_Store',
  });
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
manifest.action.default_icon = {
  16: 'icons/toolbar-16.png',
  19: 'icons/toolbar-19.png',
  32: 'icons/toolbar-32.png',
  38: 'icons/toolbar-38.png',
  48: 'icons/toolbar-48.png',
};
delete manifest.browser_specific_settings; // Gecko-only
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const zip = path.join(root, 'dist', `stable-captions-safari-${manifest.version}.zip`);
fs.rmSync(zip, { force: true });
execFileSync('zip', ['-qr', '-X', zip, '.'], { cwd: out });
console.log(`Staged ${path.relative(root, out)}/ and ${path.relative(root, zip)}`);
