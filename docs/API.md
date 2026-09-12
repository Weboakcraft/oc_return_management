# API reference

One endpoint, one shape. Everything goes through `POST /exec` with a JSON body.

```json
{ "action": "getReturns", "token": "…", "payload": { "range": "this_month" } }
```

Success:

```json
{ "success": true, "message": "OK", "data": { } }
```

Failure:

```json
{ "success": false, "message": "Status quantities must equal total return quantity.", "errorCode": "VALIDATION_ERROR" }
```

`message` is written for the person on the screen, not the developer. Stack traces stay in the Apps Script logs.

### Content type

Requests are sent as `Content-Type: text/plain` on purpose. That makes them "simple" requests, so the browser skips the CORS preflight, which Apps Script cannot answer. The body is still JSON.

```js
fetch(API_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({ action, token, payload })
});
```

A read-only JSONP fallback exists on `GET` with `?action=…&token=…&payload=…&callback=…`.

### Error codes

| Code | Meaning |
|---|---|
| `VALIDATION_ERROR` | The data breaks a business rule |
| `AUTH_REQUIRED` | No token, expired token, or deactivated account |
| `AUTH_FAILED` | Wrong username or password |
| `FORBIDDEN` | Valid session, wrong role for this action |
| `NOT_FOUND` | The record does not exist |
| `DUPLICATE` | SKU, username or source already in use |
| `CONFLICT` | The change contradicts work already completed |
| `LOCK_TIMEOUT` | Another write held the lock too long |
| `SETUP_REQUIRED` | `setupDatabase()` has not been run |
| `SERVER_ERROR` | Unexpected — check the Apps Script execution log |

---

## Date filters

Most read actions accept the same period parameters:

| Field | Values |
|---|---|
| `range` | `today`, `yesterday`, `this_week`, `last_week`, `this_month`, `last_month`, `last_30`, `this_year`, `all`, `custom` |
| `from`, `to` | `yyyy-MM-dd`, required when `range` is `custom` |

Weeks start Monday. All ranges are inclusive of both ends.

---

## Authentication

### `authenticateUser` — public
`{ username, password }` → `{ token, expiresAt, user, permissions, settings }`

### `getSession` — all roles
Returns the current user, permissions and public settings.

### `logoutUser` — all roles
Marks the session inactive.

### `changePassword` — all roles
`{ currentPassword, newPassword }`. Minimum 8 characters.

### `ping` — public
Health check.

---

## Bootstrap and masters

### `getBootstrap` — all roles
One call the app makes on load: user, permissions, settings, products, sources, employees, statuses, departments, ageing buckets. Nothing in the frontend is hard-coded because of this call.

### `getProducts` / `getSources` / `getEmployees` / `getStatuses` / `getDepartments` — all roles
`{ includeInactive }`. Employees never include password fields.

### `getSettings` — admin
Raw key/value/description rows.

---

## Returns

### `createReturn` — admin, operator

```json
{
  "orderId": "OD-40003",
  "returnDate": "2026-09-12",
  "receivedDate": "2026-09-12",
  "source": "Meesho",
  "employeeId": "EMP-00002",
  "remarks": "Two cartons",
  "inspected": true,
  "items": [
    { "productId": "PROD-000001", "returnQty": 5, "okQty": 2, "repairQty": 2, "damagedQty": 1, "productionQty": 1 },
    { "productId": "PROD-000002", "returnQty": 1, "status": "OK Return" }
  ]
}
```

For a single unit, send `status` (`OK Return`, `Repair Needed`, `Damaged Return`) instead of the split. Send `inspected: false` to log a delivery that has not been checked yet — the items sit in Pending Inspection with no quantities assigned.

Rejects: quantities that do not sum to `returnQty`, negatives, decimals, text, any status above `returnQty`, `productionQty` above `damagedQty`, unknown or inactive products, unknown sources, future dates, empty item lists.

Returns `{ returnId, totalQty, itemCount, items }`, where `items` carries the created `returnItemId` for each line **in the order they were sent**. That is how the browser attaches condition photos to the right product once the return exists. Repair and production queue entries are created automatically, and the timeline is written.

### `inspectReturnItem` — admin, operator
`{ returnItemId, status | okQty/repairQty/damagedQty, productionQty, remarks }`. For items received uninspected. Refuses if work has already been completed on the item.

### `updateReturnItem` — admin, operator
Correction path for an already-inspected item. Cannot drop a quantity below what has already been repaired or produced. Every changed field is written to the audit log.

### `updateReturn` — admin, operator
Header edits: `source`, `returnDate`, `orderId`, `remarks`. Item copies are kept in step.

### `deactivateReturn` — admin
`{ returnId, reason }`. Soft delete. The rows stay; reports exclude them.

### `getReturns` — all roles
Item-level list. Filters combine: `range`/`from`/`to`, `q`, `source`, `productId`, `employeeId`, `department`, `status`, `returnId`, `orderId`, `sku`, plus `page` and `pageSize`.

Returns `{ total, page, pageSize, totals, rows }` where `totals` carries quantity sums and percentages.

### `searchReturns` — all roles
`{ q, limit }`. Searches Return ID, order ID, SKU, product, source, inspector and remarks.

### `getReturn` — all roles
`{ returnId }` → `{ header, items, totals, repairs, production, timeline }`.

### `getPendingReturns` — all roles
Grouped into `inspection`, `repair`, `production`, `completed`, with `counts`, `pendingQty` and an `ageing` histogram.

