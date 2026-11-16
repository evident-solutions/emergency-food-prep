# Emergency Food Prep Web App: Requirements

This is the build brief for Emergency Food Prep (formerly Survival Plan), a personal web app. Hand it directly to a developer or AI coding assistant. Anything not listed is out of scope for version 1.

**Revision history**

| Version | Change |
|---|---|
| 1.0 | Initial brief. |
| 1.1 | Added **Spreadsheet import**. A CSV/TSV file or cells pasted from Excel, Google Sheets or Numbers is mapped onto the stock table by header name. Preview, add-or-replace modes, a CSV template, and the column aliases are specified below. |
| 1.2 | Spreadsheet import lives on the **Plan** tab with the stock table (not under Settings). Accepts **Excel .xlsx** as well as CSV/TSV. JSON backup sits with the stock table. Settings is only plan settings and quotas. |
| 1.3 | Plan opens with a visible **Import a spreadsheet** card above the adequacy summary, plus the header and Stock buttons. Settings points back to Plan for import and backup. |
| 1.4 | Optional **linked JSON file** on disk. `localStorage` stays the live, offline store. Chromium browsers can keep a user-owned file in sync after each save. Other browsers keep one-shot Export JSON. |
| 1.5 | Removed the Plan-top **Import a spreadsheet** card (header + Stock already provide import). Sticky header also has **Add item** so a row can be added without scrolling to Stock. |
| 1.6 | Product name is **Emergency Food Prep**. The first tab is **Emergency Stock** (internal id remains `plan`). |
| 1.7 | Calories per unit are 0 to 100,000. Visitor-facing backup and spreadsheet wording: **Backup or restore my data**, **Download backup**, **Restore backup**, **Download blank spreadsheet**. The backup file is still JSON. A blank spreadsheet is still a `.csv` file. |

## Problem

People who stockpile emergency food struggle to tell whether it is enough. Calories, protein and quantities vary by item, and expiration dates are easy to forget. The result is false confidence, over-buying, or wasted food.

## Solution

The user enters the food they have. The app compares it with daily calorie and protein quotas for a chosen number of days and people, then shows:

- Whether the stock is sufficient.
- The size of any gap, per category and for protein.
- A shopping list to close the gap.
- Items nearing expiration, so stock can be rotated.

User: one person managing food for a household. No accounts, login or sharing.

## Inputs

### Plan settings

| Setting | Default | Range |
|---|---|---|
| Days to cover (D) | 30 | 1 to 365 |
| Number of people (P) | 2 | 1 to 20 |
| Expiration warning window (days) | 30 | 1 to 365 |

### Stock table

Each row is one product. Enter calories and protein for the whole container (per-serving value times servings per container). Different flavors or sizes are separate rows.

| Field | Type | Rules |
|---|---|---|
| Item name | Text | Required, 1 to 100 characters |
| Category | Dropdown | Required, one of the five categories below |
| Calories per unit | Number | Required, 0 to 100,000 |
| Protein per unit (g) | Number | Required, 0 to 500 |
| Quantity | Whole number | Required, 0 to 9,999 |
| Expiration date | Date | Required, valid date |

Example row: Black beans, Beans and proteins, 350 cal, 20 g protein, quantity 12, expires 2028-03-01.

If an item with the same name already exists in the same category, warn the user and offer to edit the existing row instead.

### Spreadsheet import (added in 1.1)

Many users already track their stock in a spreadsheet. They must be able to import it instead of retyping every row.

**Accepted input**

- **Excel workbook** (`.xlsx`, `.xlsm`): the first worksheet is read. Date cells and Excel serial day numbers in the expiration column are converted to `YYYY-MM-DD`. Older `.xls` files, Numbers (`.numbers`) and OpenDocument (`.ods`) are not read. The message tells the user to save as an Excel workbook (`.xlsx`) or as CSV (Comma delimited), or to paste the cells. The file picker is labeled **Choose a spreadsheet**. The help under it names the extensions `.xlsx` and `.csv`.
- **CSV** (`.csv`) or **tab-separated text** (`.tsv`, `.txt`). Comma, semicolon and tab delimiters are detected automatically. Quoted fields and Windows or Mac line endings must be handled. Files are read as **UTF-8** (a leading byte-order mark is stripped).
- **Pasted cells**: the user can copy a range from Excel, Google Sheets or Numbers and paste it into a text area. Pasted cells arrive tab-separated and are treated like a CSV/TSV file.

