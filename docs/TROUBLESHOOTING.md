# Troubleshooting

---

## Sign-in and connection

**"API URL is not set."**
`js/config.js` still has the placeholder. Paste the `/exec` URL from **Deploy → Manage deployments**.

**"Could not reach the server. Check your internet connection."**
Usually the browser blocking the request rather than the network. Check in order:
1. The URL ends in `/exec`, not `/dev`. The `/dev` URL only works while signed into the owning Google account.
2. The deployment access is **Anyone**, and **Execute as** is **Me**.
3. Open the `/exec` URL directly in a tab. JSON means the API is alive; a Google sign-in page means the access setting did not save — redeploy.

**"Apps Script asked for sign-in. Redeploy the web app with access set to Anyone."**
Exactly that. Edit the deployment, set access to Anyone, publish a new version.

**"The server returned 403."**
The deployment was made under a Workspace account with external sharing restricted. Ask your administrator to allow web app publishing, or deploy from a personal Google account.

**"Username or password is incorrect" for the admin account**
Run `resetAdminPassword()` from the Apps Script editor. It prints a fresh password.

**Signed out unexpectedly**
Sessions last 12 hours. Change `CONFIG.SESSION_HOURS` in `Config.gs` and redeploy if you want longer. A deactivated account is also signed out at the next request.

---

## Setup

**"Sheet not found: … Run setupDatabase() once."**
The sheet was renamed or deleted. Re-run `setupDatabase()`; it only creates what is missing.

**"No spreadsheet bound. Set CONFIG.SPREADSHEET_ID in Config.gs."**
The script was created standalone rather than from the sheet. Either recreate it via **Extensions → Apps Script** on the sheet, or paste the spreadsheet ID (the long string in the sheet URL) into `CONFIG.SPREADSHEET_ID`.

**Headers look wrong after an upgrade**
Re-run `setupDatabase()`. It rewrites header rows to match `SCHEMA` without touching data. If you reordered columns by hand, restore the original order first — writes are positional.

---

## Saving returns

**"Status quantities must equal total return quantity."**
OK + Repair + Damaged must equal the return quantity exactly. The remaining counter under the boxes shows the gap.

**"Production quantity cannot exceed damaged quantity."**
Production units are part of the damaged count, not extra units. Raise the damaged quantity or lower production.

**"System is busy processing another request."**
Two writes collided and one waited too long. Retry. If it happens often, the sheet is probably very large — see Performance below.

**Save button stays grey**
Something is still invalid. Check that a product is selected on every line, the return quantity is at least 1, the source is chosen, and the remaining counter reads zero on every line.

**"Return date cannot be in the future."**
Check the `time_zone` setting under Admin → Settings. A wrong time zone can make today look like tomorrow.

---

## Numbers that look wrong

**Dashboard total does not match the sheet**
The dashboard counts only active items in the selected period. Cancelled returns are excluded by design. Switch the range to All time before comparing.

**Percentages do not add to 100**
They will not when some units are still uninspected — those appear as unclassified. They also will not include production, which is inside damage rather than alongside it.

**Damage and production look double counted**
They are not. Run **Admin → Data quality**; it flags any row where production exceeds damage. If the report is clean, the figures are consistent and the reading is the issue: production is a subset.

**Pending repair quantity differs between screens**
The Pending screen groups each item under the stage blocking it first, but totals pending quantity globally. An item awaiting repair that also owes production units contributes to both totals and appears once in the repair list. This is deliberate.

**A source disappeared from reports**
Someone renamed it. Renaming rewrites history, so old rows moved to the new name.

---

## Repair and production

**"Completed quantity cannot exceed the quantity sent."**
Record only what was actually finished. If the sent quantity itself is wrong, correct the inspection on the return detail screen instead.

**"Enter the full completed quantity before marking this complete."**
Completed means all of it. Leave the status as In progress for partial work.

**A return will not close**
Open it and check every item. Something still has outstanding repair or production units, or an item is still awaiting inspection.

