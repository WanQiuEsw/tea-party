**English** | [中文](./README.md)

# Tea Party Wheel

A tiny tea-drink lucky wheel with login, SQLite persistence and a minimal admin panel.

## Features

- **Spinning wheel**: every drink is a sector on a Canvas wheel; the result is decided by price-weighted odds.
- **Inverse-price odds**: weight = `1 / price^1.5`, so cheaper drinks are more likely. The full odds list is shown publicly below the wheel, colored to match the sectors.
- **Login**: the page signs in as `user` automatically; use “切换账号” in the header to log in as `ping` or the admin.
- **Admin panel**: add drinks, edit reference prices, delete drinks, and view every user's draw history.
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