**Required columns**

The first non-empty row is the header row. Columns are matched by header text, case-insensitively, ignoring punctuation and surrounding whitespace, and may appear in any order. Extra columns are ignored.

| Stock field | Canonical header | Also accepted |
|---|---|---|
| Item name | `Item Name` | `Name`, `Item`, `Product` |
| Category | `Category` | `Cat`, `Type`, `Group` |
| Calories per unit | `Calories per Unit` | `Calories`, `Cal`, `kcal`, `Calories per Container` |
| Protein per unit (g) | `Protein per Unit (g)` | `Protein`, `Protein (g)`, `Protein g`, `Protein per Container` |
| Quantity | `Quantity` | `Qty`, `Count`, `Units`, `Amount` |
| Expiration date | `Expiration Date` | `Expiration`, `Expires`, `Expiry`, `Exp`, `Best By`, `Use By`, `Best Before` |

If any of the six columns cannot be found, the import stops and the message lists the missing columns and the headers that were found.

**Cell parsing**

- *Category*: matched case-insensitively against the five category names, with `&` treated as `and` and punctuation ignored. Common short forms are accepted: `Starches`, `Grains`, `Beans`, `Proteins`, `Protein`, `Fat`, `Produce`, `Fruits`, `Vegetables`, `Morale`, `Flexible`. Anything else is an error for that row.
- *Numbers*: thousands separators, surrounding whitespace, and trailing units such as `cal`, `kcal` or `g` are stripped before the normal range checks apply. Quantity must be a whole number.
- *Dates*: accepted formats are `YYYY-MM-DD` (preferred), `YYYY/MM/DD`, `M/D/YYYY`, `M/D/YY`, `M-D-YYYY`, `D-Mon-YYYY` (e.g. `1-Mar-2028`), and `Mon D, YYYY` (e.g. `Mar 1, 2028`). Two-digit years are read as 20YY. Slash or dash dates with a leading day (`D/M/YYYY`) are **not** supported; an ambiguous value such as `3/1/2028` is always read as month/day. An Excel serial day number (about 20,000 to 80,000) in the expiration column is also accepted.
- Completely empty rows are skipped. A row that fails validation (the same rules as the entry form) is reported with its row number and reason and is **not** imported; valid rows still import.

**Import modes**

| Mode | Behaviour |
|---|---|
| Add to current stock (default) | Imported rows are added. A row whose name and category match an existing item (case-insensitive) **updates** that item's calories, protein, quantity and expiration date instead of creating a duplicate. |
| Replace current stock | All existing stock rows are deleted and the imported rows take their place. Requires confirmation: "This will replace all N current stock items. Continue?" |

Spreadsheet import never changes plan settings, quotas or the essentials checklist. **Download backup** and **Restore backup**, under **Backup or restore my data** on Emergency Stock, are how the user copies everything. Those controls are not on the Settings tab.

**Preview before import**

After the file is read or text is pasted, the app shows:

1. The detected column mapping (which spreadsheet header feeds which stock field).
2. A row-by-row preview with the parsed values and a result for each row: `New`, `Updates existing`, or `Error: reason`.
3. Counts: rows to import, rows that will update existing items, rows skipped with errors.

Nothing is saved until the user presses the import button, which states the count ("Import 14 items"). The button is disabled when no row is valid.

**Template**

**Download blank spreadsheet** provides a `.csv` file with the six canonical headers and the example row, so users who start from scratch produce a compatible sheet. The button does not say CSV.

## Reference Quotas

Quotas are per person per day and are editable settings. A "Reset to defaults" button restores the values below. Changes recalculate everything immediately.

| Category | Calories |
|---|---|
| Starches and grains | 850 |
| Beans and proteins | 500 |
| Fats | 400 |
| Fruits and vegetables | 200 |
| Flexible / morale | 200 |
| **Total** | **2,150** |

| Other quota | Default |
|---|---|
| Protein minimum | 50 g |
| Protein target | 70 g (midpoint of a 60 to 80 g range) |
| Water | 1 gallon |

