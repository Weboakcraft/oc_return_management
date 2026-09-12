# Return Desk for Android

This folder wraps the existing web app in a native Android shell using Capacitor. The APK ships the real `frontend/` files — there is no second codebase, so a fix made to the web app reaches the phone on the next build.

```
return-desk/
├── frontend/   the web app (also served by GitHub Pages)
└── mobile/     this folder — the Android wrapper
```

The app talks to the same Apps Script backend over the internet. It needs a connection to load returns or save anything; the shell itself opens offline.

---

## Before you build anything

Decide whether you actually need an APK.

**Installing the website is usually enough.** Open the site in Chrome on the phone, tap the menu, choose *Add to home screen*. You get an icon, a full-screen app with no browser bars, and offline loading of the shell — because the web app is a progressive web app. Updates arrive the moment you push to GitHub. No build, no signing, no distribution.

**Build the APK when** you want to sideload it without a browser step, put it on the Play Store, hand staff a file to install, or use an MDM to push it to company devices.

---

## Route 1 — GitHub Actions, nothing installed locally

The quickest path to a real `.apk`.

1. Push this whole `return-desk` folder to a GitHub repository, including `.github/workflows/build-apk.yml`.
2. In the repository: **Settings → Secrets and variables → Actions → Variables → New variable**
   - Name: `RETURN_DESK_API_URL`
   - Value: your Apps Script `/exec` URL
3. **Actions → Build Android APK → Run workflow**.
4. When it finishes (about five minutes), open the run and download the **return-desk-debug-…** artifact. Inside is `app-debug.apk`.

On the phone: allow *Install unknown apps* for your file manager or browser, then open the APK.

A debug APK is signed with a throwaway debug key. It installs and runs fine, but it cannot go to the Play Store and cannot be upgraded in place by a release build. For that, add signing secrets — see below.

## Route 2 — build on your own machine

Needs Node 20+, JDK 21 and Android Studio (which brings the SDK).

```bash
cd mobile
npm install

# Bake in your backend URL
export RETURN_DESK_API_URL="https://script.google.com/macros/s/…/exec"

npm run init      # stage the web app and create the android/ project
npm run icons     # launcher icons and splash screens from resources/
npm run apk:debug # build

# APK lands here:
# mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

After the first `npm run init`, use `npm run sync` for later builds. `npm run open` opens the project in Android Studio if you want to run it on a connected device.

## Route 3 — Play Store

You need a signed release build and a Google Play developer account (one-time fee).

Create a keystore once and keep it somewhere safe. If you lose it you cannot publish updates to the same listing, ever.

```bash
keytool -genkey -v -keystore return-desk.keystore \
  -alias returndesk -keyalg RSA -keysize 2048 -validity 10000
```

For CI signing, add these four repository secrets:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 return-desk.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | the store password |
| `ANDROID_KEY_ALIAS` | `returndesk` |
| `ANDROID_KEY_PASSWORD` | the key password |

With those present, the workflow also produces a signed `app-release.apk`. Push a tag such as `v1.0.0` and both APKs are attached to the GitHub release automatically.

The Play Store wants an `.aab` rather than an `.apk`. Run `./gradlew bundleRelease` in `mobile/android` for that.

---

## How the pieces fit

`npm run web` copies `../frontend` into `www/` and does two small things on the way:

- rewrites `API_URL` in `js/config.js` from `RETURN_DESK_API_URL`, so the backend URL is not committed to the repository
- disables the service worker inside the native shell, because the APK already carries its assets locally and a second cache only creates a stale copy to debug later

Everything else ships untouched.

### Choosing what the APK contains

The default bundles the web files, so the app opens instantly and survives a bad connection at the shell level. The trade-off is that a frontend change needs a new APK.

If you would rather have the app always load the live site, add this to `capacitor.config.json`:

```json
"server": {
  "androidScheme": "https",
  "url": "https://your-name.github.io/return-desk",
  "cleartext": false
}
```

Now the APK is a thin shell and every GitHub Pages deploy reaches phones immediately — at the cost of a blank screen when there is no signal. For a warehouse with reliable wifi that is often the better deal.

---

## Settings worth knowing

| File | Setting | Meaning |
|---|---|---|
| `capacitor.config.json` | `appId` | `com.returndesk.app`. Change it before publishing; it is permanent on the Play Store |
| `capacitor.config.json` | `appName` | The name under the launcher icon |
| `mobile/resources/` | `icon.png`, `splash.png` | Redraw these and re-run `npm run icons` to rebrand |
| `mobile/android/app/build.gradle` | `versionCode`, `versionName` | Increment `versionCode` for every Play Store upload |

`android/`, `www/` and `node_modules/` are generated and git-ignored. Never edit files in `android/` by hand expecting them to survive — they are rebuilt from `capacitor.config.json` and `resources/`.

---

## If a build fails

**`SDK location not found`** — Android Studio has not been opened yet, or `ANDROID_HOME` is unset. Open Android Studio once and let it install the SDK.

**`Could not find com.android.tools.build:gradle`** — the machine cannot reach Google's Maven repository. Check the network or proxy.

**The app opens and shows "API URL is not set"** — the build ran without `RETURN_DESK_API_URL` and `frontend/js/config.js` still has the placeholder. Set the repository variable and rebuild.

**Sign-in works in Chrome but not in the APK** — the Apps Script deployment is not set to *Anyone*. The native shell has its own origin and cannot borrow your browser session.

**`INSTALL_FAILED_UPDATE_INCOMPATIBLE`** — you are installing a release APK over a debug one, or vice versa. Uninstall the old app first.
