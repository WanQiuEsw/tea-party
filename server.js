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
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS completions (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  mode TEXT NOT NULL
);
`);

// Remove retired account data; public catalog and administrator remain.
db.exec(`BEGIN IMMEDIATE;
DROP TABLE IF EXISTS draws;
DROP TABLE IF EXISTS user_menus;
DROP TABLE IF EXISTS user_shops;
DROP TABLE IF EXISTS custom_lists;
DROP TABLE IF EXISTS selected_lists;
DROP TABLE IF EXISTS rewards;
DROP TABLE IF EXISTS daily_rewards;
DELETE FROM users WHERE role != 'admin';
COMMIT;`);

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

// 仅保留管理员账号
const ACCOUNTS = [['admin', 'admin123', 'admin']];
// 固定账号：每次启动同步密码，已有数据库（如旧密码）也会自动更新
for (const [username, password, role] of ACCOUNTS) {
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare(
    'INSERT INTO users (username, password, role) VALUES (?, ?, ?) ON CONFLICT(username) DO UPDATE SET password = excluded.password, role = excluded.role'
  ).run(username, `${salt}:${hashPassword(password, salt)}`, role);
}

// Seed the supplied public catalog once.
if (!db.prepare("SELECT 1 FROM meta WHERE key = 'catalog_replace_20261026'").get()) {
  const catalog = require('./catalog.json').map(Inventory.normalize);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DELETE FROM drinks;');
    const insert = db.prepare('INSERT INTO drinks (brand, name, note, price) VALUES (?, ?, ?, ?)');
    for (const d of catalog) insert.run(d.brand, d.name, d.note, d.price);
    db.prepare("INSERT INTO meta (key, value) VALUES ('catalog_replace_20261026', '1')").run();
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
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
  const user = db.prepare("SELECT * FROM users WHERE username = ? AND role = 'admin'").get(username.trim());
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
    if (pathname === '/api/login' && req.method === 'POST') return await login(req, res);
    if (pathname === '/api/logout' && req.method === 'POST') return logout(req, res);
    if (pathname === '/api/drinks' && req.method === 'GET') {
      return json(res, 200, db.prepare('SELECT id, brand, name, note, price FROM drinks ORDER BY brand, name').all());
    }
    if (pathname === '/api/completions' && req.method === 'POST') {
      const body = await readJson(req);
      if (!body || !['wheel','scratch','number','capsule','box','slot','flip'].includes(body.mode)
          || typeof body.id !== 'string' || !/^[a-f0-9-]{36}$/.test(body.id)
          || Object.keys(body).some(key => !['id','mode'].includes(key)))
        return json(res, 400, {error: '统计参数无效'});
      db.prepare('INSERT OR IGNORE INTO completions (id, day, mode) VALUES (?, ?, ?)').run(body.id, GameRules.dayKey(), body.mode);
      return json(res, 200, {ok: true});
    }
    const user = currentUser(req);
    if (pathname === '/api/stats' && req.method === 'GET') {
      if (!user) return json(res, 401, {error: '请先登录管理员'});
      return json(res, 200, {
        today: GameRules.dayKey(),
        total: db.prepare('SELECT COUNT(*) AS count FROM completions').get().count,
        daily: db.prepare('SELECT day, COUNT(*) AS count FROM completions GROUP BY day ORDER BY day DESC LIMIT 30').all(),
        modes: db.prepare('SELECT mode, COUNT(*) AS count FROM completions GROUP BY mode').all()
      });
    }
    if (!['/api/drinks','/api/drinks/import'].includes(pathname) && !/^\/api\/drinks\/\d+$/.test(pathname))
      return json(res, 404, {error: '接口不存在'});
    if (!user) return json(res, 401, {error: '请先登录管理员'});

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

    return json(res, 404, { error: '接口不存在' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, ['请求格式错误', '请求内容过大'].includes(err.message) ? 400 : 500, { error: ['请求格式错误', '请求内容过大'].includes(err.message) ? err.message : '服务器内部错误' });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`随机选择器已启动：http://localhost:${PORT}`);
  console.log('管理员账号 admin / admin123');
});
