/**
 * Publishes site/index.html as stable.monster.
 * Usage: node scripts/build-site.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, '_site');

const fonts = [
  'InstrumentSerif-Regular-latin.woff2',
  'InstrumentSerif-Italic-latin.woff2',
  'PaperMono-Regular-latin.woff2',
  'PaperMono-Medium-latin.woff2',
  'InterVariable.woff2',
  'InstrumentSerif-LICENSE.txt',
  'PaperMono-LICENSE.txt',
  'Inter-LICENSE.txt',
];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
fs.copyFileSync(path.join(root, 'site/index.html'), path.join(out, 'index.html'));
fs.copyFileSync(path.join(root, 'site/backdrop.js'), path.join(out, 'backdrop.js'));
fs.copyFileSync(path.join(root, 'site/demo.js'), path.join(out, 'demo.js'));
fs.copyFileSync(path.join(root, 'icons/icon-256.png'), path.join(out, 'icon.png'));
for (const file of ['paper-shaders.js', 'paper-shaders.LICENSE', 'paper-shaders.NOTICE']) {
  fs.copyFileSync(path.join(root, 'src/vendor', file), path.join(out, file));
}
for (const file of fonts) {
  fs.copyFileSync(path.join(root, 'fonts', file), path.join(out, 'fonts', file));
}
fs.writeFileSync(path.join(out, 'CNAME'), 'stable.monster\n');
