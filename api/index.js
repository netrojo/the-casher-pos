// Vercel serverless function wrapper for Cafe POS
const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const { stringify } = require('csv-stringify');
const cookieParser = require('cookie-parser');

// Use data folder relative to function dir
// If running in production (Vercel uses NODE_ENV=production), use /tmp which is writable; 
// otherwise use the repository data folder for local dev.
const IS_PROD = process.env.NODE_ENV === 'production';
const IS_VERCEL = !!process.env.VERCEL;
const REPO_DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_DIR = IS_PROD ? path.join('/tmp') : REPO_DATA_DIR;
const DB_PATH = path.join(DATA_DIR, 'pos.db');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new sqlite3.Database(DB_PATH);
const run = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, function(err){ if(err) rej(err); else res(this); }));
const get = (sql, params = []) => new Promise((res, rej) => db.get(sql, params, (err,row)=> err?rej(err):res(row)));
const all = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (err,rows)=> err?rej(err):res(rows)));

async function initDb(seed=false) {
  await run(`CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT,
    role TEXT
  )`);
  await run(`CREATE TABLE IF NOT EXISTS categories(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE
  )`);
  await run(`CREATE TABLE IF NOT EXISTS products(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    category_id INTEGER,
    price REAL,
    stock INTEGER DEFAULT 0,
    FOREIGN KEY(category_id) REFERENCES categories(id)
  )`);
  await run(`CREATE TABLE IF NOT EXISTS orders(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_time TEXT,
    subtotal REAL,
    tax REAL,
    discount REAL,
    total REAL,
    payment_method TEXT,
    cash_received REAL,
    change_given REAL
  )`);
  await run(`CREATE TABLE IF NOT EXISTS order_items(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    product_id INTEGER,
    name TEXT,
    qty INTEGER,
    price REAL,
    modifiers TEXT,
    notes TEXT,
    FOREIGN KEY(order_id) REFERENCES orders(id)
  )`);
  await run(`CREATE TABLE IF NOT EXISTS settings(
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  const tax = await get('SELECT value FROM settings WHERE key = ?', ['tax_percent']);
  if (!tax) await run('INSERT INTO settings(key,value) VALUES(?,?)', ['tax_percent','10']);

  const prodCount = await get('SELECT COUNT(1) as c FROM products');
  if (seed || (prodCount && prodCount.c === 0)) {
    console.log('Seeding database with demo data...');
    await run('INSERT OR REPLACE INTO users(email,password,role) VALUES(?,?,?)', ['kh@ch','0000','cashier']);
    await run('INSERT OR IGNORE INTO users(email,password,role) VALUES(?,?,?)', ['manager@example','manager123','manager']);
    await run('INSERT OR IGNORE INTO categories(name) VALUES(?)', ['Hot Drinks']);
    await run('INSERT OR IGNORE INTO categories(name) VALUES(?)', ['Cold Drinks']);
    await run('INSERT OR IGNORE INTO categories(name) VALUES(?)', ['Bakery']);
    const hotId = (await get('SELECT id FROM categories WHERE name=?',['Hot Drinks'])).id;
    const coldId = (await get('SELECT id FROM categories WHERE name=?',['Cold Drinks'])).id;
    const bakId = (await get('SELECT id FROM categories WHERE name=?',['Bakery'])).id;
    await run('INSERT INTO products(name,category_id,price,stock) VALUES(?,?,?,?)', ['Espresso', hotId, 2.5, 20]);
    await run('INSERT INTO products(name,category_id,price,stock) VALUES(?,?,?,?)', ['Latte', hotId, 3.5, 15]);
    await run('INSERT INTO products(name,category_id,price,stock) VALUES(?,?,?,?)', ['Iced Coffee', coldId, 3.0, 12]);
    await run('INSERT INTO products(name,category_id,price,stock) VALUES(?,?,?,?)', ['Croissant', bakId, 2.0, 8]);
    const now = new Date().toISOString();
    const res = await run('INSERT INTO orders(order_time,subtotal,tax,discount,total,payment_method,cash_received,change_given) VALUES(?,?,?,?,?,?,?,?)', [now,5.0,0.5,0,5.5,'Cash',10,4.5]);
    const orderId = res.lastID;
    await run('INSERT INTO order_items(order_id,product_id,name,qty,price,modifiers,notes) VALUES(?,?,?,?,?,?,?)', [orderId,1,'Espresso',1,2.5,'','']);
    await run('INSERT INTO order_items(order_id,product_id,name,qty,price,modifiers,notes) VALUES(?,?,?,?,?,?,?)', [orderId,4,'Croissant',1,2.0,'','']);
  }
}

async function ensureCashierUser() {
  await run(
    "UPDATE users SET email = ?, password = ? WHERE role = 'cashier'",
    ['kh@ch', '0000']
  );
  const row = await get("SELECT id FROM users WHERE role = 'cashier'");
  if (!row) {
    await run(
      "INSERT INTO users(email, password, role) VALUES(?,?,?)",
      ['kh@ch', '0000', 'cashier']
    );
  }
}

// Initialize DB on function cold-start
// If running in production (Vercel), always seed the DB (initDb(true)) so tables and demo data exist in /tmp
if (IS_PROD) {
  initDb(true)
    .then(() => ensureCashierUser())
    .then(() => console.log('DB initialized (prod) and cashier ensured'))
    .catch(err => console.error('DB init error (prod):', err));
} else {
  // Local dev: only seed when explicitly requested, or if DB is empty
  initDb(process.argv.includes('--seed'))
    .then(() => ensureCashierUser())
    .then(() => console.log('DB initialized and cashier ensured'))
    .catch(err => console.error('DB init error:', err));
}

const app = express();
app.set('trust proxy', 1); // trust first proxy (Vercel provides forwarded proto)
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
const cookieSession = require('cookie-session');
const SESSION_SECURE = process.env.SESSION_SECURE === 'true' || process.env.NODE_ENV === 'production' || IS_VERCEL;
const SESSION_SAME_SITE = process.env.SESSION_SAME_SITE || (IS_VERCEL ? 'none' : 'lax');
app.use(cookieSession({
  name: 'pos_session',
  keys: [process.env.SESSION_KEY || 'pos-secret-key'],
  secure: SESSION_SECURE,
  httpOnly: true,
  sameSite: SESSION_SAME_SITE,
  maxAge: 24 * 60 * 60 * 1000,
  path: '/'
}));

// cookie-session stores data on req.session as object; keep same checks
function requireAuth(req,res,next){ if (req.session && req.session.user) return next(); res.status(401).json({ error: 'Unauthorized' }); }
function requireManager(req,res,next){ if (req.session && req.session.user && req.session.user.role === 'manager') return next(); res.status(403).json({ error: 'Forbidden - manager only' }); }

// Helper for logging and returning errors
function routeError(req, res, route, err){
  console.error(`Error in ${route}:`, err && err.message ? err.message : err);
  // In dev print stack
  if(process.env.NODE_ENV !== 'production') console.error(err.stack || err);
  return res.status(500).json({ error: 'Internal Server Error' });
}

// Health check
app.get('/api/_health', (req,res)=>{ res.json({ok:true, vercel: IS_VERCEL}); });

// API Routes
app.post('/api/login', async (req,res)=>{
  const { email, password } = req.body;
  if(!email || !password) return res.status(400).json({ error: 'Missing credentials' });
  try {
    const user = await get('SELECT id,email,role FROM users WHERE email=? AND password=?',[email,password]);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    req.session.user = user;
    return res.json({ user });
  } catch (err) {
    console.error('LOGIN ERROR:', err);
    return res.status(500).json({ error: 'Internal error: ' + (err && err.message ? err.message : 'unknown') });
  }
});

app.post('/api/logout', (req,res)=>{ try{ req.session = null; res.json({ok:true}); }catch(err){ return routeError(req,res,'/api/logout', err); } });
app.get('/api/user', (req,res)=>{ try{ res.json({ user: req.session.user || null }); }catch(err){ return routeError(req,res,'/api/user', err); } });

// categories
app.get('/api/categories', async (req,res)=>{ try{ const rows = await all('SELECT * FROM categories ORDER BY name'); res.json(rows); }catch(err){ res.status(500).json({ error: err.message }); } });
app.post('/api/categories', requireAuth, requireManager, async (req,res)=>{ try{ const { name } = req.body; if(!name) return res.status(400).json({ error: 'Missing name' }); const r = await run('INSERT INTO categories(name) VALUES(?)',[name]); const cat = await get('SELECT * FROM categories WHERE id=?',[r.lastID]); res.json(cat); }catch(err){ if(err && err.message && err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Category exists' }); res.status(500).json({ error: err.message }); } });
app.put('/api/categories/:id', requireAuth, requireManager, async (req,res)=>{ try{ const id = req.params.id; const { name } = req.body; if(!name) return res.status(400).json({ error: 'Missing name' }); await run('UPDATE categories SET name=? WHERE id=?',[name,id]); const cat = await get('SELECT * FROM categories WHERE id=?',[id]); res.json(cat); }catch(err){ res.status(500).json({ error: err.message }); } });
app.delete('/api/categories/:id', requireAuth, requireManager, async (req,res)=>{ try{ const id = req.params.id; const row = await get('SELECT COUNT(1) as c FROM products WHERE category_id=?',[id]); if(row && row.c > 0) return res.status(400).json({ error: 'Category has products' }); await run('DELETE FROM categories WHERE id=?',[id]); res.json({ ok:true }); }catch(err){ res.status(500).json({ error: err.message }); } });

// products
app.get('/api/products', async (req,res)=>{ try{ const { q, category } = req.query; let sql = 'SELECT p.*, c.name as category FROM products p LEFT JOIN categories c ON p.category_id=c.id'; const params = []; const where = []; if(category) { where.push('c.id = ?'); params.push(category); } if(q) { where.push('p.name LIKE ?'); params.push('%'+q+'%'); } if(where.length) sql += ' WHERE ' + where.join(' AND '); sql += ' ORDER BY p.name'; const rows = await all(sql, params); res.json(rows); }catch(err){ res.status(500).json({ error: err.message }); } });
app.post('/api/products', requireAuth, requireManager, async (req,res)=>{ try{ const { name, category_id, price, stock } = req.body; const r = await run('INSERT INTO products(name,category_id,price,stock) VALUES(?,?,?,?)',[name,category_id,price,stock||0]); const p = await get('SELECT * FROM products WHERE id=?',[r.lastID]); res.json(p); }catch(err){ res.status(500).json({ error: err.message }); } });
app.put('/api/products/:id', requireAuth, requireManager, async (req,res)=>{ try{ const id = req.params.id; const { name, category_id, price, stock } = req.body; await run('UPDATE products SET name=?,category_id=?,price=?,stock=? WHERE id=?',[name,category_id,price,stock,id]); const p = await get('SELECT * FROM products WHERE id=?',[id]); res.json(p); }catch(err){ res.status(500).json({ error: err.message }); } });
app.delete('/api/products/:id', requireAuth, requireManager, async (req,res)=>{ try{ await run('DELETE FROM products WHERE id=?',[req.params.id]); res.json({ ok:true }); }catch(err){ res.status(500).json({ error: err.message }); } });

// orders
app.post('/api/orders', requireAuth, async (req,res)=>{ try{ const { items, subtotal, tax, discount, total, payment_method, cash_received, change_given } = req.body; const now = new Date().toISOString(); const r = await run('INSERT INTO orders(order_time,subtotal,tax,discount,total,payment_method,cash_received,change_given) VALUES(?,?,?,?,?,?,?,?)',[now,subtotal,tax,discount,total,payment_method,cash_received||0,change_given||0]); const orderId = r.lastID; for(const it of items){ await run('INSERT INTO order_items(order_id,product_id,name,qty,price,modifiers,notes) VALUES(?,?,?,?,?,?,?)',[orderId,it.product_id,it.name,it.qty,it.price,it.modifiers||'',''+(it.notes||'')]); if(it.product_id){ await run('UPDATE products SET stock = stock - ? WHERE id=?',[it.qty,it.product_id]); } } const order = await get('SELECT * FROM orders WHERE id=?',[orderId]); res.json({ orderId, order }); }catch(err){ res.status(500).json({ error: err.message }); } });
app.get('/api/orders', requireAuth, async (req,res)=>{ try{ const { from, to } = req.query; let sql = 'SELECT * FROM orders'; const params = []; if(from || to){ const parts = []; if(from){ parts.push('order_time >= ?'); params.push(from+'T00:00:00'); } if(to){ parts.push('order_time <= ?'); params.push(to+'T23:59:59'); } sql += ' WHERE ' + parts.join(' AND '); } sql += ' ORDER BY order_time DESC LIMIT 1000'; const rows = await all(sql, params); res.json(rows); }catch(err){ res.status(500).json({ error: err.message }); } });
app.get('/api/orders/:id', requireAuth, async (req,res)=>{ try{ const order = await get('SELECT * FROM orders WHERE id=?',[req.params.id]); if(!order) return res.status(404).json({ error: 'Not found' }); const items = await all('SELECT * FROM order_items WHERE order_id=?',[req.params.id]); res.json({ order, items }); }catch(err){ res.status(500).json({ error: err.message }); } });

// reports
app.get('/api/reports/summary', requireAuth, requireManager, async (req,res)=>{ try{ const { from, to } = req.query; const f = from ? from+'T00:00:00' : '1970-01-01T00:00:00'; const t = to ? to+'T23:59:59' : new Date().toISOString(); const totals = await get('SELECT COUNT(1) as orders, SUM(total) as sales FROM orders WHERE order_time BETWEEN ? AND ?',[f,t]); const top = await all(`SELECT oi.name, SUM(oi.qty) as qty, SUM(oi.qty*oi.price) as revenue
      FROM order_items oi JOIN orders o ON oi.order_id=o.id
      WHERE o.order_time BETWEEN ? AND ?
      GROUP BY oi.name ORDER BY qty DESC LIMIT 5`, [f,t]); res.json({ totals, top }); }catch(err){ res.status(500).json({ error: err.message }); } });

app.get('/api/reports/export', requireAuth, requireManager, async (req,res)=>{ try{ const { from, to } = req.query; const f = from ? from+'T00:00:00' : '1970-01-01T00:00:00'; const t = to ? to+'T23:59:59' : new Date().toISOString(); const orders = await all('SELECT * FROM orders WHERE order_time BETWEEN ? AND ? ORDER BY order_time',[f,t]); const rows = [['order_id','order_time','subtotal','tax','discount','total','payment_method','cash_received','change_given']]; for(const o of orders) rows.push([o.id,o.order_time,o.subtotal,o.tax,o.discount,o.total,o.payment_method,o.cash_received,o.change_given]); res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename="orders.csv"'); stringify(rows, (err, output) => { if(err) res.status(500).send('CSV error'); else res.send(output); }); }catch(err){ res.status(500).json({ error: err.message }); } });

// settings
app.get('/api/settings', requireAuth, requireManager, async (req,res)=>{ try{ const rows = await all('SELECT * FROM settings'); res.json(Object.fromEntries(rows.map(r=>[r.key,r.value]))); }catch(err){ res.status(500).json({ error: err.message }); } });
app.put('/api/settings', requireAuth, requireManager, async (req,res)=>{ try{ const updates = req.body; for(const k of Object.keys(updates)){ await run('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)',[k,String(updates[k])]); } res.json({ ok:true }); }catch(err){ res.status(500).json({ error: err.message }); } });

// Serve static files locally via function (Vercel handles static files via config)
app.use('/', express.static(PUBLIC_DIR));
app.get('*', (req,res)=>{ res.sendFile(path.join(PUBLIC_DIR,'index.html')); });

// Export app for Vercel
module.exports = app;
