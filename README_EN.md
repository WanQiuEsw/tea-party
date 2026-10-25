**English** | [中文](./README.md)

# Tea Party Wheel

A tiny tea-drink lucky wheel with login, SQLite persistence and a minimal admin panel.

## Features

- **Spinning wheel**: every drink is a sector on a Canvas wheel; the result is decided by price-weighted odds.
- **Scratch cards**: standalone classic cards reveal at 40% scratched, with touch, mouse and one-click reveal.
- **Lucky Numbers**: a standalone sixth mode, with one lucky number and 15 positions across five rows. One match awards a prize or retry; reveal at 90% scratched. Lucky number, ticket numbers and ticket ID stay fixed when scratching begins; only the server-selected prize is bound. Reveal a started ticket before switching modes. Previews cost no attempt.
- **Lucky Shake**: the server draws one outcome, then all three reels stop on that same prize or retry. Lever, button and opt-in phone motion are supported.
- **Shared odds**: all modes award a prize with 97% probability and a retry with 3%; no blank outcomes. Prize weights are `1 / reference price`. The server selects and immediately records prizes; clients cannot specify the winning prize.
- **Unlimited draws, one daily reward**: all accounts (including admin) can redraw until today’s reward is redeemed. Redrawing a held reward requires explicit confirmation; cancellation preserves it. Confirming forfeits it even if the next outcome is a retry. Only one reward per Beijing calendar day is retained; previous days’ pending rewards remain available.
- **My Rewards**: redeem all pending rewards in one action, moving them to redeemed history. Today’s redemption locks draws until the next day. Server transactions reject stale replacements, duplicate redemptions and another account’s reward IDs. Migration converts only today’s latest legacy win per account into a redeemable reward, leaving older records as history.
- **Diamond styling**: only the existing diamond tier (reference price ¥16+) receives champagne gold and a subtle pearlescent tint, without looping shine.
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

Run `node --test tests/game-rules.test.cjs tests/inventory.test.cjs tests/quota.test.cjs` for probability and card-generation checks, including 100,000 draws and single/empty menus.

With Playwright and Chrome available, run `node tests/game-flow.cjs` (`NODE_PATH` can point to an existing Playwright installation; set `TEA_BROWSER=msedge` for Edge). It uses an isolated temporary app/database and tests all six modes, stable numbers before and after scratching, retry continuation, pointer scratching, history, replacement confirmation, cancellation, batch redemption, and mobile layout. Physical phone sensors still need device testing.
