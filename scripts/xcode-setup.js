// Applies the project settings the Safari converter doesn't set, so a regenerated
// project is ready to archive. Run by `npm run safari:xcode` after the converter; safe to
// run again. Optional: DEVELOPMENT_TEAM=XXXXXXXXXX sets the signing team on both targets.
const fs = require('fs');
const path = require('path');

const MIN_MACOS = '14.0';
const CATEGORY = 'public.app-category.utilities';
const COPYRIGHT = '© 2026 Thien Hung Le';
const BUNDLE_ID = 'fun.thien.stablecaptions'; // keep in sync with safari:xcode in package.json

const root = path.join(__dirname, '..');
const projectDir = process.argv[2] || path.join(root, 'safari', 'Stable Captions');
const xcodeproj = fs.readdirSync(projectDir).find((n) => n.endsWith('.xcodeproj'));
if (!xcodeproj) throw new Error(`No .xcodeproj in ${projectDir}`);
// Xcode 27 writes the text-based project.xcproj; older converters wrote project.pbxproj.
const projectFile = ['project.xcproj', 'project.pbxproj']
  .map((n) => path.join(projectDir, xcodeproj, n))
  .find((p) => fs.existsSync(p));
if (!projectFile) throw new Error(`No project.xcproj or project.pbxproj in ${xcodeproj}`);
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const team = process.env.DEVELOPMENT_TEAM;

// Settings for one target's configuration. Xcode 27's converter names the app
// fun.thien.Stable-Captions, which doesn't prefix the extension's ID, so both are set.
function targetSettings(set, isApp) {
  if (team) set('DEVELOPMENT_TEAM', team);
  set('PRODUCT_BUNDLE_IDENTIFIER', isApp ? BUNDLE_ID : `${BUNDLE_ID}.Extension`);
  if (isApp) {
    set('INFOPLIST_KEY_LSApplicationCategoryType', CATEGORY);
    set('INFOPLIST_KEY_NSHumanReadableCopyright', COPYRIGHT);
  }
}

const formats = {
  'project.pbxproj': {
    deploymentTarget: [/MACOSX_DEPLOYMENT_TARGET = [\d.]+;/g, `MACOSX_DEPLOYMENT_TARGET = ${MIN_MACOS};`],
    marketingVersion: [/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`],
    block: /buildSettings = \{\n([\s\S]*?)\n(\t+)\};/g,
    wrap: (body, indent) => `buildSettings = {\n${body}\n${indent}};`,
    pad: (indent) => indent + '\t',
    line: (key, value) => `${key} = ${/^[\w.]+$/.test(value) ? value : JSON.stringify(value)};`,
    existing: (key) => new RegExp(`^\\t+${key} = .*;$`, 'm'),
  },
  'project.xcproj': {
    deploymentTarget: [/"MACOSX_DEPLOYMENT_TARGET": "[^"]*"/g, `"MACOSX_DEPLOYMENT_TARGET": "${MIN_MACOS}"`],
    marketingVersion: [/"MARKETING_VERSION": "[^"]*"/g, `"MARKETING_VERSION": "${version}"`],
    block: /"build-settings": \{\n([\s\S]*?)\n( +)\}/g,
    wrap: (body, indent) => `"build-settings": {\n${body}\n${indent}}`,
    pad: (indent) => indent + '  ',
    line: (key, value) => `"${key}": ${JSON.stringify(value)},`,
    existing: (key) => new RegExp(`^ +"${key}": .*,$`, 'm'),
  },
};
const fmt = formats[path.basename(projectFile)];

let project = fs.readFileSync(projectFile, 'utf8');
// Covers the project level too, so the app (which inherits it in Xcode 27) gets it.
project = project.replace(...fmt.deploymentTarget);
project = project.replace(...fmt.marketingVersion);

// Per-target settings live in each target's (or configuration's) build settings block.
project = project.replace(fmt.block, (block, body, indent) => {
  if (!body.includes('PRODUCT_BUNDLE_IDENTIFIER')) return block; // project-level settings
  const pad = fmt.pad(indent);
  const set = (key, value) => {
    const line = pad + fmt.line(key, value);
    const re = fmt.existing(key);
    body = re.test(body) ? body.replace(re, line) : `${body}\n${line}`;
  };
  targetSettings(set, body.includes('INFOPLIST_KEY_NSPrincipalClass')); // only the app has it
  return fmt.wrap(body, indent);
});
fs.writeFileSync(projectFile, project);

// No build setting exists for the export-compliance key, so it goes in the app's
// Info.plist (merged with the generated one). Saves answering the question per build.
const appName = xcodeproj.replace(/\.xcodeproj$/, '');
const plistPath = path.join(projectDir, appName, 'Info.plist');
let plist = fs.readFileSync(plistPath, 'utf8');
const ensure = (key, value) => {
  if (plist.includes(`<key>${key}</key>`)) return;
  plist = plist.replace(/<dict>\n/, `<dict>\n\t<key>${key}</key>\n\t${value}\n`);
};
ensure('LSApplicationCategoryType', `<string>${CATEGORY}</string>`);
ensure('ITSAppUsesNonExemptEncryption', '<false/>');
fs.writeFileSync(plistPath, plist);

console.log(`${xcodeproj} (${path.basename(projectFile)}): ${BUNDLE_ID}, macOS ${MIN_MACOS}+, version ${version}, category Utilities, ` +
  `no non-exempt encryption${team ? `, team ${team}` : ' (no DEVELOPMENT_TEAM given)'}`);
