# Emergency Food Prep

A single-page app that compares a household's emergency food stock with daily calorie and protein quotas. It reports whether the stock is enough, which food group runs out first, what to buy, and which items are near expiration.

There is no account and no backend. The user's data stays in the browser. The repository is the site: plain HTML, CSS, and JavaScript modules, with no build step and no dependencies.

The product rules live in [REQUIREMENTS.md](REQUIREMENTS.md). This file is the map of the code.

## Run it locally

ES modules and the service worker need `http` or `https`. Opening `index.html` from the file system will not load the app.

From this folder:

```powershell
python -m http.server 8080
```

Then open http://localhost:8080/. The first visit may reload once while an old service-worker cache is cleared.

`npx serve` from the same folder works too. Use the same origin every time. A different port is a different site, with its own empty stock and settings.

## Layout

| Path | Role |
|---|---|
| `index.html` | The three tabs, the item dialog, the import dialog, and a one-time recovery script that drops a stuck service worker |
| `css/styles.css` | Layout, status colors, and print styles |
| `js/app.js` | Controller. Holds state, wires events, and calls `commit()` on every change |
| `js/calculations.js` | Pure report, shopping list, sort, and duplicate detection. No DOM and no storage |
| `js/defaults.js` | Categories, default quotas, essentials, and the state shape |
| `js/dates.js` | Local `YYYY-MM-DD` dates and the import date formats |
| `js/validation.js` | Checks for the form and for stored or imported items |
| `js/storage.js` | `localStorage` load, save, migrate, and JSON export |
| `js/spreadsheet.js` | CSV, TSV, and pasted cells. Header aliases, preview, add or replace |
| `js/xlsx.js` | First-sheet `.xlsx` / `.xlsm` reader. No library |
| `js/backupFile.js` | Optional linked JSON file. The handle is stored in IndexedDB |
| `js/ui.js` | Renders the report into the page. Escapes text before inserting HTML |
| `js/reminders.js` | Builds reminder events and defines a provider interface. Nothing registers a provider |
| `sw.js` | Caches the app shell, network-first |
| `manifest.webmanifest` | Install name and standalone display. The only icon is `icon.svg` |

`index.html` loads `js/app.js` as a module. The other modules are imported from there.

## How a change moves through the app

One state object lives in memory. `commit()` in `js/app.js` applies a mutation, writes the state, and re-renders.

`computeReport()` in `js/calculations.js` drops expired items, totals calories for five categories, and compares protein with a minimum and a target. Days of calorie coverage are the weakest category, so a surplus in one group cannot hide a shortage in another. `buildShoppingList()` turns a gap into "about N more" of an item already in stock. Each suggestion is an alternative, not a combined purchase.

The categories are starches and grains, beans and proteins, fats, fruits and vegetables, and flexible / morale. Water is an essentials reminder. It is never a stock row. Quotas are per person per day and are labeled as guidelines, not medical advice.

## Where data lives

Three browser stores, each with one job:

- **`localStorage` key `survival-plan`** is the saved data: stock, settings, quotas, and the checklist. Schema version is 1. The key still says `survival-plan` because the app was renamed from Survival Plan in requirements revision 1.6. Old data stays readable. `js/storage.js` repairs or drops bad records on load.
- **Cache Storage `survival-plan-v9`** holds copies of the app files so the page can open offline. The service worker in `sw.js` is network-first: a refresh picks up new files when the server is up, and a failed network request falls back to the cache. User data is not in this cache.
- **IndexedDB `survival-plan-backup`** stores the handle of an optional JSON file on disk (Chromium File System Access API). That saved data is still read from `localStorage` on launch. A save overwrites the file only when write permission is already granted.

`localStorage` key `survival-plan-build` is a build stamp (`9`). It is not the saved data. The inline script in `index.html` uses it to unregister a stuck worker and delete `survival-plan-*` caches when the stamp does not match.

There is no server in this repository. GitHub Pages, or any static file host, can publish the folder. Add an empty `.nojekyll` file before publishing on GitHub Pages so GitHub copies these files as they are. The published site is the program. Each visitor's data stays in their own browser for that exact address.

## Spreadsheets

`js/spreadsheet.js` maps headers by alias, validates each row with the same rules as the form, and writes nothing until the user confirms. Add mode updates an item with the same name and category. Replace mode replaces stock only. Settings, quotas, and the checklist are untouched.

`js/xlsx.js` reads the first worksheet of `.xlsx` or `.xlsm`: stored cell values, shared strings, and date number formats, inflated with `DecompressionStream`. It does not handle ZIP64, encryption, compression other than store or deflate, or formula cells with no cached value. `.xls`, Numbers, and ODS are rejected. The user can save as `.xlsx` or CSV, or paste cells. Pasted dates accept several formats. Slash dates are month-first.

## Offline and updates

`registerServiceWorker()` in `js/app.js` registers `./sw.js?v=9` on `http:` and `https:` only. After one successful load, that origin can open from the cache with the file server stopped.

When you change an app file, bump the version in all of these together: `CACHE_VERSION` in `sw.js`, `BUILD` in the inline script in `index.html`, the `?v=9` query on the stylesheet and module script, and the `./sw.js?v=9` registration. The network-first worker updates the cache on a successful fetch. The build stamp is what clears a worker stuck on an old copy.

## Not built yet

Version 1 ships the on-screen expiring-soon panel. `js/reminders.js` can describe a calendar event and a notification provider, and no provider is registered. A page can only check dates while it is open.

There is no test suite and no `package.json`. `computeReport()`, the date parser, the CSV parser, and import apply are pure functions and are the first place to add tests.

Calendar export, browser notifications, accounts, barcode lookup, price comparison, water-as-inventory, and exporting the stock table back to CSV are out of scope for version 1. See [REQUIREMENTS.md](REQUIREMENTS.md).
