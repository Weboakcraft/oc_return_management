# Return Desk — web app

This repository is the front half of Return Desk. The other half is a Google
Apps Script project bound to a Google Sheet; deploy that first, because this
app is useless without its `/exec` URL.

```
index.html            sign-in
app.html              the application
css/  js/  assets/    stylesheets, modules, icons
manifest.webmanifest  makes it installable on a phone
sw.js                 offline shell
mobile/               Capacitor wrapper for building an APK
.github/workflows/    builds the APK in CI
docs/                 setup, database, API, business logic, mobile, troubleshooting
```

## Publish it

1. Push this repository to GitHub.
2. Open `js/config.js` and paste your Apps Script Web App URL:

   ```js
   API_URL: 'https://script.google.com/macros/s/AKfy…/exec',
   ```

3. **Settings → Pages**. Source: *Deploy from a branch*, branch `main`, folder `/ (root)`.
4. Wait a minute, then open `https://<user>.github.io/<repo>/` and sign in.

`docs/SETUP.md` has the full walk-through, including the Apps Script half.

## On a phone

Open the published site in Chrome and choose **Install app** — you get a home
screen icon, a full screen app, and updates on every deploy.

For a real `.apk`, see `docs/MOBILE.md` and `mobile/README.md`. The workflow in
`.github/workflows/build-apk.yml` builds one without you installing anything.

## A note on `js/config.js`

It holds a public endpoint URL and nothing else. No password, key or
spreadsheet ID belongs in this repository — every one of those stays inside
Apps Script, which is why the backend can be deployed for "Anyone" safely.
