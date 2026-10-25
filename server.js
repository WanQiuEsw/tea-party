const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const Inventory = require('./inventory.js');
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
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`);

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

// 固定账号：两个普通用户与一个管理员
const ACCOUNTS = [
  ['user', '123456', 'user'],
  ['ping', '123456', 'user'],
  ['admin', 'admin123', 'admin'],
];
// 固定账号：每次启动同步密码，已有数据库（如旧密码）也会自动更新
for (const [username, password, role] of ACCOUNTS) {
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare(
    'INSERT INTO users (username, password, role) VALUES (?, ?, ?) ON CONFLICT(username) DO UPDATE SET password = excluded.password, role = excluded.role'
  ).run(username, `${salt}:${hashPassword(password, salt)}`, role);
}

const SEED_DRINKS = [
  ['一点点', '蔓越莓奶绿', '少冰、三分糖、不加小料', 13],
  ['一点点', '四季奶青', '少冰、三分糖、加蜜豆（红豆）', 12],
  ['古茗', '百香果重奏', '五分糖、去珍珠', 12],
  ['古茗', '桃桃乌龙茶', '五分糖、少冰', 13],
  ['古茗', '抹茶四季冰', '正常糖、少甜', 14],
  ['古茗', '生椰拿铁', '少冰、不额外加糖', 9.4],
  ['古茗', '鲜奶拿铁', '', 9.9],
  ['爷爷不泡茶', '白兰玉露', '五分糖、少冰', 16.5],
  ['爷爷不泡茶', '水蜜桃系列', '-', 14],
  ['林柠', '原谅手打柠檬茶', '标准冰、五分糖', 16],
  ['喜茶', '清爽芭乐提', '-', 17],
  ['霸王茶姬', '花田乌龙', '少冰、微糖', 14],
  ['库迪', '抹茶拿铁', '全脂牛奶 不额外加糖', 9.9],
  ['煲珠公', '水牛奶红糖珍珠', '少冰、三分糖', 15],
  ['茉莉奶白', '茉莉奶油芭乐', '少冰、三分糖', 20],
  ['茶百道', '美式咖啡', '少冰、不加糖、标准浓度', 7.3],
  ['茶百道', '开心果香椰美式', '少冰、七分糖、标准浓度', 12.9],
  ['茶百道', '香草冰淇淋拿铁', '少冰、五分糖（或者不额外加糖）', 11.4],
  ['沪上阿姨', '仙仙玫瑰青提', '', 9],
  ['瑞幸', '冰吸生椰拿铁', '少冰、不另外加糖', 14],
  ['瑞幸', '生椰拿铁', '少冰、不另外加糖', 15],
  ['瑞幸', '泰奶鸳鸯拿铁', '少冰、不另外加糖', 14],
  ['益禾堂', '芋泥波波奶绿', '少冰（热），三分糖，珍珠换芋泥', 8.75],
];
// 只播种一次，管理员清空清单后不会在重启时复活
if (!db.prepare("SELECT 1 FROM meta WHERE key = 'seeded'").get()) {
  const insert = db.prepare('INSERT INTO drinks (brand, name, note, price) VALUES (?, ?, ?, ?)');
  for (const drink of SEED_DRINKS) insert.run(...drink);
  db.prepare("INSERT INTO meta (key, value) VALUES ('seeded', '1')").run();
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
    if (pathname === '/inventory.js' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(__dirname, 'inventory.js')));
    }
    if (!pathname.startsWith('/api/')) return json(res, 404, { error: '页面不存在' });

    if (pathname === '/api/me' && req.method === 'GET') {
      return json(res, 200, { user: currentUser(req) });
    }
    if (pathname === '/api/login' && req.method === 'POST') return await login(req, res);
    if (pathname === '/api/logout' && req.method === 'POST') return logout(req, res);

    const user = currentUser(req);
    if (!user) return json(res, 401, { error: '请先登录' });

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
      if (existing.length + fresh.length > 100) return json(res, 400, {error: '清单最多配置 100 款奖品，请减少导入数量'});
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
      if (db.prepare('SELECT COUNT(*) AS total FROM drinks').get().total >= 100) return json(res, 400, {error: '最多配置 100 款奖品'});
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
      const { drinkId } = await readJson(req);
      const drink = db.prepare('SELECT * FROM drinks WHERE id = ?').get(Number(drinkId));
      if (!drink) return json(res, 404, { error: '该奖品不存在' });
      const createdAt = new Date().toISOString();
      const result = db
        .prepare('INSERT INTO draws (user_id, drink_id, brand, name, note, price, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(user.id, drink.id, drink.brand, drink.name, drink.note, drink.price, createdAt);
      return json(
        res,
        201,
        db.prepare('SELECT id, brand, name, note, price, created_at FROM draws WHERE id = ?').get(result.lastInsertRowid)
      );
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
