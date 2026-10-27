**English** | [中文](./README.md)

# Make a Choice · Random decision selector

A general decision tool with no runtime dependencies. Add options for drinks, food, activities or any other choice, then let the browser pick fairly.

## Run

Requires Node.js 24+. Run `node server.js` and open <http://localhost:3000>.

Visitors use the app without an account. Open the custom list dialog, enter arbitrary options such as Coffee and Milk tea, and save. Multiple lists support renaming, removal and deletion. Public catalog items can also be added. Custom items need no brand or price and never display invented prices.

Seven modes remain available: wheel, flip cards, scratch card, lucky numbers, capsules, blind boxes and shake. Each option has an equal chance; selection uses browser Web Crypto randomness. The wheel supports up to 24 options; other modes still select from the complete list. Full animations and quick reveal are supported.

Personal lists, current selection, the latest 50 revealed results and preferences stay in browser storage. Results can be reviewed, copied and shared. Ordinary and demo accounts, shared draw history and the public winner ticker have been removed. Personal options and outcomes are never uploaded.

## Administration

Use the administrator entry in the header. Default login: `admin` / `admin123`.

The admin interface contains only public catalog management and anonymous completion statistics. Catalog tools include search, pagination, create/edit, single/bulk delete and CSV import/export. Existing CSV templates remain compatible, using `奖品名称,品牌/来源,参考价值,备注`. Imports accept 1–100 rows per batch, with 5,000 total items. Duplicate brand/name pairs are skipped; invalid batches are rejected atomically.

Statistics show today's and all-time totals, lifetime totals per mode and daily totals for the latest 30 dates with activity, using Beijing time. Only a random event ID and mode are sent after a result is revealed; the server assigns the date and deduplicates IDs. Previews, mode changes, unfinished scratch cards and result reviews do not count. Failed uploads display a message. Counts represent successfully reported completions, not unique visitors.

## Storage and upgrades

Public catalog data and anonymous statistics live in SQLite `tea.db`. Admin sessions live in memory and expire on restart. The HTML page is cached at startup, so restart the server after updating code. Set `PORT` to change the port.

On upgrade, startup removes ordinary/demo accounts, old draw history, personal lists, shop preferences and retired reward tables. Administrators and an already initialized public catalog remain. Old account data is not migrated to visitor browsers.

Local data belongs to the current browser and site origin. Clearing site data, private browsing or switching devices does not restore it. Storage failures prevent list saves and keep the dialog available for retry.

## Tests

```sh
node --test tests/*.test.cjs
node tests/selector-flow.cjs
```

Browser tests require Playwright and Chrome; use `NODE_PATH` for an existing installation or `TEA_BROWSER=msedge` for Edge. Tests use temporary directories and isolated databases. Coverage includes uniform probability, Beijing day boundaries, CSV validation/import, administrator permissions, legacy data cleanup, anonymous completion deduplication, all seven modes, local lists/results, browser isolation, storage failures, list renaming/deletion and 320/390/768/1280px layouts. Physical motion sensors need testing on a real phone.
