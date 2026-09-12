/**
 * patch-android.mjs — adds the permissions the plugins need to the generated
 * Android project.
 *
 * The `android/` folder is not kept in the repository; `npx cap add android`
 * creates it fresh on every build, so anything that has to live in the app's
 * own AndroidManifest has to be put back afterwards. Run this after
 * `cap add android` and before `cap sync android`.
 *
 * The speech plugin ships RECORD_AUDIO in its own manifest and the merger
 * picks that up, but the barcode plugin's manifest is empty, so CAMERA has to
 * be declared here or the scanner is refused at runtime with no explanation.
 *
 * Safe to run twice: a permission that is already present is left alone.
 */
import { readFile, writeFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(here, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

const PERMISSIONS = [
  'android.permission.CAMERA',
  'android.permission.RECORD_AUDIO'
];

// Android 11 and up hide other apps unless they are asked for by name. The
// speech recogniser lives in another app, so the query has to be declared.
const QUERIES = `    <queries>
        <intent>
            <action android:name="android.speech.RecognitionService" />
        </intent>
    </queries>
`;

try {
  await access(manifestPath);
} catch {
  console.error('No AndroidManifest.xml at ' + manifestPath);
  console.error('Run "npx cap add android" first.');
  process.exit(1);
}

let xml = await readFile(manifestPath, 'utf8');
const before = xml;
const added = [];

for (const permission of PERMISSIONS) {
  if (xml.includes(`"${permission}"`)) continue;
  xml = xml.replace(
    '</manifest>',
    `    <uses-permission android:name="${permission}" />\n</manifest>`
  );
  added.push(permission);
}

if (!xml.includes('android.speech.RecognitionService')) {
  xml = xml.replace('</manifest>', QUERIES + '</manifest>');
  added.push('queries: android.speech.RecognitionService');
}

// The camera is useful but not essential: without this the Play Store would
// hide the app from tablets that have no camera at all.
if (!xml.includes('android.hardware.camera')) {
  xml = xml.replace(
    '</manifest>',
    '    <uses-feature android:name="android.hardware.camera" android:required="false" />\n</manifest>'
  );
  added.push('uses-feature: camera (optional)');
}

if (xml === before) {
  console.log('AndroidManifest already has everything it needs.');
} else {
  await writeFile(manifestPath, xml);
  console.log('AndroidManifest updated:');
  added.forEach((a) => console.log('  + ' + a));
}
