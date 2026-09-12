# Business logic

Why the system counts what it counts, and what happens at each step.

---

## 1. Quantity is the unit of account

A return transaction is not a returned product. Ten returns can contain twenty-seven units. Reporting on transactions would tell you how busy the desk was; reporting on quantity tells you what happened to your stock. Both are shown, always separately, and one is never used in place of the other.

Worked example from the specification:

| Item | Return qty | OK | Repair | Damaged |
|---|---:|---:|---:|---:|
| Chair A | 5 | 2 | 2 | 1 |
| Chair B | 1 | 1 | 0 | 0 |
| Table C | 3 | 0 | 1 | 2 |
| **Total** | **9** | **3** | **3** | **3** |

```
OK %       = 3 / 9 = 33.33 %
Repair %   = 3 / 9 = 33.33 %
Damage %   = 3 / 9 = 33.33 %
```

Three transactions, nine units. The dashboard shows both figures and derives every percentage from the nine.

Division is always guarded: a period with no returns shows 0 %, never an error or a blank.

---

## 2. The quantity contract

```
Return_Qty  = OK_Qty + Repair_Qty + Damaged_Qty
0 ≤ Production_Qty     ≤ Damaged_Qty
0 ≤ Repair_Done_Qty    ≤ Repair_Qty
0 ≤ Production_Done_Qty ≤ Production_Qty
```

**Production is a subset of damage, never an addition.** A chair that comes back with a cracked frame is one damaged unit. Sending it to production does not create a second unit. If production were added to the total, every rebuilt item would be counted twice, damage percentages would inflate, and the totals would stop reconciling with what is physically on the floor.

So the system:
- stores `Production_Qty` inside the same row as `Damaged_Qty`
- refuses any value above `Damaged_Qty`, in the browser and again on the server
- reports production as its own figure next to damage, never summed into it
- labels this on screen, so nobody reading the dashboard has to guess

### Units not yet inspected

A return can be logged before anyone opens the carton. Those units are real but unclassified, so the honest form of the equation is:

```
Return_Qty = OK_Qty + Repair_Qty + Damaged_Qty + Unclassified_Qty
```

`unclassifiedQty` appears in the dashboard KPI payload and on the lane strip. Once inspection happens it drops to zero and the original equation holds.

---

## 3. Entering quantities

**One unit.** A single status is enough: OK Return, Repair Needed or Damaged Return. No quantity boxes appear, because there is nothing to split.

**More than one unit.** Three boxes appear — OK, Repair, Damaged — with a live counter:

```
Remaining = Return_Qty − (OK + Repair + Damaged)
```

The counter says exactly what is missing: *"3 units still to classify"*, *"All 5 units accounted for"*, or *"2 units more than came back. Reduce a quantity."* Save stays disabled until the remaining figure is zero.

**Damage present.** A production box appears, capped at the damaged quantity, with the subset rule stated inline.

Rejected everywhere: negatives, decimals, text, blanks in required quantities, any status above the return quantity, a sum that does not match, production above damage, future dates, unknown or inactive products, unknown sources.

Both layers check. The browser check is for speed; the Apps Script check is the one that counts, because a browser can be bypassed.

---

## 4. The lifecycle

```
Return received
      ↓
Inspection
      ↓
   ┌──┴────────────┬──────────────┐
  OK            Repair         Damaged
   │               │               │
   │          Repair queue    Production queue (subset)
   │               │               │
   └───────────────┴───────────────┘
                   ↓
               Completed
```

Item status is derived, never typed:

| Condition | Status |
|---|---|
| Not inspected | Pending Inspection |
| Repair units outstanding | Pending Repair, or In Repair once work starts |
| No repair left, production units outstanding | Pending Production, or Sent to Production |
| Nothing outstanding | Completed |

The header status follows its items: any item awaiting inspection makes the return Pending Inspection; all items complete makes it Completed; anything else is In Process.

An item can owe both repair and production work. The worklist shows it under the stage blocking it first, but pending quantity totals count both, so nothing hides.

---

## 5. Repair and production

Identical mechanics, different intent. Repair restores a fixable unit. Production rebuilds a unit too badly damaged to fix.

```
Pending_Qty = Quantity_Sent − Completed_Qty
```

`Pending_Qty` is always computed by the server. Completed quantity above the quantity sent is rejected. Marking a job complete requires the full quantity — no silent write-offs.

Recording progress pushes the completed figure back onto the return item, recomputes the item status, and closes the return when the last unit is done. Every step lands in the timeline and the audit log.

---

## 6. Ageing

Days between the return date (or the date sent to a queue) and today:

`0–1` · `2–3` · `4–7` · `8–15` · `15+`

The Pending screen leads with this histogram and sorts oldest first, because the point of ageing is to surface what has been sitting still. Rows past 7 days are marked, past 15 days more strongly.

