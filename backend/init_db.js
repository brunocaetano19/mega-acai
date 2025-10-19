// Inicializa o banco de dados SQLite com tabelas e dados iniciais
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');

const db = new Database('./database.sqlite');

function run(sql){ db.exec(sql); }

run(`
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'operador',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS add_ons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  total NUMERIC(10,2) NOT NULL,
  delivery_fee NUMERIC(10,2) DEFAULT 0,
  app_id INTEGER,
  payment_method_id INTEGER,
  user_id INTEGER,
  note TEXT,
  FOREIGN KEY(app_id) REFERENCES apps(id),
  FOREIGN KEY(payment_method_id) REFERENCES payment_methods(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER,
  product_id INTEGER,
  qty INTEGER DEFAULT 1,
  price_unit NUMERIC(10,2),
  subtotal NUMERIC(10,2),
  FOREIGN KEY(sale_id) REFERENCES sales(id),
  FOREIGN KEY(product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS sale_item_addons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_item_id INTEGER,
  addon_id INTEGER,
  qty INTEGER DEFAULT 1,
  price_unit NUMERIC(10,2),
  subtotal NUMERIC(10,2),
  FOREIGN KEY(sale_item_id) REFERENCES sale_items(id),
  FOREIGN KEY(addon_id) REFERENCES add_ons(id)
);

CREATE TABLE IF NOT EXISTS estoque_movimentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto TEXT NOT NULL,
  tipo TEXT CHECK (tipo IN ('entrada','saida')) NOT NULL,
  quantidade NUMERIC(10,2) NOT NULL,
  valor_unitario NUMERIC(10,2),
  valor_total NUMERIC(10,2),
  data_movimento DATETIME DEFAULT CURRENT_TIMESTAMP,
  motivo TEXT
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto TEXT NOT NULL,
  quantity NUMERIC(10,2) NOT NULL,
  unit_cost NUMERIC(10,2),
  total_cost NUMERIC(10,2),
  date DATETIME DEFAULT CURRENT_TIMESTAMP,
  nota TEXT
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date DATETIME DEFAULT CURRENT_TIMESTAMP,
  description TEXT,
  amount NUMERIC(10,2),
  category TEXT
);
`);

const insertUser = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)');
const saltRounds = 10;
(async ()=>{
  const adminHash = await bcrypt.hash('senha123', saltRounds);
  const esposaHash = await bcrypt.hash('senha123', saltRounds);
  try{
    insertUser.run('Admin Mega Açaí', 'admin@megaacai', adminHash, 'admin');
    insertUser.run('Esposa Mega Açaí', 'esposa@megaacai', esposaHash, 'admin');
  }catch(e){ /* ignore if exists */ }

  const insertApp = db.prepare('INSERT OR IGNORE INTO apps (name) VALUES (?)');
  ['Ifood','Aiqfome','MaisDelivery','WhatsApp','UaiRango'].forEach(n=>insertApp.run(n));

  const insertPay = db.prepare('INSERT OR IGNORE INTO payment_methods (name) VALUES (?)');
  ['Pix','Dinheiro','Cartão Crédito','Cartão Débito','Pagamento Online'].forEach(n=>insertPay.run(n));

  const insertProduct = db.prepare('INSERT OR IGNORE INTO products (name, price) VALUES (?, ?)');
  insertProduct.run('Copo 500ml', 18.00);

  const insertAddon = db.prepare('INSERT OR IGNORE INTO add_ons (name, price) VALUES (?, ?)');
  insertAddon.run('Banana', 3.00);
  insertAddon.run('Morango', 6.00);
  insertAddon.run('Leite Ninho',6.00);

  console.log('Banco inicializado com dados básicos.');
  process.exit(0);
})();
