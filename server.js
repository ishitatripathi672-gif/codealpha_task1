const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

const SIZES = { 3: 0.6, 6: 1, 12: 1.8 };          // ml -> price multiplier
const MAX_QTY = 10;
const unitPrice = (price, size) => Math.round(price * SIZES[size]);
const shippingFor = (subtotal) => (subtotal >= 999 ? 0 : 60);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const app = express();
app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- auth helpers ---------- */
function issueCookie(res, id) {
  const token = jwt.sign({ id }, SECRET, { expiresIn: '7d' });
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 3600 * 1000,
  });
}

function userFromCookie(req) {
  const token = req.cookies.token;
  if (!token) return null;
  try {
    const { id } = jwt.verify(token, SECRET);
    return db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(id) || null;
  } catch { return null; }
}

function requireAuth(req, res, next) {
  const user = userFromCookie(req);
  if (!user) return next(new HttpError(401, 'Please log in to continue.'));
  req.user = user;
  next();
}

/* ---------- auth routes ---------- */
app.post('/api/auth/register', (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (name.length < 2) throw new HttpError(400, 'Please enter your name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Please enter a valid email address.');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email))
    throw new HttpError(409, 'An account with this email already exists. Try logging in.');
  const hash = bcrypt.hashSync(password, 10);
  const { lastInsertRowid } = db.prepare('INSERT INTO users (name,email,password_hash) VALUES (?,?,?)').run(name, email, hash);
  issueCookie(res, lastInsertRowid);
  res.status(201).json({ user: { id: lastInsertRowid, name, email } });
});

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!row || !bcrypt.compareSync(password, row.password_hash))
    throw new HttpError(401, 'Email or password is incorrect.');
  issueCookie(res, row.id);
  res.json({ user: { id: row.id, name: row.name, email: row.email } });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  res.json({ user: userFromCookie(req) });
});

/* ---------- products ---------- */
app.get('/api/products', (req, res) => {
  const q = String(req.query.q || '').trim();
  const family = String(req.query.family || '').trim();
  let sql = 'SELECT * FROM products WHERE 1=1';
  const args = [];
  if (family) { sql += ' AND family = ?'; args.push(family); }
  if (q) {
    sql += ' AND (name LIKE ? OR tagline LIKE ? OR top_note LIKE ? OR heart_note LIKE ? OR base_note LIKE ?)';
    args.push(...Array(5).fill(`%${q}%`));
  }
  res.json({ products: db.prepare(sql + ' ORDER BY id').all(...args), sizes: SIZES });
});

app.get('/api/products/:slug', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE slug = ?').get(req.params.slug);
  if (!p) throw new HttpError(404, 'We could not find that attar.');
  res.json({ product: p });
});

/* ---------- cart (logged-in users; guests keep theirs in localStorage) ---------- */
const upsertCart = db.prepare(`
  INSERT INTO cart_items (user_id, product_id, size, qty) VALUES (?,?,?,?)
  ON CONFLICT(user_id, product_id, size) DO UPDATE SET qty = excluded.qty`);

function validLine(i) {
  const product_id = Number(i.product_id), size = Number(i.size), qty = Number(i.qty);
  if (!Number.isInteger(product_id) || !(size in SIZES) || !Number.isInteger(qty) || qty < 0) return null;
  const p = db.prepare('SELECT id, stock FROM products WHERE id = ?').get(product_id);
  if (!p) return null;
  return { product_id, size, qty: Math.min(qty, MAX_QTY, p.stock) };
}

app.get('/api/cart', requireAuth, (req, res) => {
  const items = db.prepare('SELECT product_id, size, qty FROM cart_items WHERE user_id = ?').all(req.user.id);
  res.json({ items });
});

app.put('/api/cart', requireAuth, (req, res) => {
  const line = validLine(req.body);
  if (!line) throw new HttpError(400, 'That item could not be added.');
  if (line.qty === 0) {
    db.prepare('DELETE FROM cart_items WHERE user_id=? AND product_id=? AND size=?').run(req.user.id, line.product_id, line.size);
  } else {
    upsertCart.run(req.user.id, line.product_id, line.size, line.qty);
  }
  res.json({ ok: true });
});