The 2,150 total includes a small buffer above a 2,000-calorie baseline. These are general guidelines for moderately active adults, not medical advice.

## Essentials Checklist

A fixed checklist the user ticks off, saved with the other data:

- Manual can opener.
- Cooking heat source and fuel.
- Water filter or purification tablets.
- Multivitamins (one per person per day, so D times P).
- Water storage containers.

Unticked items appear on the shopping list.

## Calculations

D is days and P is people. Only non-expired items count toward stock. An item is expired if its expiration date is before today.

| Value | Formula |
|---|---|
| Required calories, per category | Category quota times D times P |
| Required calories, total | 2,150 times D times P |
| Required protein | Minimum (50) or target (70) times D times P |
| Required water | 1 gallon times D times P |
| Stock calories, per category | Sum of calories per unit times quantity |
| Stock protein | Sum of protein per unit times quantity |
| Gap | Required minus stock, never below zero |
| Calorie days of coverage | The lowest category value of stock calories divided by (category quota times P), rounded down |
| Protein days of coverage | Stock protein divided by (70 times P), rounded down |
| Percent covered | Stock divided by required, capped at 100%. Protein uses the target |

Calorie days of coverage uses the weakest category so that a surplus in one category cannot hide a shortage in another. An empty stock table gives zero days.

Verdict: **Sufficient** when every category calorie gap is zero and the protein gap against the minimum is zero. Otherwise **Not sufficient**. Two notes appear when relevant:

- Protein meets the minimum but not the target: "Protein meets the minimum but falls short of the recommended target."
- Expired items exist: a warning that they are excluded from the totals.

Progress colors:

| Percent covered | Label |
|---|---|
| 100% | Covered |
| 80 to 99% | Close |
| Below 80% | Short |

Every bar must show the percentage and label as text. Use a color-blind-safe palette, for example blue, amber and dark red, and never rely on color alone.

## Screens and Outputs

### Main screen, top to bottom

1. **Sticky header actions**: **Add item** and **Import spreadsheet** stay visible while scrolling, plus **Print / Save as PDF**. Emergency Stock does not repeat import in a card above the adequacy summary.
2. **Empty state**: with no items, show zero stock, full gaps and the message "Add your first item or import a spreadsheet to get started."
3. **Adequacy summary**: the verdict, days of coverage for calories and protein, a table of required, in stock, gap and progress bar for each category, a protein row against both minimum and target, and a water reminder ("You need D times P gallons of water. Water is not tracked in the stock table.").
4. **Expiring-soon panel**: items expiring within the warning window, sorted by fewest days left. Show name, category, expiration date and days remaining, with the prompt "Rotate these items: use them soon and replace with fresh stock." If none, show "No items expiring soon" and collapse the panel.
5. **Expired panel**: items past their date, labeled "Expired, excluded from all calculations", each with Delete and Update buttons. Hide the panel when empty.
6. **Stock table**: all items with columns for name, category, calories, protein, quantity, expiration and status (Good, Expiring soon, Expired). Expired rows are muted with strikethrough and an "Expired" badge. Sortable by any column, defaulting to category, then expiration date oldest first. Each row has Edit and Delete. **Import spreadsheet** and **Add item** are also on the Stock heading. Above the table: "Import a spreadsheet, or add items one by one." An empty table says "No items yet. Use Import spreadsheet, or Add item to enter one product." A **Backup or restore my data** disclosure under the table holds **Download backup**, **Restore backup**, **Download blank spreadsheet**, and the optional file on this computer.

### Shopping list tab

- For each category with a calorie gap, show the gap and the alternatives the user already stocks: "about N more [item]", where N is the gap divided by the item's calories, rounded up. These are alternatives, not a combined purchase.
- If a category has no items, show the gap and "Add an item in this category to get a quantity suggestion."
- If protein is short, show the gap in grams against the minimum and the target, with quantity suggestions from Beans and proteins items, or a note to add protein-dense items such as canned tuna, chicken or beans.
- Show the water total and any unticked essentials.

### Settings tab

