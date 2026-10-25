**English** | [中文](./README.md)

# Tea Party Wheel

A tiny tea-drink lucky wheel with login, SQLite persistence and a minimal admin panel.

## Features

- **Spinning wheel**: every drink is a sector on a Canvas wheel; the result is decided by price-weighted odds.
- **Scratch cards**: classic reveal, character matching, and a number ticket with 15 rows: numbers on the left, prizes and reference values on the right. Each ticket has 1–3 lucky numbers and can award multiple prizes, saved individually. Blank tickets never match. The initial blank/retry probabilities remain unchanged; ordinary winning tickets draw extra numbers using the existing weights, with special outcomes adding no extra prize. Number tickets reveal at 90% scratched; other cards at 40%. Touch, mouse, and one-click reveal are supported.
- **Lucky slots**: one lever pull, button press, or opt-in phone shake spins each reel in order. Each reel stops before the next starts; the result appears after the third stops. Three matching drinks win. Clicking remains available if motion is unsupported or permission is denied.
- **Shared odds**: 20% blank, 3% retry, 77% drinks. Drink weight is `1 / reference price`; expensive drinks remain rarer. The complete odds are disclosed in the page and refresh when prices change. Only drink wins enter drink history.
- **Login**: the page signs in as `user` automatically; use “切换账号” in the header to log in as `ping` or the admin.
- **Admin panel**: add, edit, and delete general prizes (tea, gifts, etc.), with a required name and reference value plus optional brand/source and notes. Values range from ¥0.01 to ¥1,000,000, with two decimal places. Existing tea data and draw records remain compatible.
- **CSV import/export**: download a blank template or export the current list. Fill the template in Excel/WPS and save as CSV UTF-8 (not XLSX), then preview and confirm the import. Matching brand/source and name are skipped without overwriting; validation failures reject the entire batch. Up to 100 prizes total, 1–100 rows per import, and 250 KB per file.
- **SQLite storage**: drinks and draw records are persisted in `tea.db` via Node's built-in `node:sqlite`; no npm dependencies.
- **Mobile friendly**: single-column layout on phones, scrollable tables, 44px touch targets.

## Run

Requires **Node.js 24+** (for `node:sqlite`).

```bash
node server.js
```

Open <http://localhost:3000>.

| Role  | Username | Password   |
| ----- | -------- | ---------- |
| User  | `user`   | `123456`   |
| User  | `ping`   | `123456`   |
| Admin | `admin`  | `admin123` |

After logging in as admin, the admin sections appear below the wheel and odds list.

## Notes

- `tea.db` is created automatically on first run and seeded once with 23 drinks; clearing the list will not bring them back.
- Sessions live in memory. After a restart the default `user` signs in automatically; `ping` and the admin need to log in again.
- `index.html` is loaded at startup; restart the server after editing it.
- Set a different port with `PORT=3001 node server.js`.
- Phone motion requires a supported browser and a secure context (HTTPS or localhost); shake strength never changes the odds.

## Validation

Run `node --test tests/game-rules.test.cjs tests/inventory.test.cjs` for probability and card-generation checks, including 100,000 draws and single/empty menus.

With Playwright and Chrome available, run `node tests/game-flow.cjs` (`NODE_PATH` can point to an existing Playwright installation; set `TEA_BROWSER=msedge` for Edge). It uses an isolated temporary app/database and tests wins, blanks, retries, pointer scratching, lever/keyboard/synthetic motion, duplicate clicks, history, existing modes, and mobile layout. Physical phone sensors still need device testing.
