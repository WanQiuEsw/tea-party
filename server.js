const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const Inventory = require('./inventory.js');
const GameRules = require('./game-rules.js');
const PORT = Number(process.env.PORT) || 3000;
const PAGE = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
// shortcut: 页面只在启动时读入内存，修改 index.html 后需重启服务
const db = new DatabaseSync(path.join(__dirname, 'tea.db'));

db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'admin'))
);
CREATE TABLE IF NOT EXISTS drinks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand TEXT NOT NULL,
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  price REAL,
  UNIQUE (brand, name)
);
CREATE TABLE IF NOT EXISTS draws (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  drink_id INTEGER,
  brand TEXT NOT NULL,
  name TEXT NOT NULL,
  note TEXT,
  price REAL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_menus (
  user_id INTEGER NOT NULL,
  brand TEXT NOT NULL,
  excluded_ids TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (user_id, brand)
);
CREATE TABLE IF NOT EXISTS user_shops (
  user_id INTEGER PRIMARY KEY,
  brand TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS custom_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  drink_ids TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS selected_lists (
  user_id INTEGER PRIMARY KEY,
  list_id INTEGER NOT NULL
);

`);

if (!db.prepare('PRAGMA table_info(draws)').all().some(column => column.name === 'tier')) {
  db.exec('ALTER TABLE draws ADD COLUMN tier TEXT');
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

// 固定账号：测试账号、两个普通用户与一个管理员
const ACCOUNTS = [
  ['user', '123456', 'user'],
  ['ping', '123456', 'user'],
  ['admin', 'admin123', 'admin'],
  ['demo', crypto.randomBytes(24).toString('hex'), 'user'],
];
// 固定账号：每次启动同步密码，已有数据库（如旧密码）也会自动更新
for (const [username, password, role] of ACCOUNTS) {
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare(
    'INSERT INTO users (username, password, role) VALUES (?, ?, ?) ON CONFLICT(username) DO UPDATE SET password = excluded.password, role = excluded.role'
  ).run(username, `${salt}:${hashPassword(password, salt)}`, role);
}

// Replace the previous menu once with the supplied price list; draw history stays intact.
if (!db.prepare("SELECT 1 FROM meta WHERE key = 'catalog_replace_20261026'").get()) {
  const catalog = require('./catalog.json').map(Inventory.normalize);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DELETE FROM user_menus; DELETE FROM user_shops; DELETE FROM drinks;');
    const insert = db.prepare('INSERT INTO drinks (brand, name, note, price) VALUES (?, ?, ?, ?)');
    for (const d of catalog) insert.run(d.brand, d.name, d.note, d.price);
    db.prepare("INSERT INTO meta (key, value) VALUES ('catalog_replace_20261026', '1')").run();
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
}

function menuFor(user) {
  return {
    brand: db.prepare('SELECT brand FROM user_shops WHERE user_id = ?').get(user.id)?.brand ?? null,
    menus: db.prepare('SELECT brand, excluded_ids FROM user_menus WHERE user_id = ?').all(user.id)
      .map(row => ({brand: row.brand, excludedIds: JSON.parse(row.excluded_ids)}))
  };
}

function listsFor(user) {
  const available = new Set(db.prepare('SELECT id FROM drinks').all().map(d => d.id));
  return {
    selectedId: db.prepare('SELECT list_id FROM selected_lists WHERE user_id = ?').get(user.id)?.list_id ?? null,
    lists: db.prepare('SELECT id, name, drink_ids FROM custom_lists WHERE user_id = ? ORDER BY id').all(user.id)
      .map(row => ({id: row.id, name: row.name, drinkIds: JSON.parse(row.drink_ids).filter(id => available.has(id))}))
  };
}

const sessions = new Map();
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

function json(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let chunks = [], size = 0, oversized = false;
    req.on('data', (chunk) => {
      if (oversized) return;
      chunks.push(chunk);
      size += chunk.length;
      if (size > 256000) {
        reject(new Error('请求内容过大'));
        oversized = true;
        chunks = [];
      }
    });
    req.on('end', () => {
      if (oversized) return;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('请求格式错误'));
      }
    });
    req.on('error', reject);
  });
}

function tokenOf(req) {
  const match = (req.headers.cookie || '').match(/(?:^|;\s*)tea_session=([^;]+)/);
  return match && match[1];
}

function currentUser(req) {
  const token = tokenOf(req);
  const session = token && sessions.get(token);
  if (!session) return null;
  if (session.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(session.userId) || null;
}

function setSession(res, userId) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { userId, expires: Date.now() + SESSION_TTL });
  return `tea_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`;
}

async function login(req, res) {
  const { username, password } = await readJson(req);
  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
    return json(res, 400, { error: '请输入账号和密码' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  if (!user) return json(res, 401, { error: '账号或密码不正确' });
  const [salt, stored] = user.password.split(':');
  const candidate = hashPassword(password, salt);
  if (!crypto.timingSafeEqual(Buffer.from(stored, 'hex'), Buffer.from(candidate, 'hex'))) {
    return json(res, 401, { error: '账号或密码不正确' });
  }
  const previousToken = tokenOf(req);
  if (previousToken) sessions.delete(previousToken);
  res.setHeader('Set-Cookie', setSession(res, user.id));
  return json(res, 200, { id: user.id, username: user.username, role: user.role });
}

function logout(req, res) {
  const token = tokenOf(req);
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', 'tea_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
  return json(res, 200, { ok: true });
}

const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;

    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(PAGE);
    }
    if (['/inventory.js', '/game-rules.js', '/fortune.js', '/flip.css', '/wheel.css', '/scratch.css', '/cover.css', '/result.css', '/assets/result-gift.webp', '/assets/scratch-cover.webp', '/assets/number-cover.webp', '/assets/flip-card-back.webp', '/assets/milk-tea-glass.webp'].includes(pathname) && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': pathname.endsWith('.css') ? 'text/css; charset=utf-8' : pathname.endsWith('.webp') ? 'image/webp' : 'text/javascript; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(__dirname, pathname.slice(1))));
    }
    if (!pathname.startsWith('/api/')) return json(res, 404, { error: '页面不存在' });

    if (pathname === '/api/me' && req.method === 'GET') {
      return json(res, 200, { user: currentUser(req) });
    }
    if (pathname === '/api/demo' && req.method === 'POST') {
      const demo = db.prepare("SELECT id, username, role FROM users WHERE username = 'demo'").get();
      const previousToken = tokenOf(req);
      if (previousToken) sessions.delete(previousToken);
      return json(res, 200, demo, {'Set-Cookie': setSession(res, demo.id)});
    }
    if (pathname === '/api/login' && req.method === 'POST') return await login(req, res);
    if (pathname === '/api/logout' && req.method === 'POST') return logout(req, res);

    const user = currentUser(req);
    if (!user) return json(res, 401, { error: '请先登录' });

    if (pathname === '/api/winners' && req.method === 'GET') {
      return json(res, 200, db.prepare(`SELECT d.id, d.brand, d.name, d.tier,
        CASE WHEN u.username = 'demo' THEN '体验用户' ELSE substr(u.username, 1, 1) || '**' END AS username
        FROM draws d JOIN users u ON u.id = d.user_id ORDER BY d.id DESC LIMIT 20`).all());
    }

    if (pathname === '/api/lists' && req.method === 'GET') return json(res, 200, listsFor(user));
    const listMatch = pathname.match(/^\/api\/lists\/(\d+)$/);
    if (pathname === '/api/lists' && req.method === 'POST' || listMatch && ['PUT', 'DELETE'].includes(req.method)) {
      if (user.role === 'admin') return json(res, 403, {error: '管理员不能设置个人清单'});
      const id = listMatch ? Number(listMatch[1]) : null;
      if (id !== null && !db.prepare('SELECT 1 FROM custom_lists WHERE id = ? AND user_id = ?').get(id, user.id))
        return json(res, 404, {error: '清单不存在'});
      if (req.method === 'DELETE') {
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('DELETE FROM custom_lists WHERE id = ? AND user_id = ?').run(id, user.id);
          db.prepare('DELETE FROM selected_lists WHERE user_id = ? AND list_id = ?').run(user.id, id);
          db.exec('COMMIT');
        } catch (err) { db.exec('ROLLBACK'); throw err; }
        return json(res, 200, listsFor(user));
      }
      const body = await readJson(req);
      if (!body || typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 30)
        return json(res, 400, {error: '请填写 1—30 字的清单名称'});
      if (!Array.isArray(body.drinkIds) || !body.drinkIds.length || body.drinkIds.length > 5000
          || new Set(body.drinkIds).size !== body.drinkIds.length || !body.drinkIds.every(Number.isSafeInteger))
        return json(res, 400, {error: '请选择饮品，同一款不能重复添加'});
      const available = new Set(db.prepare('SELECT id FROM drinks').all().map(d => d.id));
      if (!body.drinkIds.every(id => available.has(id))) return json(res, 400, {error: '饮品已变化，请刷新后重新选择'});
      if (id !== null && !db.prepare('SELECT 1 FROM custom_lists WHERE id = ? AND user_id = ?').get(id, user.id))
        return json(res, 404, {error: '清单已删除，请刷新后重试'});
      db.exec('BEGIN IMMEDIATE');
      try {
        let savedId = id;
        if (id === null) savedId = Number(db.prepare('INSERT INTO custom_lists (user_id, name, drink_ids) VALUES (?, ?, ?)').run(user.id, body.name.trim(), JSON.stringify(body.drinkIds)).lastInsertRowid);
        else db.prepare('UPDATE custom_lists SET name = ?, drink_ids = ? WHERE id = ? AND user_id = ?').run(body.name.trim(), JSON.stringify(body.drinkIds), id, user.id);
        db.prepare('INSERT INTO selected_lists (user_id, list_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET list_id = excluded.list_id').run(user.id, savedId);
        db.exec('COMMIT');
      } catch (err) { db.exec('ROLLBACK'); throw err; }
      return json(res, id === null ? 201 : 200, listsFor(user));
    }
    if (pathname === '/api/menu' && req.method === 'GET') return json(res, 200, menuFor(user));
    if (pathname === '/api/menu' && req.method === 'PUT') {
      const body = await readJson(req);
      if (!body || typeof body.brand !== 'string' || !Array.isArray(body.excludedIds)
          || body.excludedIds.length > 5000 || new Set(body.excludedIds).size !== body.excludedIds.length
          || !body.excludedIds.every(id => Number.isSafeInteger(id) && id > 0))
        return json(res, 400, {error: '清单格式错误'});
      const items = db.prepare('SELECT id FROM drinks WHERE brand = ?').all(body.brand);
      const ids = new Set(items.map(d => d.id));
      if (!items.length || !body.excludedIds.every(id => ids.has(id)))
        return json(res, 400, {error: '店铺或饮品已变化，请刷新后重试'});
      if (items.length - body.excludedIds.length < 1) return json(res, 400, {error: '至少保留 1 款饮品才能抽奖'});
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM selected_lists WHERE user_id = ?').run(user.id);
        db.prepare('INSERT INTO user_shops (user_id, brand) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET brand = excluded.brand').run(user.id, body.brand);
        db.prepare('INSERT INTO user_menus (user_id, brand, excluded_ids) VALUES (?, ?, ?) ON CONFLICT(user_id, brand) DO UPDATE SET excluded_ids = excluded.excluded_ids').run(user.id, body.brand, JSON.stringify(body.excludedIds));
        db.exec('COMMIT');
      } catch (err) { db.exec('ROLLBACK'); throw err; }
      return json(res, 200, menuFor(user));
    }

    if (pathname === '/api/drinks' && req.method === 'GET') {
      return json(res, 200, db.prepare('SELECT id, brand, name, note, price FROM drinks ORDER BY brand, name').all());
    }

    if (pathname === '/api/drinks/import' && req.method === 'POST') {
      if (user.role !== 'admin') return json(res, 403, { error: '只有管理员可以管理奖品' });
      const body = await readJson(req);
      if (!body || !Array.isArray(body.items) || !body.items.length || body.items.length > 100) return json(res, 400, {error: '每次请导入 1—100 条奖品'});
      let items;
      try { items = body.items.map((item, i) => { try { return Inventory.normalize(item); } catch (err) { throw Error('第 ' + (i + 1) + ' 条：' + err.message); } }); }
      catch (err) { return json(res, 400, {error: err.message}); }
      const existing = db.prepare('SELECT brand, name FROM drinks').all();
      const keys = new Set(existing.map(d => JSON.stringify([d.brand, d.name])));
      const fresh = items.filter(d => { const key = JSON.stringify([d.brand, d.name]); if (keys.has(key)) return false; keys.add(key); return true; });
      if (existing.length + fresh.length > 5000) return json(res, 400, {error: '清单最多配置 5000 款奖品，请减少导入数量'});
      db.exec('BEGIN');
      try {
        const insert = db.prepare('INSERT INTO drinks (brand, name, note, price) VALUES (?, ?, ?, ?)');
        for (const d of fresh) insert.run(d.brand, d.name, d.note, d.price);
        db.exec('COMMIT');
      } catch (err) { db.exec('ROLLBACK'); throw err; }
      return json(res, 201, {added: fresh.length, skipped: items.length - fresh.length, items: db.prepare('SELECT id, brand, name, note, price FROM drinks ORDER BY brand, name').all()});
    }
    if (pathname === '/api/drinks' && req.method === 'POST') {
      if (user.role !== 'admin') return json(res, 403, { error: '只有管理员可以管理奖品' });
      let item;
      try { item = Inventory.normalize(await readJson(req)); }
      catch (err) { return json(res, 400, {error: err.message}); }
      const {brand, name, note, price} = item;
      if (db.prepare('SELECT 1 FROM drinks WHERE brand = ? AND name = ?').get(brand, name)) return json(res, 409, {error: '该奖品已在清单中'});
      if (db.prepare('SELECT COUNT(*) AS total FROM drinks').get().total >= 5000) return json(res, 400, {error: '最多配置 5000 款奖品'});
      const result = db.prepare('INSERT INTO drinks (brand, name, note, price) VALUES (?, ?, ?, ?)').run(brand, name, note, price);
      return json(res, 201, db.prepare('SELECT id, brand, name, note, price FROM drinks WHERE id = ?').get(result.lastInsertRowid));
    }

    const drinkMatch = pathname.match(/^\/api\/drinks\/(\d+)$/);
    if (drinkMatch) {
      if (user.role !== 'admin') return json(res, 403, { error: '只有管理员可以管理奖品' });
      const id = Number(drinkMatch[1]);
      if (req.method === 'PATCH') {
        const body = await readJson(req);
        const previous = db.prepare('SELECT * FROM drinks WHERE id = ?').get(id);
        if (!previous) return json(res, 404, {error: '该奖品不存在'});
        let item;
        try { item = Inventory.normalize({...previous, ...body}); }
        catch (err) { return json(res, 400, {error: err.message}); }
        if (db.prepare('SELECT 1 FROM drinks WHERE brand = ? AND name = ? AND id != ?').get(item.brand, item.name, id)) return json(res, 409, {error: '该奖品已在清单中'});
        db.prepare('UPDATE drinks SET brand = ?, name = ?, note = ?, price = ? WHERE id = ?').run(item.brand, item.name, item.note, item.price, id);
        return json(res, 200, db.prepare('SELECT id, brand, name, note, price FROM drinks WHERE id = ?').get(id));
      }
      if (req.method === 'DELETE') {
        const result = db.prepare('DELETE FROM drinks WHERE id = ?').run(id);
        if (!result.changes) return json(res, 404, { error: '该奖品不存在' });
        return json(res, 200, { ok: true });
      }
    }

    if (pathname === '/api/draws' && req.method === 'POST') {
      if (user.role === 'admin') return json(res, 403, { error: '管理员仅可管理奖品清单和查看抽奖记录，不能参与抽奖' });
      const {drinkIds} = await readJson(req) || {};
      db.exec('BEGIN IMMEDIATE');
      try {
        const selected = db.prepare('SELECT c.drink_ids FROM selected_lists s JOIN custom_lists c ON c.id = s.list_id AND c.user_id = s.user_id WHERE s.user_id = ?').get(user.id);
        const brand = db.prepare('SELECT brand FROM user_shops WHERE user_id = ?').get(user.id)?.brand;
        if (!selected && brand === undefined) { db.exec('ROLLBACK'); return json(res, 400, {error:'请先选择店铺或自定义清单'}); }
        const excluded = new Set(JSON.parse(db.prepare('SELECT excluded_ids FROM user_menus WHERE user_id = ? AND brand = ?').get(user.id, brand ?? '')?.excluded_ids ?? '[]'));
        const included = selected ? new Set(JSON.parse(selected.drink_ids)) : null;
        const drinks = db.prepare('SELECT * FROM drinks ORDER BY brand, name').all().filter(d => included ? included.has(d.id) : d.brand === brand && !excluded.has(d.id));
        if (!drinks.length) { db.exec('ROLLBACK'); return json(res, 400, {error:'至少保留 1 款饮品才能抽奖，请添加饮品'}); }
        if (drinkIds !== undefined && (!Array.isArray(drinkIds) || JSON.stringify(drinkIds) !== JSON.stringify(drinks.map(d => d.id)))) {
          db.exec('ROLLBACK'); return json(res, 409, {error:'个人清单已在其他页面修改，请刷新后再抽'});
        }
        const outcome = GameRules.pick(drinks, () => crypto.randomInt(0, 2 ** 32) / 2 ** 32);
        const result = db.prepare('INSERT INTO draws (user_id, drink_id, brand, name, note, price, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(user.id, outcome.id, outcome.brand, outcome.name, outcome.note, outcome.price, new Date().toISOString());
        const record = db.prepare('SELECT id, brand, name, note, price, created_at FROM draws WHERE id = ?').get(result.lastInsertRowid);
        db.exec('COMMIT');
        return json(res, 201, {outcome, record});
      } catch (err) { db.exec('ROLLBACK'); throw err; }
    }

    if (pathname === '/api/draws' && req.method === 'GET') {
      return json(
        res,
        200,
        db
          .prepare('SELECT id, brand, name, note, price, created_at FROM draws WHERE user_id = ? ORDER BY id DESC LIMIT 50')
          .all(user.id)
      );
    }

    if (pathname === '/api/draws/all' && req.method === 'GET') {
      if (user.role !== 'admin') return json(res, 403, { error: '只有管理员可以查看全部记录' });
      const params = new URL(req.url, 'http://localhost').searchParams;
      if (params.has('page')) {
        const page = Number(params.get('page')), pageSize = Number(params.get('pageSize') || 10);
        const search = (params.get('search') || '').trim();
        if (!Number.isSafeInteger(page) || page < 1 || ![5, 10, 20, 50].includes(pageSize) || search.length > 100) {
          return json(res, 400, { error: '分页或搜索参数无效' });
        }
        const where = `FROM draws d JOIN users u ON u.id = d.user_id
          WHERE instr(lower(u.username || ' ' || d.brand || ' ' || d.name || ' ' || coalesce(d.price, '') || ' ' || coalesce(datetime(d.created_at, '+8 hours'), d.created_at)), lower(?)) > 0`;
        const total = db.prepare('SELECT COUNT(*) AS total ' + where).get(search).total;
        const currentPage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
        const items = db.prepare('SELECT d.id, d.brand, d.name, d.price, d.created_at, u.username ' + where + ' ORDER BY d.id DESC LIMIT ? OFFSET ?')
          .all(search, pageSize, (currentPage - 1) * pageSize);
        return json(res, 200, { items, total, page: currentPage, pageSize });
      }
      return json(
        res,
        200,
        db
          .prepare(
            `SELECT d.id, d.brand, d.name, d.price, d.created_at, u.username
             FROM draws d JOIN users u ON u.id = d.user_id
             ORDER BY d.id DESC LIMIT 200`
          )
          .all()
      );
    }

    return json(res, 404, { error: '接口不存在' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, ['请求格式错误', '请求内容过大'].includes(err.message) ? 400 : 500, { error: ['请求格式错误', '请求内容过大'].includes(err.message) ? err.message : '服务器内部错误' });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`奶茶转盘已启动：http://localhost:${PORT}`);
  console.log('用户账号 user / 123456、ping / 123456，管理员账号 admin / admin123');
});