**"Quantity cannot be lower than the quantity already completed."**
Work has already been recorded against those units. They cannot be un-done by editing the inspection.

---

## Photos and dictation

**The microphone button is not there**
The browser has no speech recognition at all. Firefox, iOS Safari and the Android WebView inside the APK are the usual cases — the button is hidden rather than offered and then failing. Chrome and Edge have it. Check `feature_voice` in Admin → Settings too.

**The microphone is there but greyed out**
The page is not a secure context, which recognition requires. Your published HTTPS site is fine, `localhost` is fine, and a file opened straight from disk is fine in Chrome. A site served over plain `http://` is not.

**"Microphone access was blocked"**
Tap the padlock in the address bar and allow the microphone for the site. On Android, also check that Chrome itself has microphone permission in system settings.

**Dictation picks the wrong product**
The match is on letters and digits only, so "oak dc zero zero one" finds `OAK-DC-001`. If several products share a prefix it will list them instead of guessing. Saying the product name usually works better than reading the SKU.

**"That photo is larger than the 2 MB limit"**
The browser already compresses to 1280px before uploading, so hitting the limit usually means a very large panorama or a screenshot of a photo. Raise `max_photo_mb` in Admin → Settings, or retake it.

**Photos fail to upload but the return saved**
That is deliberate: the return is written first and photos follow, so a bad connection never costs you the return. Open the return and add the photos again from the Condition photos panel.

**A photo shows "File missing"**
The Drive file was deleted or moved outside the app. The record stays so the history is honest about it. Remove the entry from the return to tidy up.

**The script asks for Drive permission again**
Photos need Drive access, which older deployments were not granted. Run any function once from the editor, approve the prompt, and redeploy.

**Nothing uploads and the error mentions Drive**
Check that the account running the script has Drive space left, and that **Return Desk Photos** has not been deleted. If it has, clear `photo_folder_id` in Admin → Settings and the folder is recreated on the next upload.

## Performance

Apps Script reads a whole sheet per call. Everything is batched, master data is cached for five minutes and sessions are cached, but `Return_Items` grows forever.

Signs of strain: screens taking more than a few seconds, occasional `LOCK_TIMEOUT`.

What to do, in order:
1. Use narrower date ranges day to day. All time is for analysis, not routine work.
2. Photos do not slow the sheet down — only the reference is stored — but they do use Drive space. Roughly 250 KB per photo, so 10,000 photos is about 2.5 GB.
3. Once past roughly 20,000 item rows, archive completed returns older than a year: copy those rows to a separate spreadsheet, then delete them from the live sheets. Keep the `Audit_Log` intact.
4. Consider a daily `snapshotDashboard()` trigger so long-range reporting reads snapshots rather than recomputing.

Apps Script also has a six-minute limit per execution. No single request here comes close, but a very large export might — export a narrower period.

---

## Frontend

**Old version keeps loading**
GitHub Pages caches aggressively. Hard-refresh with `Ctrl+Shift+R`, or add a version query to the script tags in `app.html`.

**Page loads but stays empty**
Open the browser console. A syntax error in one JS file stops the rest. Confirm all fifteen files under `js/` uploaded, in the order listed in `app.html`.

**Charts do not render**
They are inline SVG with no external dependency, so a missing chart means the data was empty — check the date range.

**Layout looks broken on a phone**
Confirm `css/responsive.css` is present and listed last in the page head. Order matters.

**Fonts look plain**
IBM Plex is loaded from Google Fonts. The app falls back to the system font stack when that is blocked, which is fine — nothing else depends on it.

---

## Getting more detail

Apps Script editor → **Executions** shows every call, its duration and any error with a stack trace. Users only ever see the friendly message; the trace stays here.

**Admin → Audit log** answers who changed what and when, down to the field, with the value before and after.

To reproduce a problem without touching live data, copy the spreadsheet, deploy the script from the copy, and point a local `config.js` at it.
