# Setup and deployment

Around 20 minutes end to end. You need a Google account and a GitHub account.

---

## 1. The spreadsheet

1. Create a new Google Sheet. Name it something like `Return Desk Database`.
2. **Extensions → Apps Script**. A script project opens, bound to this sheet.
3. Delete the placeholder `Code.gs` content.
4. Create one script file per file in `backend/` and paste the contents in. The names must match:

```
Code.gs  Config.gs  Utils.gs  Auth.gs  Audit.gs  Returns.gs
Workflow.gs  Repair.gs  Production.gs  Analytics.gs  Photos.gs
Admin.gs  Setup.gs  Tests.gs
```

Apps Script adds `.gs` for you — type `Config`, not `Config.gs`.

5. Save. Pick `setupDatabase` from the function dropdown and **Run**.
6. Approve the permission prompt. It asks for two things: access to your spreadsheets, because the script is your database layer, and access to Drive, because condition photos are stored as files rather than crammed into a cell. A folder called **Return Desk Photos** is created the first time someone attaches a photo.

The run creates 16 sheets, seeds sources, departments, statuses and settings, and creates the administrator account:

```
Username: admin
Password: (12 random characters, shown once)
```

**Copy that password before closing the dialog.** It is hashed with a per-user salt and cannot be recovered. If you lose it, run `resetAdminPassword()` from the editor to generate a new one.

7. Optional: run `seedSampleData()`. It creates six products, five staff accounts (password `Welcome@2026`) and fifteen returns covering every scenario — single units, split quantities, multi-product returns, uninspected items, pending and completed repair, pending and completed production. Delete these rows before going live.

Reopen the spreadsheet and you will see a **Return Desk** menu with the same actions.

---

## 2. Deploy the API

1. In the Apps Script editor: **Deploy → New deployment**.
2. Click the gear next to *Select type* and choose **Web app**.
3. Set:
   - **Description**: `Return Desk API v1`
   - **Execute as**: **Me**
   - **Who has access**: **Anyone**
4. **Deploy**, approve, and copy the **Web app URL**. It ends in `/exec`.

### Why "Anyone" is safe here

"Anyone" means anyone may *send a request*. It does not mean anyone may read your data. Every route except `authenticateUser` and `ping` requires a valid session token, and every route declares which roles may call it. The spreadsheet itself stays private — only the script can read it, and the script runs as you.

What you must not do:
- Do not share the spreadsheet publicly.
- Do not put passwords, API keys or the spreadsheet ID in the frontend.
- Do not set **Execute as** to *User accessing the web app* — the callers have no access to your sheet.

Test the deployment by opening the `/exec` URL in a browser. You should see JSON, not a sign-in page:

```json
{"success":true,"message":"Use POST for API calls.","data":{"service":"Return Desk API"}}
```

If you get a Google sign-in page instead, the access setting did not save. Redeploy.

> Every time you change backend code, use **Deploy → Manage deployments → Edit → Version: New version**. Creating a brand new deployment gives you a different URL and you would have to update `config.js`.

---

## 3. Publish the frontend

1. Create a GitHub repository, public or private (GitHub Pages works on private repos for paid plans).
2. Commit the contents of `frontend/` to the repository root:

```
index.html  app.html
manifest.webmanifest  sw.js
css/style.css  css/dashboard.css  css/forms.css  css/responsive.css
js/*.js
assets/*.png
```

Commit `assets/` and `manifest.webmanifest` too — without them the app still runs, but it cannot be installed to a phone's home screen.

3. Open `js/config.js` and replace the placeholder:

```js
API_URL: 'https://script.google.com/macros/s/AKfy.../exec',
```

4. **Settings → Pages**. Source: *Deploy from a branch*, branch `main`, folder `/ (root)`. Save.
5. Wait a minute, then open `https://<user>.github.io/<repo>/`.

Sign in with `admin` and the password from step 1.

---

## 4. First-run administration

Sign in, go to **Admin**.

**Settings** — set at minimum:

| Setting | What it does |
|---|---|
| `company_name` | Shown under the app name in the sidebar |
| `time_zone` | Drives dates and the daily Return ID sequence. Set this before recording real returns |
| `date_format` | Display only, e.g. `dd-MM-yyyy` |
| `require_order_id` | `TRUE` makes the marketplace order ID mandatory |
| `pagination_size` | Rows per page in lists |
| `feature_production` | `FALSE` hides the production workflow if you do not rebuild goods |
| `feature_photos` | `FALSE` removes the camera from the return form entirely |
| `max_photos_per_item` | Photos allowed on one returned product, default 5 |
| `max_photo_mb` | Largest accepted photo after the browser compresses it, default 2 |
| `feature_voice` | `FALSE` hides the microphone on the product field |
| `voice_language` | Recognition language, e.g. `en-IN`, `en-GB`, `hi-IN` |

**Products** — add your catalogue with real SKUs. Products are never hard-coded; the return form only offers what is here and active.

**Sources** — eight marketplaces are seeded. Rename, reorder or deactivate as needed. Renaming rewrites historical rows so reports stay consistent.

**Departments** — eight are seeded.

**Users** — add your staff. Each needs a name, username, department, role and an initial password of at least 8 characters. Give people the narrowest role that lets them do their job:

| If they… | Give them |
|---|---|
| log returns at the receiving desk | `RETURN_OPERATOR` |
| work in the repair bay | `REPAIR_TEAM` |
| rebuild damaged goods | `PRODUCTION` |
| only look at numbers | `MANAGEMENT` |
| administer the system | `ADMIN` |

Deactivate rather than delete. A deactivated user cannot sign in, but their name stays attached to the returns they handled.

Ask everyone to change their password after the first sign-in.

---

## 5. Optional automation

From the Apps Script editor, add time-driven triggers:

| Function | Suggested schedule | Purpose |
|---|---|---|
| `purgeExpiredSessions` | Daily | Marks stale session rows inactive |
| `snapshotDashboard` | Daily, late evening | Writes a daily figure into `Dashboard_Data` for long-term reporting |

Neither is required. The dashboard always calculates from transactions, never from snapshots.

---

## Upgrading later

1. Paste the changed backend files into Apps Script.
2. Run `setupDatabase()` again — it is safe to re-run and only adds what is missing.
3. **Deploy → Manage deployments → Edit → New version**.
4. Push the frontend changes to GitHub. Tell users to hard-refresh (`Ctrl+Shift+R`) if they see stale files.