Bucket membership follows the stage actually holding an item up, but `pendingQty` totals are global — one item can sit in the repair worklist and still owe production units, and both are counted.

---

## Repair and production

### `getRepairQueue` / `getProductionQueue` — all roles
`{ view: 'pending' | 'completed' | 'all', range, q, status, productId }` → `{ total, totals, statuses, rows }`.

### `updateRepairStatus` / `updateProductionStatus` — admin + the matching team
`{ id, completedQty, status, assignedTo, remarks }`.

Refuses `completedQty` above `quantitySent`. Marking complete requires the full quantity. Status is adjusted automatically: any progress moves Pending to In progress, and full completion sets Completed. Progress is pushed back onto the item, the item status is recomputed, and the return closes when nothing is outstanding.

### `createRepairEntry` — admin, operator, repair
### `createProductionEntry` — admin, operator, production
`{ returnItemId, quantity }`. Moves damaged units into production. Refuses a quantity above the damaged quantity.

---

## Photos

Condition photos live in a private Drive folder owned by the account running the script. The sheet holds only the reference. Nothing is made public — images are read back through this API, so a photo is visible to exactly the people who can already sign in.

The browser compresses before uploading and sends two versions: a full image (longest edge 1280px) and a thumbnail (240px). Galleries load thumbnails; the full image is fetched only when someone opens it.

### `uploadPhoto` — admin, operator, repair, production

```json
{
  "returnItemId": "RTI-00000042",
  "data": "data:image/jpeg;base64,…",
  "thumb": "data:image/jpeg;base64,…",
  "mimeType": "image/jpeg",
  "conditionTag": "Damaged",
  "caption": "Cracked rear leg"
}
```

The `data:` prefix is optional. `conditionTag` is one of `OK`, `Repair`, `Damaged`, `General`.

Rejects: anything that is not JPEG, PNG or WebP; images above `max_photo_mb` after compression; more than `max_photos_per_item` on one product; items on a cancelled return.

### `getPhotos` — all roles
`{ returnItemId }` or `{ returnId }`, plus optional `withThumbnails: false`. Thumbnails come back inline as data URLs. A photo whose Drive file was deleted outside the app is returned with `missing: true` rather than breaking the gallery.

### `getPhoto` — all roles
`{ photoId }` → the full image as a data URL, with who took it and when.

### `deletePhoto` — admin, operator, repair, production
`{ photoId, reason }`. Soft delete in the sheet, trashed in Drive so it can still be recovered. Only an administrator or the person who took the photo may remove it.

### `getPhotoCounts` — all roles
`{ returnId }` → `{ counts: { returnItemId: n } }`.

---

## Analytics

All accept the standard date filter. Admin, operator and management; `getEmployeePerformance` is admin and management only.

### `getDashboardData`
`{ kpi, pending, sources, topProducts, hotspots, trend }`.

`kpi` carries `returnTxns`, `returnQty`, `okQty`, `repairQty`, `damagedQty`, `productionQty`, the matching percentages, `qualityRate`, and `unclassifiedQty` / `unclassifiedPct` for units not yet inspected.

### `getItemAnalytics`
`{ sort, limit }`. Sort values: `return_qty`, `damaged_qty`, `repair_qty`, `ok_qty`, `ok_pct_desc`, `ok_pct_asc`, `damage_pct_desc`, `repair_pct_desc`.

Returns the full list plus `mostReturned`, `highestDamage`, `highestRepair`, `highestOk`.

### `getSourceAnalytics`
Every configured source appears, including those with no returns in the period.

### `getTrendAnalytics`
`{ grain: 'day' | 'week' | 'month' }` → `{ trend, sourceTrend }`.

### `getEmployeePerformance`
Units handled, not entry count, plus each person's outstanding workload.

### `getReport`
`{ type }`: `daily`, `weekly`, `monthly`, `item`, `source`, `employee`, `repair_pending`, `production_pending`, `damage`.

### `exportData`
`{ dataset }`: `returns`, `items`, `sources`, `repair`, `production`, `employees`, `audit` (admin only). Respects every active filter and returns `{ filename, csv, rowCount }`.

---

## Administration — admin only

### `saveProduct`
`{ productId?, name, sku, category, subCategory, imageUrl, active }`. Omit `productId` to create. SKUs must be unique.

### `saveSource`
`{ sourceId?, name, sortOrder, active }`. Renaming rewrites history.

### `saveEmployee`
`{ employeeId?, name, username, department, role, password?, active }`. A password is required when creating and optional when editing. You cannot deactivate your own account.

### `saveStatus`
`{ statusId?, group, name, sortOrder, active }`. Workflow statuses cannot be renamed.

### `saveDepartment`
`{ departmentId?, name, active }`.

### `saveSettings`
`{ settings: { key: value } }`. Each change is audited with its old and new value.

### `getAuditLogs`
`{ range, from, to, q, module, action, user, limit }`.

### `getDataQuality`
Runs every integrity check and returns `{ total, summary, issues }`.

---

## Adding an action

1. Write the function in the relevant `.gs` file with the signature `(payload, session)`.
2. Return `ok(data, message)` or throw with `bad(message, code)`.
3. Register it in `ROUTES` in `Code.gs` with the roles allowed to call it.
4. Redeploy as a new version.

A function that is not in `ROUTES` is not reachable. A route without a `roles` list is not reachable either unless it is explicitly marked `public`.
