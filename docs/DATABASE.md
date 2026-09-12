# Database structure

Sixteen sheets in one Google Spreadsheet. Column order is defined by `SCHEMA` in `Config.gs`; reads go by header name, so inserting a column is safe but renaming one is not.

```
Returns ──< Return_Items ──< Repair_Tracking
                         ├─< Production_Tracking
                         └─< Return_Photos ──> Google Drive
                         
Masters: Products · Employees · Return_Sources · Statuses · Departments · Settings
System:  Timeline · Audit_Log · Sessions · Counters · Dashboard_Data
```

---

## Returns

One row per return transaction. The header, not the source of quantity truth.

| Column | Notes |
|---|---|
| `Return_ID` | `RET-20260912-00001`, unique, generated under a script lock |
| `Order_ID` | Marketplace order reference, optional unless `require_order_id` is on |
| `Return_Date` | `yyyy-MM-dd` |
| `Received_Date` | Defaults to the return date |
| `Source` | Must match an active `Return_Sources.Source_Name` |
| `Employee_ID` / `Employee_Name` | Who received it |
| `Total_Return_Qty` | Recalculated from the items, never typed |
| `Overall_Status` | `Pending Inspection`, `In Process`, `Completed`, `Cancelled` |
| `Inspection_Status` | `Pending Inspection` or `Inspection Completed` |
| `Created_By` / `Created_At` / `Updated_By` / `Updated_At` | |
| `Remarks` | |
| `Active` | `FALSE` after a cancellation. Rows are never deleted |

## Return_Items

**The quantity ledger.** Every analytic in the system sums these columns. One row per product per return.

| Column | Notes |
|---|---|
| `Return_Item_ID` | `RTI-00000001` |
| `Return_ID` | Parent |
| `Order_ID` / `Return_Date` / `Source` | Copied from the header so analytics reads one table |
| `Product_ID` / `SKU` / `Product_Name` | Snapshot at time of entry |
| `Return_Qty` | Units that came back |
| `OK_Qty` | Sellable again |
| `Repair_Qty` | Fixable |
| `Damaged_Qty` | Damaged |
| `Production_Qty` | Subset of `Damaged_Qty` being rebuilt |
| `Repair_Done_Qty` | Pushed back from `Repair_Tracking` |
| `Production_Done_Qty` | Pushed back from `Production_Tracking` |
| `Current_Status` | Derived, never typed directly |
| `Inspection_Date` / `Inspector` | |
| `Employee_ID` | Used for staff analytics |
| `Remarks` / `Created_At` / `Updated_At` / `Active` | |

Invariants, enforced on write and checked by the data quality report:

```
Return_Qty        = OK_Qty + Repair_Qty + Damaged_Qty   (once inspected)
Production_Qty   ≤ Damaged_Qty
Repair_Done_Qty  ≤ Repair_Qty
Production_Done_Qty ≤ Production_Qty
```

## Products

`Product_ID` (`PROD-000001`), `SKU` (unique, upper-cased), `Product_Name`, `Category`, `Sub_Category`, `Active`, `Image_URL`, `Created_At`, `Updated_At`.

Deactivating hides a product from the return form without touching history.

## Employees

`Employee_ID` (`EMP-00001`), `Employee_Name`, `Username` (unique, lower-cased), `Department`, `Role`, `Active`, `Password_Hash`, `Salt`, `Last_Login`, `Created_At`, `Updated_At`.

`Password_Hash` is SHA-256 applied 1000 times over the password plus a per-user random salt. Clear-text passwords are never stored, never returned by the API, and never logged.

`Role` is one of `ADMIN`, `RETURN_OPERATOR`, `REPAIR_TEAM`, `PRODUCTION`, `MANAGEMENT`.

## Return_Sources

`Source_ID`, `Source_Name`, `Sort_Order`, `Active`, timestamps. Seeded with Amazon, Flipkart, Myntra, Meesho, Shopify, Website, Offline, Other.

Renaming a source rewrites `Returns.Source` and `Return_Items.Source` across history, so period-over-period comparisons stay valid.

## Statuses

`Status_ID`, `Status_Group`, `Status_Name`, `Sort_Order`, `Active`, timestamps.

