/**
 * sync-web.mjs — stages ../frontend into ./www for the Android build.
 *
 * The APK ships the real web app, unchanged. The only thing this script
 * rewrites is the API URL, so the packaged app points at your Apps Script
 * deployment without that URL having to sit in the repository.
 *
 *   RETURN_DESK_API_URL=https://script.google.com/.../exec npm run sync
 *
 * With no environment variable set, whatever is already in
 * frontend/js/config.js is used as-is.
 */
import { cp, rm, readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const target = resolve(root, 'www');

// The files that make up the web app. An allow-list rather than a plain copy,
// because when this project sits inside a GitHub Pages repository the web app
// is at the repository root, alongside node_modules and the Android project.
const WEB_ENTRIES = [
  'index.html', 'app.html', 'manifest.webmanifest', 'sw.js', '.nojekyll',
  'css', 'js', 'assets'
];

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

/**
 * Two layouts are supported:
 *   return-desk/frontend + return-desk/mobile   (the full package)
 *   repo-root (web app at the root) + repo-root/mobile   (a Pages repository)
 */
async function findSource() {
  const packaged = resolve(root, '..', 'frontend');
  if (await exists(resolve(packaged, 'index.html'))) return packaged;

  const repoRoot = resolve(root, '..');
  if (await exists(resolve(repoRoot, 'index.html'))) return repoRoot;

  return null;
}

const source = await findSource();
if (!source) {
  console.error('Cannot find the web app.');
  console.error('Expected either a frontend/ folder beside this one, or index.html');
  console.error('in the parent folder if the web app sits at the repository root.');
  process.exit(1);
}
console.log('Web app found at ' + source);

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });

let copied = 0;
for (const entry of WEB_ENTRIES) {
  const from = resolve(source, entry);
  if (!(await exists(from))) continue;
  await cp(from, resolve(target, entry), { recursive: true });
  copied++;
}
console.log('Copied ' + copied + ' entries into www/');

const apiUrl = process.env.RETURN_DESK_API_URL;
const configPath = resolve(target, 'js', 'config.js');
let config = await readFile(configPath, 'utf8');

if (apiUrl) {
  config = config.replace(/API_URL:\s*'[^']*'/, "API_URL: '" + apiUrl + "'");
  await writeFile(configPath, config);
  console.log('API URL set to ' + apiUrl);
} else if (config.includes('PASTE_YOUR')) {
  console.warn('');
  console.warn('  Warning: js/config.js still holds the placeholder API URL.');
  console.warn('  The built app will not be able to reach the backend.');
  console.warn('  Set RETURN_DESK_API_URL, or edit frontend/js/config.js first.');
  console.warn('');
} else {
  console.log('Using the API URL already present in config.js');
}

// The service worker is useful on the web and harmless here, but an installed
// APK already has its assets locally, so the cache only adds a second copy.
const swPath = resolve(target, 'js', 'pwa.js');
if (await exists(swPath)) {
  let pwa = await readFile(swPath, 'utf8');
  pwa = pwa.replace(
    "if ('serviceWorker' in navigator && location.protocol !== 'file:') {",
    "if ('serviceWorker' in navigator && location.protocol !== 'file:' && !window.Capacitor) {"
  );
  await writeFile(swPath, pwa);
  console.log('Service worker disabled inside the native shell');
}

console.log('Ready. Next: npx cap sync android');