**Plan settings**, all quotas, and a "Reset all to defaults" button. Changes save immediately. A short note at the top points to Emergency Stock for spreadsheet import, a backup file, and the optional file on this computer. The note does not say JSON or CSV.

### Print view

A "Print / Save as PDF" button, or print styles, that gives a clean page with the adequacy summary, shopping list and expiring-soon list, without interactive controls.

## Reminders

- Version 1: the on-screen expiring-soon panel. A web page can only run checks while it is open, so this is the reliable baseline.
- Optional upgrade: download an .ics calendar file with a reminder set one warning window before expiration, so the phone alerts the user even when the app is closed.
- Optional upgrade: browser notifications, with permission, while the app is open or running in the background.

Design the code so these upgrades can be added without refactoring.

## Functional Requirements

- Add, edit, delete and sort stock rows.
- Import stock rows from a spreadsheet (`.xlsx`, `.csv`, or `.tsv`) or pasted cells, with header mapping, per-row validation, a preview, and add-or-replace modes, as described under **Spreadsheet import**. The control is labeled **Import spreadsheet** and sits on the Emergency Stock tab with the stock table.
- Recalculate all totals, gaps, verdicts and progress bars instantly on any change.
- Save all data (stock, settings, quotas, checklist) in local storage with a schema version number. If storage is unavailable, show a persistent banner: "Data cannot be saved in this browser session. Download a backup before you close this page."
- **Download backup** saves all data as one timestamped `.json` file. **Restore backup** loads that file after confirming: "This will replace all current data. Continue?" The buttons do not say JSON. A file the app cannot read is reported as "That file is not a backup from this app."
- **Linked backup file (1.4)**: on browsers that support the File System Access API, the user can create or open a backup file on disk. The help text is: "Choose a file on this computer. After that, every change updates that file too. The app also keeps a copy in this browser, so it still works offline." The browser copy in local storage remains the live store and is what the app reads on launch and when offline. After a file is linked and write permission is granted, every successful save also overwrites that file with the same document as Download backup. Opening an existing file replaces the browser copy after confirm, then keeps the file linked. "Stop linking" forgets the handle and does not delete the file. If permission is only a prompt after a reload, show the file name and a "Write now" action that requests permission. If the API is missing (typical on iOS Safari), hide the link controls and tell the user to download a backup after big changes. The service worker is unchanged: it caches app files only.
- Validate on save and show inline errors for empty required fields, negative numbers, values over the maximums and invalid dates.

## Non-Functional Requirements

- Single-page app built with plain HTML, CSS and JavaScript. No server, account, payment, framework or build tools. Spreadsheet parsing is implemented in the app itself; no third-party parsing library.
- Mobile-first, fully usable from 320 px wide, with a base font of at least 16 px.
- Accessible: keyboard navigable, WCAG AA contrast, descriptive alt text, and color never the only indicator.
- Works offline once loaded, using a service worker that caches the app files. This is required because the app may be needed when the internet is down.

## Out of Scope for Version 1

- Multiple users or shared accounts.
- Barcode scanning, nutrition lookup, or price comparison.
- Tracking water, medications or other non-food supplies beyond the essentials checklist.
- Individual needs such as age, weight, allergies or special diets. All people are assumed to be moderately active adults with the same needs.
- Native iOS or Android apps.
- Parsing older Excel `.xls` files, Numbers (`.numbers`) or OpenDocument (`.ods`) workbooks, live links to online spreadsheets, and exporting the stock table back to a spreadsheet.

## Assumptions

- The user reads calories and protein from each product's nutrition label.
- Rotation means eating the oldest items first and replacing them with newer ones. The default sort supports this.
- Spreadsheets to be imported use one row per product, a header row, and month-first dates when written with slashes.

## Suggested Build Prompt

Build a single-page, mobile-first web app called Emergency Food Prep that meets the requirements in this document. Use plain HTML, CSS and JavaScript. Persist data in local storage with a schema version number, and register a service worker so the app works offline. The main screen (Emergency Stock) shows the adequacy summary, expiring-soon panel, expired panel and stock table. Add separate tabs for the shopping list and settings, plus print styles. Put spreadsheet import on the Emergency Stock tab with the stock table. Organize the code in modules so calendar export and notifications can be added later without refactoring.
