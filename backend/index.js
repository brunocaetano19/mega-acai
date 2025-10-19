const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = new Database('./database.sqlite');
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'trocasegura';

app.use(cors());
app.use(bodyParser.json());

// Auth
app.post('/auth/login', (req, res)=>{
  const { email, password } = req.body;
  if(!email || !password) return res.status(400).json({ error: 'Email e senha são obrigatórios' });
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if(!row) return res.status(401).json({ error: 'Credenciais inválidas' });
  bcrypt.compare(password, row.password_hash).then(match=>{
    if(!match) return res.status(401).json({ error: 'Credenciais inválidas' });
    const token = jwt.sign({ userId: row.id, role: row.role, name: row.name }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, user: { id: row.id, name: row.name, email: row.email, role: row.role } });
  });
});

// Middleware
function authMiddleware(req, res, next){
  const auth = req.headers.authorization;
  if(!auth) return res.status(401).json({ error: 'Token ausente' });
  const parts = auth.split(' ');
  if(parts.length !== 2) return res.status(401).json({ error: 'Token inválido' });
  const token = parts[1];
  try{
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  }catch(e){
    return res.status(401).json({ error: 'Token inválido' });
  }
}

// --- Basic endpoints (public read)
app.get('/apps', (req, res)=> {
  const rows = db.prepare('SELECT * FROM apps').all();
  res.json(rows);
});
app.get('/payment_methods', (req, res)=> {
  const rows = db.prepare('SELECT * FROM payment_methods').all();
  res.json(rows);
});
app.get('/products', (req, res)=> {
  const rows = db.prepare('SELECT * FROM products WHERE active = 1').all();
  res.json(rows);
});
app.get('/add_ons', (req, res)=> {
  const rows = db.prepare('SELECT * FROM add_ons WHERE active = 1').all();
  res.json(rows);
});

