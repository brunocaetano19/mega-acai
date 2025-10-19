// backend/index.js
// Mega Açaí - Backend completo (Auth, Vendas, Estoque manual, Compras, Despesas, Relatórios)
// Compatível com Render / SQLite (arquivo persistido em ./data/database.sqlite)

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const SALT_ROUNDS = 10;
const JWT_SECRET = process.env.JWT_SECRET || 'trocasegura';
const PORT = process.env.PORT || 10000;

// --- caminho seguro do banco (gera ./data/database.sqlite)
const dbPath = path.resolve(process.cwd(), 'data', 'database.sqlite');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

// --- abrir conexão
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Erro ao conectar no SQLite:', err.message);
  else console.log('Conectado ao SQLite em', dbPath);
});

// --- helpers Promised (db.get, db.all, db.run com lastID)
function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

// --- criar tabelas (idempotente)
async function ensureSchema() {
  // users, apps, payment_methods, products, add_ons, sales, sale_items, sale_item_addons,
  // estoque_movimentos, purchases, expenses
  const stmts = [
    `PRAGMA foreign_keys = ON;`,
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'operador',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS apps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );`,
    `CREATE TABLE IF NOT EXISTS payment_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );`,
    `CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price NUMERIC(10,2) NOT NULL,
      active INTEGER DEFAULT 1
    );`,
    `CREATE TABLE IF NOT EXISTS add_ons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price NUMERIC(10,2) NOT NULL,
      active INTEGER DEFAULT 1
    );`,
    `CREATE TABLE IF NOT EXISTS sales (
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
    );`,
    `CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER,
      product_id INTEGER,
      qty INTEGER DEFAULT 1,
      price_unit NUMERIC(10,2),
      subtotal NUMERIC(10,2),
      FOREIGN KEY(sale_id) REFERENCES sales(id),
      FOREIGN KEY(product_id) REFERENCES products(id)
    );`,
    `CREATE TABLE IF NOT EXISTS sale_item_addons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_item_id INTEGER,
      addon_id INTEGER,
      qty INTEGER DEFAULT 1,
      price_unit NUMERIC(10,2),
      subtotal NUMERIC(10,2),
      FOREIGN KEY(sale_item_id) REFERENCES sale_items(id),
      FOREIGN KEY(addon_id) REFERENCES add_ons(id)
    );`,
    `CREATE TABLE IF NOT EXISTS estoque_movimentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto TEXT NOT NULL,
      tipo TEXT CHECK (tipo IN ('entrada','saida')) NOT NULL,
      quantidade NUMERIC(10,2) NOT NULL,
      valor_unitario NUMERIC(10,2),
      valor_total NUMERIC(10,2),
      data_movimento DATETIME DEFAULT CURRENT_TIMESTAMP,
      motivo TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produto TEXT NOT NULL,
      quantity NUMERIC(10,2) NOT NULL,
      unit_cost NUMERIC(10,2),
      total_cost NUMERIC(10,2),
      date DATETIME DEFAULT CURRENT_TIMESTAMP,
      nota TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date DATETIME DEFAULT CURRENT_TIMESTAMP,
      description TEXT,
      amount NUMERIC(10,2),
      category TEXT
    );`,
  ];

  for (const s of stmts) {
    await dbRun(s);
  }

  // popular dados basicos se não existirem
  const appCount = await dbGet('SELECT COUNT(1) as c FROM apps');
  if (appCount && appCount.c === 0) {
    const apps = ['Ifood','Aiqfome','MaisDelivery','WhatsApp','UaiRango'];
    for (const a of apps) await dbRun('INSERT INTO apps (name) VALUES (?)', [a]);
    console.log('Apps iniciais inseridos.');
  }

  const pmCount = await dbGet('SELECT COUNT(1) as c FROM payment_methods');
  if (pmCount && pmCount.c === 0) {
    const pms = ['Pix','Dinheiro','Cartão Crédito','Cartão Débito','Pagamento Online'];
    for (const p of pms) await dbRun('INSERT INTO payment_methods (name) VALUES (?)', [p]);
    console.log('Payment methods iniciais inseridos.');
  }

  const prodCount = await dbGet('SELECT COUNT(1) as c FROM products');
  if (prodCount && prodCount.c === 0) {
    await dbRun('INSERT INTO products (name, price) VALUES (?, ?)', ['Copo 500ml', 18.00]);
    console.log('Produto exemplo inserido.');
  }

  const addonCount = await dbGet('SELECT COUNT(1) as c FROM add_ons');
  if (addonCount && addonCount.c === 0) {
    await dbRun('INSERT INTO add_ons (name, price) VALUES (?, ?)', ['Banana', 3.00]);
    await dbRun('INSERT INTO add_ons (name, price) VALUES (?, ?)', ['Morango', 6.00]);
    await dbRun('INSERT INTO add_ons (name, price) VALUES (?, ?)', ['Leite Ninho', 6.00]);
    console.log('Adicionais iniciais inseridos.');
  }

  // criar 2 usuários admin se não existirem
  const userCount = await dbGet('SELECT COUNT(1) as c FROM users');
  if (userCount && userCount.c === 0) {
    const pass1 = await bcrypt.hash('senha123', SALT_ROUNDS);
    const pass2 = await bcrypt.hash('senha123', SALT_ROUNDS);
    await dbRun('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)', ['Admin Mega Açaí', 'admin@megaacai', pass1, 'admin']);
    await dbRun('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)', ['Esposa Mega Açaí', 'esposa@megaacai', pass2, 'admin']);
    console.log('Usuarios iniciais criados (admin@megaacai / esposa@megaacai, senha: senha123). Troque as senhas em produção.');
  }
}

// --- inicializa schema e dados
ensureSchema().then(()=> console.log('Schema OK')).catch(err=> console.error('Erro criando schema:', err));

// --- app express
const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// helper auth middleware
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Token ausente' });
  const parts = auth.split(' ');
  if (parts.length !== 2) return res.status(401).json({ error: 'Token inválido' });
  const token = parts[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

// --- ROUTES

// Health / root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Auth
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email e senha são obrigatórios' });
  try {
    const user = await dbGet('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Credenciais inválidas' });
    const token = jwt.sign({ userId: user.id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro no login' });
  }
});

// Public lists
app.get('/apps', async (req, res) => {
  try { const rows = await dbAll('SELECT * FROM apps'); res.json(rows); } catch (e) { console.error(e); res.status(500).json({ error: 'Erro ao buscar apps' }); }
});
app.get('/payment_methods', async (req, res) => {
  try { const rows = await dbAll('SELECT * FROM payment_methods'); res.json(rows); } catch (e) { console.error(e); res.status(500).json({ error: 'Erro ao buscar métodos' }); }
});
app.get('/products', async (req, res) => {
  try { const rows = await dbAll('SELECT * FROM products WHERE active = 1'); res.json(rows); } catch (e) { console.error(e); res.status(500).json({ error: 'Erro ao buscar produtos' }); }
});
app.get('/add_ons', async (req, res) => {
  try { const rows = await dbAll('SELECT * FROM add_ons WHERE active = 1'); res.json(rows); } catch (e) { console.error(e); res.status(500).json({ error: 'Erro ao buscar adicionais' }); }
});

// --- Sales
app.post('/sales', authMiddleware, async (req, res) => {
  const { items, delivery_fee, app_id, payment_method_id, note } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Itens são obrigatórios' });
  try {
    let total = 0;
    for (const it of items) { total += it.price_unit * (it.qty || 1); if (it.addons) for (const a of it.addons) total += a.price_unit * (a.qty || 1); }
    if (delivery_fee) total += Number(delivery_fee);
    const saleRes = await dbRun('INSERT INTO sales (total, delivery_fee, app_id, payment_method_id, user_id, note) VALUES (?, ?, ?, ?, ?, ?)', [total, delivery_fee||0, app_id||null, payment_method_id||null, req.user.userId, note||null]);
    const saleId = saleRes.lastID;
    for (const it of items) {
      const subtotal = it.price_unit * (it.qty || 1);
      const r = await dbRun('INSERT INTO sale_items (sale_id, product_id, qty, price_unit, subtotal) VALUES (?, ?, ?, ?, ?)', [saleId, it.product_id, it.qty||1, it.price_unit, subtotal]);
      const saleItemId = r.lastID;
      if (it.addons) for (const a of it.addons) {
        const sub = a.price_unit * (a.qty || 1);
        await dbRun('INSERT INTO sale_item_addons (sale_item_id, addon_id, qty, price_unit, subtotal) VALUES (?, ?, ?, ?, ?)', [saleItemId, a.addon_id, a.qty||1, a.price_unit, sub]);
      }
    }
    res.json({ success: true, sale_id: saleId, total });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao registrar venda' }); }
});

app.get('/sales', authMiddleware, async (req, res) => {
  const { from, to, app, payment } = req.query;
  try {
    let q = `SELECT s.*, a.name as app_name, p.name as payment_name, u.name as user_name
             FROM sales s
             LEFT JOIN apps a ON s.app_id = a.id
             LEFT JOIN payment_methods p ON s.payment_method_id = p.id
             LEFT JOIN users u ON s.user_id = u.id
             WHERE 1=1`;
    const params = [];
    if (from) { q += ' AND date(s.date_time) >= ?'; params.push(from); }
    if (to) { q += ' AND date(s.date_time) <= ?'; params.push(to); }
    if (app) { q += ' AND s.app_id = ?'; params.push(app); }
    if (payment) { q += ' AND s.payment_method_id = ?'; params.push(payment); }
    q += ' ORDER BY s.date_time DESC LIMIT 1000';
    const rows = await dbAll(q, params);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao buscar vendas' }); }
});

app.get('/sales/:id', authMiddleware, async (req, res) => {
  const id = req.params.id;
  try {
    const sale = await dbGet('SELECT * FROM sales WHERE id = ?', [id]);
    if (!sale) return res.status(404).json({ error: 'Venda não encontrada' });
    const items = await dbAll('SELECT si.*, pr.name as product_name FROM sale_items si LEFT JOIN products pr ON si.product_id = pr.id WHERE si.sale_id = ?', [id]);
    for (const it of items) {
      it.addons = await dbAll('SELECT sia.*, a.name as addon_name FROM sale_item_addons sia LEFT JOIN add_ons a ON sia.addon_id = a.id WHERE sia.sale_item_id = ?', [it.id]);
    }
    res.json({ sale, items });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao buscar venda' }); }
});

// --- Stock (lançamentos manuais)
app.post('/stock/movements', authMiddleware, async (req, res) => {
  const { produto, tipo, quantidade, valor_unitario, motivo } = req.body;
  if (!produto || !tipo || !quantidade) return res.status(400).json({ error: 'produto, tipo e quantidade obrigatórios' });
  try {
    const total = valor_unitario ? valor_unitario * quantidade : null;
    const r = await dbRun('INSERT INTO estoque_movimentos (produto, tipo, quantidade, valor_unitario, valor_total, motivo) VALUES (?, ?, ?, ?, ?, ?)', [produto, tipo, quantidade, valor_unitario||null, total, motivo||null]);
    res.json({ success: true, id: r.lastID });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao registrar movimento de estoque' }); }
});

app.get('/stock', authMiddleware, async (req, res) => {
  try {
    const rows = await dbAll(`
      SELECT produto,
        COALESCE((SELECT SUM(quantidade) FROM estoque_movimentos e2 WHERE e2.produto = e.produto AND tipo = 'entrada'),0) as entrada,
        COALESCE((SELECT SUM(quantidade) FROM estoque_movimentos e3 WHERE e3.produto = e.produto AND tipo = 'saida'),0) as saida
      FROM estoque_movimentos e
      GROUP BY produto
    `);
    res.json(rows.map(r => ({ produto: r.produto, entrada: r.entrada, saida: r.saida, saldo: r.entrada - r.saida })));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao buscar estoque' }); }
});

app.get('/stock/history', authMiddleware, async (req, res) => {
  try { const rows = await dbAll('SELECT * FROM estoque_movimentos ORDER BY data_movimento DESC LIMIT 500'); res.json(rows); } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao buscar histórico' }); }
});

// --- Purchases (entrada e vínculo com estoque)
app.post('/purchases', authMiddleware, async (req, res) => {
  const { produto, quantity, unit_cost, nota } = req.body;
  if (!produto || !quantity) return res.status(400).json({ error: 'produto e quantity obrigatórios' });
  try {
    const total = unit_cost ? unit_cost * quantity : null;
    const r = await dbRun('INSERT INTO purchases (produto, quantity, unit_cost, total_cost, nota) VALUES (?, ?, ?, ?, ?)', [produto, quantity, unit_cost||null, total, nota||null]);
    await dbRun('INSERT INTO estoque_movimentos (produto, tipo, quantidade, valor_unitario, valor_total, motivo) VALUES (?, "entrada", ?, ?, ?, ?)', [produto, quantity, unit_cost||null, total, 'compra']);
    res.json({ success: true, id: r.lastID });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao registrar compra' }); }
});
app.get('/purchases', authMiddleware, async (req, res) => {
  try { const rows = await dbAll('SELECT * FROM purchases ORDER BY date DESC LIMIT 500'); res.json(rows); } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao buscar compras' }); }
});

// --- Expenses
app.post('/expenses', authMiddleware, async (req, res) => {
  const { date, description, amount, category } = req.body;
  if (!amount || !description) return res.status(400).json({ error: 'description e amount obrigatórios' });
  try { const r = await dbRun('INSERT INTO expenses (date, description, amount, category) VALUES (?, ?, ?, ?)', [date||new Date().toISOString(), description, amount, category||null]); res.json({ success: true, id: r.lastID }); } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao registrar despesa' }); }
});
app.get('/expenses', authMiddleware, async (req, res) => {
  try { const rows = await dbAll('SELECT * FROM expenses ORDER BY date DESC LIMIT 500'); res.json(rows); } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao buscar despesas' }); }
});

// --- Reports
app.get('/reports/top-products', authMiddleware, async (req, res) => {
  const { from, to, limit } = req.query;
  try {
    let q = `SELECT p.name, SUM(si.qty) as qtd FROM sale_items si JOIN products p ON si.product_id = p.id JOIN sales s ON si.sale_id = s.id WHERE 1=1`;
    const params = [];
    if (from) { q += ' AND date(s.date_time) >= ?'; params.push(from); }
    if (to) { q += ' AND date(s.date_time) <= ?'; params.push(to); }
    q += ' GROUP BY p.name ORDER BY qtd DESC LIMIT ' + (parseInt(limit) || 10);
    const rows = await dbAll(q, params);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao gerar relatório' }); }
});

app.get('/reports/top-addons', authMiddleware, async (req, res) => {
  const { from, to, limit } = req.query;
  try {
    let q = `SELECT a.name, SUM(sia.qty) as qtd FROM sale_item_addons sia JOIN add_ons a ON sia.addon_id = a.id JOIN sale_items si ON sia.sale_item_id = si.id JOIN sales s ON si.sale_id = s.id WHERE 1=1`;
    const params = [];
    if (from) { q += ' AND date(s.date_time) >= ?'; params.push(from); }
    if (to) { q += ' AND date(s.date_time) <= ?'; params.push(to); }
    q += ' GROUP BY a.name ORDER BY qtd DESC LIMIT ' + (parseInt(limit) || 10);
    const rows = await dbAll(q, params);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao gerar relatório' }); }
});

app.get('/reports/faturamento', authMiddleware, async (req, res) => {
  const { from, to } = req.query;
  try {
    let q = `SELECT date(s.date_time) as dia, SUM(s.total) as faturamento FROM sales s WHERE 1=1`;
    const params = [];
    if (from) { q += ' AND date(s.date_time) >= ?'; params.push(from); }
    if (to) { q += ' AND date(s.date_time) <= ?'; params.push(to); }
    q += ' GROUP BY date(s.date_time) ORDER BY date(s.date_time)';
    const rows = await dbAll(q, params);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao gerar relatório' }); }
});

// serve SPA fallback
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  res.status(404).send('Not Found');
});

// --- start
app.listen(PORT, () => {
  console.log('Server running on port', PORT);
});
