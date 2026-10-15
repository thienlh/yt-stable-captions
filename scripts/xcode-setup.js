// Applies the project settings the Safari converter doesn't set, so a regenerated
// project is ready to archive. Run by `npm run safari:xcode` after the converter; safe to
// run again. Optional: DEVELOPMENT_TEAM=XXXXXXXXXX sets the signing team on both targets.
const fs = require('fs');
const path = require('path');

const MIN_MACOS = '14.0';
const CATEGORY = 'public.app-category.utilities';
const COPYRIGHT = '© 2026 Thien Hung Le';

const root = path.join(__dirname, '..');
const projectDir = process.argv[2] || path.join(root, 'safari', 'Stable Captions');
const xcodeproj = fs.readdirSync(projectDir).find((n) => n.endsWith('.xcodeproj'));
if (!xcodeproj) throw new Error(`No .xcodeproj in ${projectDir}`);
const pbxPath = path.join(projectDir, xcodeproj, 'project.pbxproj');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const team = process.env.DEVELOPMENT_TEAM;

let pbx = fs.readFileSync(pbxPath, 'utf8');
pbx = pbx.replace(/MACOSX_DEPLOYMENT_TARGET = [\d.]+;/g, `MACOSX_DEPLOYMENT_TARGET = ${MIN_MACOS};`);
pbx = pbx.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`);

// Per-target settings live in each configuration's buildSettings block.
pbx = pbx.replace(/buildSettings = \{\n([\s\S]*?)\n(\t+)\};/g, (block, body, indent) => {
  if (!body.includes('PRODUCT_BUNDLE_IDENTIFIER')) return block; // project-level config
  const pad = indent + '\t';
  const set = (key, value) => {
    const line = `${pad}${key} = ${value};`;
    const re = new RegExp(`^\\t+${key} = .*;$`, 'm');
    body = re.test(body) ? body.replace(re, line) : `${body}\n${line}`;
  };
  if (team) set('DEVELOPMENT_TEAM', team);
  if (body.includes('INFOPLIST_KEY_NSPrincipalClass')) { // the app, not the extension
    set('INFOPLIST_KEY_LSApplicationCategoryType', `"${CATEGORY}"`);
    set('INFOPLIST_KEY_NSHumanReadableCopyright', `"${COPYRIGHT}"`);
  }
  return `buildSettings = {\n${body}\n${indent}};`;
});
fs.writeFileSync(pbxPath, pbx);

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

console.log(`${xcodeproj}: macOS ${MIN_MACOS}+, version ${version}, category Utilities, ` +
  `no non-exempt encryption${team ? `, team ${team}` : ' (no DEVELOPMENT_TEAM given)'}`);
