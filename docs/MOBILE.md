# Using Return Desk on a phone

There are two ways to put this on a warehouse phone, and the cheaper one is usually the right one.

| | Installed website (PWA) | Android APK |
|---|---|---|
| Setup effort | None, it already works | A build, plus signing for the Play Store |
| Icon on the home screen | Yes | Yes |
| Full screen, no browser bars | Yes | Yes |
| Updates | Instant on the next GitHub Pages deploy | New APK each time |
| Works with no signal | Shell opens; data needs the network | Same |
| Distribute by file or MDM | No | Yes |
| Play Store listing | No | Yes |
| Camera for condition photos | Yes | Yes |
| Dictating the product name | Yes | **No** — see below |

Both use the same code and the same backend. Nothing is lost by starting with the website and building the APK later if you need it.

---

## Install the website as an app

**Android, Chrome**
Open your GitHub Pages URL, tap the three-dot menu, choose **Install app** or **Add to home screen**. The app also offers an *Install app* button on the sign-in screen when the browser supports it.

**iPhone, Safari**
Open the URL, tap Share, choose **Add to Home Screen**. iOS does not show an install prompt, so staff have to be told this step.

**Desktop, Chrome or Edge**
An install icon appears at the right of the address bar.

Once installed it runs in its own window with no address bar, keeps you signed in for the usual 12 hours, and opens instantly because the shell is cached.

### What works without a connection

The app opens and shows whatever is already on screen. Anything that reads or writes data needs the network, because the spreadsheet is the single source of truth and a return saved into a local cache would be a return nobody else can see. When the connection drops, a bar appears at the bottom saying so, and saving fails with a clear message rather than pretending to succeed.

### Getting updates to staff

Publish to GitHub Pages as usual. Next time someone opens the app, a small bar appears: *A new version is ready. Reload.* Nobody has to reinstall anything.

### Camera and microphone on a phone

**Photos** work everywhere. The camera button is a plain file input, so tapping it opens the phone's own camera app. The first time, Android asks for permission; if someone declines, the button still opens the gallery instead.

**Dictation needs Chrome.** Speech recognition is a browser feature, and the Android WebView does not have it — which means the microphone appears in the installed website but not in the APK. If dictation matters to your team, that alone is a reason to prefer the installed website. The alternative is adding a native speech plugin to the Capacitor build, which is a real piece of work rather than a setting.

Dictation also needs HTTPS, which GitHub Pages provides, and a connection, because recognition happens on Google's servers rather than on the device.

---

## Build the APK

Everything for this lives in `mobile/`. Read [mobile/README.md](../mobile/README.md) for the full detail; the short version:

1. Push the repository to GitHub with `.github/workflows/build-apk.yml` in place.
2. Add a repository **variable** called `RETURN_DESK_API_URL` holding your Apps Script `/exec` URL.
3. **Actions → Build Android APK → Run workflow**.
4. Download the artifact. It contains `app-debug.apk`.

The APK wraps the same web files in a native shell, so there is no second app to maintain. For the Play Store you also need a signing keystore — the workflow picks one up automatically once you add the signing secrets.

---

## Advice for phones on the floor

**Use a short date range.** The date filter defaults to this month. On a phone, Today or This week loads faster and is usually what the person needs.

**The entry form is built for one hand.** Quantity boxes are large, the remaining counter sits directly under them, and the save bar stays fixed at the bottom of the screen while you scroll.

**Give people the narrowest role.** A repair technician with the `REPAIR_TEAM` role sees three menu items instead of nine, which on a small screen matters more than it does on a desk.

**Tables turn into cards below 900 pixels.** Every value carries its label, so nothing is lost when the columns disappear.

**Sessions last 12 hours.** A phone left locked overnight will ask for a password in the morning. Change `CONFIG.SESSION_HOURS` in `Config.gs` if a shift pattern needs longer.