Groups: Inspection, Return Result, Repair, Production, Final. Statuses that drive the engine (listed in `SYS` in `Config.gs`) can be reordered or hidden but not renamed — the workflow matches on those exact strings.

## Departments

`Department_ID`, `Department_Name`, `Active`, timestamps.

## Repair_Tracking / Production_Tracking

Identical shape, one row per item that needs work.

| Column | Notes |
|---|---|
| `Repair_ID` / `Production_ID` | `REP-000001` / `PRD-000001` |
| `Return_ID` / `Return_Item_ID` | Links back to the ledger |
| `Product_ID` / `SKU` / `Product_Name` | |
| `Quantity_Sent` | Mirrors `Repair_Qty` / `Production_Qty` |
| `Date_Sent` | Drives the ageing calculation |
| `Repair_Status` / `Production_Status` | Pending → In progress → Completed |
| `Completed_Qty` | Never allowed above `Quantity_Sent` |
| `Pending_Qty` | Always `Quantity_Sent − Completed_Qty`, written by the server |
| `Completion_Date` / `Assigned_To` / `Remarks` | |
| `Created_At` / `Updated_At` / `Active` | |

## Return_Photos

`Photo_ID` (`PHO-0000001`), `Return_ID`, `Return_Item_ID`, `Product_ID`, `Condition_Tag`, `Caption`, `File_ID`, `Thumb_File_ID`, `Mime_Type`, `Size_Bytes`, `Uploaded_By`, `Uploaded_At`, `Active`.

The image itself is not here. `File_ID` and `Thumb_File_ID` point at two files in a private Drive folder — a full image and a thumbnail, both produced by the browser before upload. A spreadsheet cell tops out well below the size of a photograph, and a sheet carrying a few hundred base64 images becomes unusable.

`Condition_Tag` records what the photo documents: `OK`, `Repair`, `Damaged` or `General`. It is resolved when the photo is uploaded rather than when it is taken, because people photograph the damage first and classify it afterwards.

Deleting a photo sets `Active` to `FALSE` and moves the Drive files to the bin, where they can still be recovered.

## Timeline

`Event_ID`, `Return_ID`, `Return_Item_ID`, `Event`, `Event_At`, `User`, `Notes`.

Events: Return received, Inspection completed, Sent to repair, Repair started, Repair completed, Sent to production, Production started, Production completed, Photo added, Photo removed, Quantities corrected, Return completed, Return cancelled.

## Audit_Log

`Audit_ID`, `Timestamp`, `User`, `Action`, `Module`, `Record_ID`, `Field_Name`, `Old_Value`, `New_Value`, `Session`, `Remarks`.

Actions: `CREATE`, `UPDATE`, `DELETE`, `STATUS_CHANGE`, `LOGIN`, `LOGOUT`. Field-level changes are written one row per changed field, so a correction reads as a before and after. Failed sign-ins and role-blocked calls are logged too.

## Sessions

`Token`, `Employee_ID`, `Username`, `Role`, `Created_At`, `Expires_At`, `Active`.

Tokens are two concatenated UUIDs and expire after `CONFIG.SESSION_HOURS` (default 12). Validated sessions are mirrored into `CacheService` so most requests avoid a sheet read.

## Counters

`Counter_Key`, `Last_Value`. Incremented inside a script lock so two people saving at the same moment cannot produce the same ID. Return IDs use a per-day key, so the sequence restarts each day.

## Dashboard_Data

`Snapshot_Date`, `Scope`, `Return_Txns`, `Return_Qty`, `OK_Qty`, `Repair_Qty`, `Damaged_Qty`, `Production_Qty`, `Generated_At`.

Written only by `snapshotDashboard()`. The dashboard does not read it — every figure on screen is computed live from `Return_Items`. Nothing in this sheet is ever entered by hand.

---

## Working in the sheet directly

Reading and filtering by hand is fine. Editing is not recommended: quantity changes made in the sheet bypass validation, skip the audit trail and leave the tracking sheets out of step. Use the Correct action in the app instead, which records what changed and why.

If you do edit manually, run **Admin → Data quality** afterwards. It checks for quantity mismatches, production exceeding damage, over-completion, orphan items, duplicate IDs, unknown products or sources, invalid employees and invalid dates.
