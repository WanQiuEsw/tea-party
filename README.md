# 一口好运 · 奶茶随机转盘 / Tea Party Wheel

A tiny tea-drink lucky wheel with login, SQLite persistence and a minimal admin panel.

一个零依赖的奶茶随机转盘：登录后转盘抽奶茶，管理员可在后台维护饮品清单并查看抽奖记录。

[English](#english) | [中文](#中文)

---

## English

### Features

- **Spinning wheel**: every drink is a sector on a Canvas wheel; the result is decided by price-weighted odds.
- **Inverse-price odds**: weight = `1 / price^1.5`, so cheaper drinks are more likely. The full odds list is shown publicly below the wheel, colored to match the sectors.
- **Login required**: two fixed accounts, one normal user and one admin.
- **Admin panel**: add drinks, edit reference prices, delete drinks, and view every user's draw history.
- **SQLite storage**: drinks and draw records are persisted in `tea.db` via Node's built-in `node:sqlite`; no npm dependencies.
- **Mobile friendly**: single-column layout on phones, readable tables, 44px touch targets.

### Run

Requires **Node.js 24+** (for `node:sqlite`).

```bash
node server.js
```

Open <http://localhost:3000>.

| Role  | Username | Password |
| ----- | -------- | -------- |
| User  | `user`   | `123456` |
| Admin | `admin`  | `admin123` |

After logging in as admin, the admin sections appear below the wheel and odds list.

### Notes

- `tea.db` is created automatically on first run and seeded once with 23 drinks; clearing the list will not bring them back.
- Sessions live in memory, so restarting the server requires logging in again.
- `index.html` is loaded at startup; restart the server after editing it.
- Set a different port with `PORT=3001 node server.js`.

---

## 中文

### 功能

- **随机转盘**：每款奶茶对应一个扇区，抽奖结果按价格加权计算。
- **价格反向概率**：权重 = `1 / 价格^1.5`，越便宜越容易抽中。转盘下方公开展示完整概率列表，颜色与扇区一致。
- **登录使用**：仅两个固定账号，一个普通用户、一个管理员。
- **管理员后台**：新增饮品、修改参考价、删除饮品，查看所有用户的抽奖记录。
- **SQLite 存储**：饮品与抽奖记录保存在 `tea.db`，使用 Node 内置 `node:sqlite`，无需安装任何依赖。
- **手机适配**：手机端单列布局，表格可横向滚动，触控按钮不小于 44px。

### 运行

需要 **Node.js 24+**（内置 `node:sqlite`）。

```bash
node server.js
```

打开 <http://localhost:3000>。

| 角色   | 账号    | 密码       |
| ------ | ------- | ---------- |
| 普通用户 | `user`  | `123456`   |
| 管理员  | `admin` | `admin123` |

管理员登录后，页面下方会出现「管理饮品清单」与「用户抽奖记录」两个区域。

### 说明

- 首次启动自动创建 `tea.db` 并写入 23 款奶茶；清空清单后重启不会自动恢复。
- 会话保存在内存中，重启服务需重新登录。
- `index.html` 在启动时读入内存，修改页面后需重启服务。
- 换端口启动：`PORT=3001 node server.js`。