// Called right after login: folds the guest's local cart into the saved one.
app.post('/api/cart/merge', requireAuth, (req, res) => {
  const incoming = Array.isArray(req.body.items) ? req.body.items.slice(0, 50) : [];
  const get = db.prepare('SELECT qty FROM cart_items WHERE user_id=? AND product_id=? AND size=?');
  db.transaction(() => {
    for (const raw of incoming) {
      const line = validLine(raw);
      if (!line || line.qty === 0) continue;
      const existing = get.get(req.user.id, line.product_id, line.size);
      const stock = db.prepare('SELECT stock FROM products WHERE id=?').get(line.product_id).stock;
      const qty = Math.min((existing ? existing.qty : 0) + line.qty, MAX_QTY, stock);
      upsertCart.run(req.user.id, line.product_id, line.size, qty);
    }
  })();
  const items = db.prepare('SELECT product_id, size, qty FROM cart_items WHERE user_id = ?').all(req.user.id);
  res.json({ items });
});

/* ---------- orders ---------- */
const placeOrder = db.transaction((user, form) => {
  const rows = db.prepare(`
    SELECT c.product_id, c.size, c.qty, p.name, p.price, p.stock
    FROM cart_items c JOIN products p ON p.id = c.product_id
    WHERE c.user_id = ?`).all(user.id);
  if (!rows.length) throw new HttpError(400, 'Your cart is empty.');

  // Stock is shared across sizes of one product, so total it up first.
  const wanted = {};
  rows.forEach(r => { wanted[r.product_id] = (wanted[r.product_id] || 0) + r.qty; });
  for (const r of rows) {
    if (wanted[r.product_id] > r.stock)
      throw new HttpError(409, r.stock === 0 ? `${r.name} is sold out. Please remove it from your cart.`
                                              : `Only ${r.stock} of ${r.name} left. Please reduce the quantity.`);
  }

  // Prices always come from the database, never from the browser.
  const subtotal = rows.reduce((s, r) => s + unitPrice(r.price, r.size) * r.qty, 0);
  const shipping = shippingFor(subtotal);
  const total = subtotal + shipping;

  const { lastInsertRowid: orderId } = db.prepare(`
    INSERT INTO orders (user_id, subtotal, shipping, total, name, phone, address, city, pincode, payment_method)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(user.id, subtotal, shipping, total, form.name, form.phone, form.address, form.city, form.pincode, form.payment_method);

  const insItem = db.prepare(`INSERT INTO order_items (order_id, product_id, product_name, size, qty, unit_price)
                              VALUES (?,?,?,?,?,?)`);
  const dec = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
  rows.forEach(r => insItem.run(orderId, r.product_id, r.name, r.size, r.qty, unitPrice(r.price, r.size)));
  Object.entries(wanted).forEach(([pid, n]) => dec.run(n, Number(pid)));
  db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(user.id);
  return orderId;
});

app.post('/api/orders', requireAuth, (req, res) => {
  const b = req.body || {};
  const form = {
    name: String(b.name || '').trim(),
    phone: String(b.phone || '').replace(/\s+/g, ''),
    address: String(b.address || '').trim(),
    city: String(b.city || '').trim(),
    pincode: String(b.pincode || '').trim(),
    payment_method: b.payment_method === 'UPI' ? 'UPI on delivery' : 'Cash on delivery',
  };
  if (form.name.length < 2) throw new HttpError(400, 'Please enter the name for delivery.');
  if (!/^[6-9]\d{9}$/.test(form.phone)) throw new HttpError(400, 'Enter a 10-digit mobile number.');
  if (form.address.length < 8) throw new HttpError(400, 'Please enter your full address.');
  if (form.city.length < 2) throw new HttpError(400, 'Please enter your city.');
  if (!/^\d{6}$/.test(form.pincode)) throw new HttpError(400, 'Enter a 6-digit pincode.');
  const id = placeOrder(req.user, form);
  res.status(201).json({ id });
});

function orderWithItems(order) {
  order.items = db.prepare('SELECT product_id, product_name, size, qty, unit_price FROM order_items WHERE order_id = ?').all(order.id);
  return order;
}

app.get('/api/orders', requireAuth, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  res.json({ orders: orders.map(orderWithItems) });
});

app.get('/api/orders/:id', requireAuth, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!o) throw new HttpError(404, 'We could not find that order.');
  res.json({ order: orderWithItems(o) });
});

/* ---------- errors ---------- */
app.use('/api', (req, res, next) => next(new HttpError(404, 'Not found.')));
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Something went wrong on our side.' : err.message });
});

app.listen(PORT, () => console.log(`Itrakhana running at http://localhost:${PORT}`));
