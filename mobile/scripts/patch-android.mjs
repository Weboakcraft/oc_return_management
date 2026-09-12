/**
 * patch-android.mjs — puts back everything the plugins need in the generated
 * Android project.
 *
 * The `android/` folder is not kept in the repository; `npx cap add android`
 * creates it fresh on every build, so anything that has to live inside the
 * app module has to be written again afterwards. Run this after
 * `cap add android` and before `cap sync android`.
 *
 * Three things:
 *
 *   1. Permissions. The speech plugin ships RECORD_AUDIO in its own manifest
 *      and the merger picks that up, but the barcode plugin's manifest is
 *      empty, so CAMERA has to be declared here or the scanner is refused at
 *      runtime with no explanation.
 *
 *   2. Data binding. The barcode plugin asks for it, and without it the
 *      layout carrying the camera preview is not processed.
 *
 *   3. The layout itself. Capacitor and the barcode plugin each ship a
 *      bridge_layout_main.xml and only one survives the resource merge;
 *      Capacitor's has no camera preview in it. Writing a merged copy into the
 *      app module settles it, because an app resource beats every library.
 *
 *   4. Scanner speed. The plugin will not report a barcode until it has read
 *      the same value in ten separate camera frames. That is the pause people
 *      feel when they hold a parcel up. Two frames is enough to rule out a
 *      misread, so the threshold is lowered here.
 *
 * Safe to run twice: anything already in place is left alone.
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const androidDir = resolve(here, '..', 'android');
const manifestPath = resolve(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml');
const gradlePath = resolve(androidDir, 'app', 'build.gradle');
const layoutDir = resolve(androidDir, 'app', 'src', 'main', 'res', 'layout');
const layoutPath = resolve(layoutDir, 'bridge_layout_main.xml');
const scannerJavaPath = resolve(
  here, '..', 'node_modules', '@capacitor-mlkit', 'barcode-scanning', 'android', 'src', 'main',
  'java', 'io', 'capawesome', 'capacitorjs', 'plugins', 'mlkit', 'barcodescanning', 'BarcodeScanner.java'
);

/* ---------------------------------------------------------------- manifest */

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

/* ------------------------------------------------------------ build.gradle */

const DATA_BINDING = `    buildFeatures {
        dataBinding true
    }
    dataBinding {
        enabled = true
    }
`;

try {
  await access(gradlePath);
  let gradle = await readFile(gradlePath, 'utf8');
  if (gradle.includes('dataBinding')) {
    console.log('build.gradle already enables data binding.');
  } else {
    const anchor = gradle.match(/^android\s*\{[^\n]*\n/m);
    if (!anchor) {
      console.error('Could not find the android { } block in app/build.gradle.');
      process.exit(1);
    }
    gradle = gradle.replace(anchor[0], anchor[0] + DATA_BINDING);
    await writeFile(gradlePath, gradle);
    console.log('build.gradle updated:');
    console.log('  + data binding enabled (needed by the barcode scanner)');
  }
} catch (e) {
  console.error('Could not patch app/build.gradle: ' + e.message);
  process.exit(1);
}

/* -------------------------------------------------------------- the layout */

/*
 * Without this the scanner starts and then dies on its first frame with
 *   "…PreviewView.setScaleType(…) on a null object reference"
 * because the view it looks up by id was never inflated. The camera preview
 * goes underneath and Capacitor's own WebView subclass on top of it, so the
 * keyboard and inset handling stay intact.
 */
const LAYOUT = `<?xml version="1.0" encoding="utf-8"?>
<!-- Written by mobile/scripts/patch-android.mjs. The camera preview sits
     behind the WebView; the barcode scanner looks for preview_view by id. -->
<androidx.coordinatorlayout.widget.CoordinatorLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    tools:context="com.getcapacitor.BridgeActivity">

    <androidx.camera.view.PreviewView
        android:id="@+id/preview_view"
        android:layout_width="match_parent"
        android:layout_height="match_parent" />

    <com.getcapacitor.CapacitorWebView
        android:id="@+id/webview"
        android:layout_width="match_parent"
        android:layout_height="match_parent" />

</androidx.coordinatorlayout.widget.CoordinatorLayout>
`;

await mkdir(layoutDir, { recursive: true });
let existingLayout = null;
try { existingLayout = await readFile(layoutPath, 'utf8'); } catch { /* not there yet */ }

if (existingLayout === LAYOUT) {
  console.log('bridge_layout_main.xml is already in place.');
} else {
  await writeFile(layoutPath, LAYOUT);
  console.log('bridge_layout_main.xml written into the app module:');
  console.log('  + preview_view for the barcode scanner, WebView on top');
}

/* ------------------------------------------------------- scanner patience */

/*
 * The plugin counts how many frames in a row carried the same value and only
 * reports the barcode once that count reaches ten. On a label held steady that
 * is roughly a second of staring before anything happens. Code 128 and the
 * other shipping formats carry their own check digit, so a value that decodes
 * identically twice is not a misread — two frames give the same protection and
 * feel instant.
 *
 * This edits the plugin's source in node_modules, which Gradle compiles from
 * directly. Both are recreated on every build, so nothing is left behind.
 */
const VOTES_FROM = /votes\s*>=\s*10\b/;
const VOTES_TO = 'votes >= 2';

try {
  await access(scannerJavaPath);
  let java = await readFile(scannerJavaPath, 'utf8');
  if (java.includes(VOTES_TO)) {
    console.log('Barcode plugin already reports on the second frame.');
  } else if (VOTES_FROM.test(java)) {
    java = java.replace(VOTES_FROM, VOTES_TO);
    await writeFile(scannerJavaPath, java);
    console.log('Barcode plugin patched:');
    console.log('  + reports a barcode after 2 matching frames instead of 10');
  } else {
    console.warn('Note: the barcode plugin no longer has the 10-frame rule.');
    console.warn('Nothing was changed. Check the plugin version if scanning feels slow.');
  }
} catch (e) {
  console.warn('Could not reach the barcode plugin source: ' + e.message);
}