// --- Sales
app.post('/sales', authMiddleware, (req, res)=>{
  const { items, delivery_fee, app_id, payment_method_id, note } = req.body;
  if(!items || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Itens são obrigatórios' });
  let total = 0;
  items.forEach(it=>{
    total += (it.price_unit * (it.qty || 1));
    if(it.addons) it.addons.forEach(a=> total += (a.price_unit * (a.qty || 1)));
  });
  if(delivery_fee) total += Number(delivery_fee);
  const saleInfo = db.prepare('INSERT INTO sales (total, delivery_fee, app_id, payment_method_id, user_id, note) VALUES (?, ?, ?, ?, ?, ?)');
  const info = saleInfo.run(total, delivery_fee||0, app_id||null, payment_method_id||null, req.user.userId, note||null);
  const saleId = info.lastInsertRowid;
  const insertItem = db.prepare('INSERT INTO sale_items (sale_id, product_id, qty, price_unit, subtotal) VALUES (?, ?, ?, ?, ?)');
  const insertAddon = db.prepare('INSERT INTO sale_item_addons (sale_item_id, addon_id, qty, price_unit, subtotal) VALUES (?, ?, ?, ?, ?)');
  items.forEach(it=>{
    const subtotal = (it.price_unit * (it.qty || 1));
    const r = insertItem.run(saleId, it.product_id, it.qty || 1, it.price_unit, subtotal);
    const saleItemId = r.lastInsertRowid;
    if(it.addons) it.addons.forEach(a=>{
      const sub = (a.price_unit * (a.qty || 1));
      insertAddon.run(saleItemId, a.addon_id, a.qty || 1, a.price_unit, sub);
    });
  });
  res.json({ success: true, sale_id: saleId, total });
});

app.get('/sales', authMiddleware, (req, res)=>{
  const { from, to, app, payment } = req.query;
  let q = `SELECT s.*, a.name as app_name, p.name as payment_name, u.name as user_name
           FROM sales s
           LEFT JOIN apps a ON s.app_id = a.id
           LEFT JOIN payment_methods p ON s.payment_method_id = p.id
           LEFT JOIN users u ON s.user_id = u.id
           WHERE 1=1`;
  const params = [];
  if(from){ q += ' AND date(s.date_time) >= ?'; params.push(from); }
  if(to){ q += ' AND date(s.date_time) <= ?'; params.push(to); }
  if(app){ q += ' AND s.app_id = ?'; params.push(app); }
  if(payment){ q += ' AND s.payment_method_id = ?'; params.push(payment); }
  q += ' ORDER BY s.date_time DESC LIMIT 1000';
  const rows = db.prepare(q).all(...params);
  res.json(rows);
});

app.get('/sales/:id', authMiddleware, (req, res)=>{
  const id = req.params.id;
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
  if(!sale) return res.status(404).json({ error: 'Venda não encontrada' });
  const items = db.prepare('SELECT si.*, pr.name as product_name FROM sale_items si LEFT JOIN products pr ON si.product_id = pr.id WHERE si.sale_id = ?').all(id);
  items.forEach(it=>{
    it.addons = db.prepare('SELECT sia.*, a.name as addon_name FROM sale_item_addons sia LEFT JOIN add_ons a ON sia.addon_id = a.id WHERE sia.sale_item_id = ?').all(it.id);
  });
  res.json({ sale, items });
});

// --- Stock (manual entries)
app.post('/stock/movements', authMiddleware, (req, res)=>{
  const { produto, tipo, quantidade, valor_unitario, motivo } = req.body;
  if(!produto || !tipo || !quantidade) return res.status(400).json({ error: 'produto, tipo e quantidade obrigatórios' });
  const total = (valor_unitario ? (valor_unitario * quantidade) : null);
  const stmt = db.prepare('INSERT INTO estoque_movimentos (produto, tipo, quantidade, valor_unitario, valor_total, motivo) VALUES (?, ?, ?, ?, ?, ?)');
  const info = stmt.run(produto, tipo, quantidade, valor_unitario||null, total, motivo||null);
  res.json({ success: true, id: info.lastInsertRowid });
});

app.get('/stock', authMiddleware, (req, res)=>{
  // compute saldo per product
  const rows = db.prepare(`
    SELECT produto,
      COALESCE((SELECT SUM(quantidade) FROM estoque_movimentos e2 WHERE e2.produto = e.produto AND tipo = 'entrada'),0) as entrada,
      COALESCE((SELECT SUM(quantidade) FROM estoque_movimentos e3 WHERE e3.produto = e.produto AND tipo = 'saida'),0) as saida
    FROM estoque_movimentos e
    GROUP BY produto
  `).all();
  const result = rows.map(r=> ({ produto: r.produto, entrada: r.entrada, saida: r.saida, saldo: (r.entrada - r.saida) }));
  res.json(result);
});

app.get('/stock/history', authMiddleware, (req, res)=>{
  const rows = db.prepare('SELECT * FROM estoque_movimentos ORDER BY data_movimento DESC LIMIT 500').all();
  res.json(rows);
});

// --- Purchases (connects to financial)
app.post('/purchases', authMiddleware, (req, res)=>{
  const { produto, quantity, unit_cost, nota } = req.body;
  if(!produto || !quantity) return res.status(400).json({ error: 'produto e quantity obrigatórios' });
  const total = (unit_cost ? (unit_cost * quantity) : null);
  const stmt = db.prepare('INSERT INTO purchases (produto, quantity, unit_cost, total_cost, nota) VALUES (?, ?, ?, ?, ?)');
  const info = stmt.run(produto, quantity, unit_cost||null, total, nota||null);
  // Also insert into estoque_movimentos as entrada
  const mov = db.prepare('INSERT INTO estoque_movimentos (produto, tipo, quantidade, valor_unitario, valor_total, motivo) VALUES (?, "entrada", ?, ?, ?, ?)');
  mov.run(produto, quantity, unit_cost||null, total, 'compra');
  res.json({ success: true, id: info.lastInsertRowid });
});

app.get('/purchases', authMiddleware, (req, res)=>{
  const rows = db.prepare('SELECT * FROM purchases ORDER BY date DESC LIMIT 500').all();
  res.json(rows);
});

// --- Expenses
app.post('/expenses', authMiddleware, (req, res)=>{
  const { date, description, amount, category } = req.body;
  if(!amount || !description) return res.status(400).json({ error: 'description e amount obrigatórios' });
  const stmt = db.prepare('INSERT INTO expenses (date, description, amount, category) VALUES (?, ?, ?, ?)');
  const info = stmt.run(date||new Date().toISOString(), description, amount, category||null);
  res.json({ success: true, id: info.lastInsertRowid });
});

app.get('/expenses', authMiddleware, (req, res)=>{
  const rows = db.prepare('SELECT * FROM expenses ORDER BY date DESC LIMIT 500').all();
  res.json(rows);
});

// --- Reports basic
app.get('/reports/top-products', authMiddleware, (req, res)=>{
  const { from, to, limit } = req.query;
  let q = `SELECT p.name, SUM(si.qty) as qtd FROM sale_items si JOIN products p ON si.product_id = p.id JOIN sales s ON si.sale_id = s.id WHERE 1=1`;
  const params = [];
  if(from){ q += ' AND date(s.date_time) >= ?'; params.push(from); }
  if(to){ q += ' AND date(s.date_time) <= ?'; params.push(to); }
  q += ' GROUP BY p.name ORDER BY qtd DESC LIMIT ' + (parseInt(limit)||10);
  const rows = db.prepare(q).all(...params);
  res.json(rows);
});

app.get('/reports/top-addons', authMiddleware, (req, res)=>{
  const { from, to, limit } = req.query;
  let q = `SELECT a.name, SUM(sia.qty) as qtd FROM sale_item_addons sia JOIN add_ons a ON sia.addon_id = a.id JOIN sale_items si ON sia.sale_item_id = si.id JOIN sales s ON si.sale_id = s.id WHERE 1=1`;
  const params = [];
  if(from){ q += ' AND date(s.date_time) >= ?'; params.push(from); }
  if(to){ q += ' AND date(s.date_time) <= ?'; params.push(to); }
  q += ' GROUP BY a.name ORDER BY qtd DESC LIMIT ' + (parseInt(limit)||10);
  const rows = db.prepare(q).all(...params);
  res.json(rows);
});

app.get('/reports/faturamento', authMiddleware, (req, res)=>{
  const { from, to } = req.query;
  let q = `SELECT date(s.date_time) as dia, SUM(s.total) as faturamento FROM sales s WHERE 1=1`;
  const params = [];
  if(from){ q += ' AND date(s.date_time) >= ?'; params.push(from); }
  if(to){ q += ' AND date(s.date_time) <= ?'; params.push(to); }
  q += ' GROUP BY date(s.date_time) ORDER BY date(s.date_time)';
  const rows = db.prepare(q).all(...params);
  res.json(rows);
});

app.listen(PORT, ()=> console.log('Server running on port', PORT));