---

## 7. Analytics definitions

Used identically in every screen, report and export.

| Metric | Definition |
|---|---|
| Return transactions | Distinct `Return_ID` count |
| Total return qty | `SUM(Return_Qty)` |
| OK qty | `SUM(OK_Qty)` |
| Repair qty | `SUM(Repair_Qty)` |
| Damage qty | `SUM(Damaged_Qty)` |
| Production qty | `SUM(Production_Qty)` — subset of damage |
| OK % | OK qty ÷ total return qty × 100 |
| Repair % | Repair qty ÷ total return qty × 100 |
| Damage % | Damage qty ÷ total return qty × 100 |
| Production % | Production qty ÷ total return qty × 100 |
| Quality rate | Same as OK % |
| Pending repair qty | `SUM(Repair_Qty − Repair_Done_Qty)` where positive |
| Pending production qty | `SUM(Production_Qty − Production_Done_Qty)` where positive |

Staff performance is measured in units handled and outstanding workload, not the number of entries someone made. Entry count rewards splitting one return into many rows; unit count does not.

Filters combine with AND. Source = Amazon, period = this month, status = Pending Repair and product = Dining Chair returns only rows satisfying all four.

---

## 8. Dictation and condition photos

Both exist to shorten the time between a carton being opened and the return being recorded, because that gap is where accuracy is lost.

**Dictation** fills the product field from speech, using the browser's own recognition. Nothing is sent to a server of ours and there is no key to manage. The matching is deliberately loose about punctuation: someone reading a SKU aloud says "oak dc zero zero one", so both sides of the comparison are stripped down to letters and digits before matching. One clear match is selected outright; several open the list already filtered; none says so plainly rather than silently doing nothing.

Support is uneven — Chrome and Edge have it, Firefox, iOS Safari and the Android WebView do not. Where it is missing the microphone never appears and the field behaves exactly as it always did. Nothing depends on it.

**Photos** sit with the condition, because that is what they are evidence for. They are optional everywhere, attach to a product rather than a whole return, and are capped per condition so a return does not become a photo album.

They are filed per condition rather than per product. A line split two OK, two repair, one damaged gets three sets of photos, and only the set for the selected condition is on screen at a time. Mixing them would defeat the purpose: a damage claim needs the damaged units, not five photographs of a carton.

Only conditions that actually have units get a tab — photographing "repair" on a line with no repair units would be filing evidence against nothing. Before anything is classified there is a single holding bucket, so a photo can still be taken the moment the carton is open; at upload those photos are filed automatically, but only when there is exactly one condition they could belong to. Editing a quantity back to zero never hides a photo that was already taken: its tab stays.

Images are resized in the browser before upload: a twelve megapixel photograph of a chair leg is four megabytes of detail nobody needs, on a connection that belongs to a warehouse. Two versions are sent — one full image and one thumbnail — so a gallery of twenty items does not pull twenty full-size photographs.

Nothing is made public. The files live in a private Drive folder owned by the account running the script and are read back through the API, so a photo is visible to exactly the people who could already sign in.

---

## 9. Security model

| Concern | How it is handled |
|---|---|
| Passwords | SHA-256 over password + per-user salt, iterated 1000 times. Never stored, returned or logged in clear |
| Sessions | Two-UUID token, 12-hour expiry, revocable, mirrored into cache for speed |
| Authorisation | Every route declares its roles. The check runs before the handler. Blocked attempts are audited |
| Frontend permissions | Used to hide menus and buttons only. Hiding a button is not security |
| The spreadsheet | Stays private. Only the script reads it, and the script runs as the owner |
| Secrets in GitHub | None. `config.js` holds a public endpoint URL and nothing else |
| Concurrency | Writes take a script lock. ID sequences are allocated inside it, so simultaneous saves cannot collide |
| Deletion | Soft, everywhere. Masters deactivate, transactions cancel, and the audit trail keeps both |

---

## 10. Where new capability slots in

The layers are kept apart so the following can be added without a rewrite:

| Addition | Where it goes |
|---|---|
| Barcode / QR / SKU scanning | Frontend only — a scan fills the product picker, the same entry point dictation already uses |
| Product images | `Products.Image_URL` is already stored and returned |
| Email or WhatsApp notifications | A new `Notify.gs` called from `createReturn` and the workflow updates |
| Scheduled management reports | A time trigger calling the existing `getReport` functions |
| Amazon / Flipkart / Shopify import | A new `Integrations.gs` that maps marketplace payloads onto `createReturn`. Nothing downstream changes because `createReturn` already validates everything |
| Courier tracking | A new tracking sheet keyed on `Return_ID` |
| Inventory or ERP sync | Read `Return_Items` — OK quantity is exactly what returns to sellable stock |

Each of those touches one layer. The quantity rules, the audit trail and the permission model stay where they are.
