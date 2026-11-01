// SQLite database: schema + seed data
// Uses Node's built-in SQLite (node:sqlite), so there is nothing to compile. Needs Node 22.13 or newer.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const raw = new DatabaseSync(path.join(__dirname, 'shop.db'));
raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

const db = {
  exec: (sql) => raw.exec(sql),
  prepare: (sql) => raw.prepare(sql),
  // Wraps a function so everything inside it succeeds together or is rolled back.
  transaction: (fn) => (...args) => {
    raw.exec('BEGIN');
    try { const out = fn(...args); raw.exec('COMMIT'); return out; }
    catch (e) { raw.exec('ROLLBACK'); throw e; }
  },
};

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  family TEXT NOT NULL,
  tagline TEXT NOT NULL,
  description TEXT NOT NULL,
  top_note TEXT NOT NULL,
  heart_note TEXT NOT NULL,
  base_note TEXT NOT NULL,
  price INTEGER NOT NULL,          -- rupees, for the 6 ml vial
  stock INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL              -- liquid colour used in the bottle drawing
);

CREATE TABLE IF NOT EXISTS cart_items (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  size INTEGER NOT NULL,           -- 3, 6 or 12 (ml)
  qty INTEGER NOT NULL,
  PRIMARY KEY (user_id, product_id, size)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  subtotal INTEGER NOT NULL,
  shipping INTEGER NOT NULL,
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Placed',
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  pincode TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  unit_price INTEGER NOT NULL      -- price at the time of purchase
);
`);

const seed = [
  ['mitti', 'Mitti', 'Earthy', 'The smell of the first rain on dry ground.',
   'Distilled by baking clay cakes and capturing their fragrance in sandalwood oil, a technique from Kannauj. Cool, mineral and calming. It sits close to the skin and lasts through a long day.',
   'Wet clay', 'Petrichor', 'Sandalwood', 650, 25, '#B5835A'],
  ['gulab', 'Gulab', 'Floral', 'Damask rose, distilled the slow way.',
   'Fresh Damask roses distilled in copper pots (deg and bhapka) into a sandalwood base. Soft, round and old-fashioned in the best way.',
   'Green rose petal', 'Damask rose', 'Sandalwood', 850, 18, '#D4607A'],
  ['shamama', 'Shamama', 'Warm', 'Saffron, spices and herbs. Made for winter.',
   'A winter attar blended from more than 30 herbs, spices and resins. Deep, warm and a little smoky. A small dab goes a long way.',
   'Saffron', 'Cardamom, clove', 'Amber, musk', 1450, 9, '#9A4A2B'],
  ['kewda', 'Kewda', 'Floral', 'Screw-pine flower: green, sweet and bright.',
   'Kewda is made from the male flower of the screw pine. It smells like sweet cucumber and honey. Traditionally worn in the hot months.',
   'Cucumber', 'Pandan flower', 'Honey', 720, 20, '#9DBE6A'],
  ['chandan', 'Chandan', 'Woody', 'Mysore sandalwood, creamy and quiet.',
   'Pure aged sandalwood oil with nothing added. Creamy, soft and meditative. It is also the base for most other attars in this shop.',
   'Milky wood', 'Sandalwood', 'Warm resin', 1800, 12, '#E2B66D'],
  ['motia', 'Motia', 'Floral', 'Night jasmine. Sweet, heady, a little wild.',
   'Made from jasmine flowers picked before sunrise, when their scent is strongest. Rich and sweet, and it opens up even more in warm weather.',
   'Green jasmine', 'Jasmine sambac', 'Musk', 780, 16, '#F0E4C0'],
  ['khus', 'Khus', 'Earthy', 'Vetiver root. Cool, smoky, long-lasting.',
   'Khus is made from the roots of vetiver grass, the same roots used in summer curtains. Cool, green and slightly smoky. A good first attar for people who prefer unsweet scents.',
   'Green grass', 'Vetiver root', 'Smoke, soil', 600, 30, '#6F8F72'],
  ['hina', 'Hina', 'Warm', 'Dark, resinous, a little leathery.',
   'A rich, dark attar with a long drydown. It is made from a blend of herbs, flowers and resins, and it suits evenings and cooler weather.',
   'Dried herbs', 'Leather, resin', 'Dark musk', 1100, 11, '#5B3A5E'],
];

if (db.prepare('SELECT COUNT(*) AS n FROM products').get().n === 0) {
  const ins = db.prepare(`INSERT INTO products
    (slug,name,family,tagline,description,top_note,heart_note,base_note,price,stock,color)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  db.transaction(() => seed.forEach(r => ins.run(...r)))();
}

module.exports = db;
