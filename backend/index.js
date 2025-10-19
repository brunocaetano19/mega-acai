const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const db = new sqlite3.Database('./database.sqlite', (err) => {
  if (err) console.error('Erro ao conectar no SQLite:', err.message);
  else console.log('Conectado ao banco SQLite');
});

// Promisify para usar async/await
const dbGet = promisify(db.get.bind(db));
const dbAll = promisify(db.all.bind(db));
const dbRun = promisify(db.run.bind(db));

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'trocasegura';

app.use(cors());
app.use(bodyParser.json());

// --- Auth
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email e senha são obrigatórios' });

  try {
    const row = await dbGet('SELECT * FROM users WHERE email = ?', [email]);
    if (!row) return res.status(401).json({ error: 'Credenciais inválidas' });

    const match = await bcrypt.compare(password, row.password_hash);
    if (!match) return res.status(401).json({ error: 'Credenciais inválidas' });

    const token = jwt.sign(
      { userId: row.id, role: row.role, name: row.name },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({ token, user: { id: row.id, name: row.name, email: row.email, role: row.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro no login' });
  }
});

// --- Middleware
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

// --- Basic endpoints (public read)
app.get('/apps', async (req, res) => {
  try {
    const rows = await dbAll('SELECT * FROM apps');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar apps' });
  }
});

app.get('/payment_methods', async (req, res) => {
  try {
    const rows = await dbAll('SELECT * FROM payment_methods');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar métodos de pagamento' });
  }
});

app.get('/products', async (req, res) => {
  try {
    const rows = await dbAll('SELECT * FROM products WHERE active = 1');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar produtos' });
  }
});

app.get('/add_ons', async (req, res) => {
  try {
    const rows = await dbAll('SELECT * FROM add_ons WHERE active = 1');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar adicionais' });
  }
});

// --- Sales
app.post('/sales', authMiddleware, async (req, res) => {
  const { items, delivery_fee, app_id, payment_method_id, note } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Itens são obrigatórios' });

  try {
    let total = 0;
    items.forEach(it => {
      total += it.price_unit * (it.qty || 1);
      if (it.addons) it.addons.forEach(a => total += a.price_unit * (a.qty || 1));
    });
    if (delivery_fee) total += Number(delivery_fee);

    const saleInfo = await dbRun(
      'INSERT INTO sales (total, delivery_fee, app_id, payment_method_id, user_id, note) VALUES (?, ?, ?, ?, ?, ?)',
      [total, delivery_fee || 0, app_id || null, payment_method_id || null, req.user.userId, note || null]
    );
    const saleId = saleInfo.lastID;

    for (const it of items) {
      const subtotal = it.price_unit * (it.qty || 1);
      const r = await dbRun(
        'INSERT INTO sale_items (sale_id, product_id, qty, price_unit, subtotal) VALUES (?, ?, ?, ?, ?)',
        [saleId, it.product_id, it.qty || 1, it.price_unit, subtotal]
      );
      const saleItemId = r.lastID;

      if (it.addons) {
        for (const a of it.addons) {
          const sub = a.price_unit * (a.qty || 1);
          await dbRun(
            'INSERT INTO sale_item_addons (sale_item_id, addon_id, qty, price_unit, subtotal) VALUES (?, ?, ?, ?, ?)',
            [saleItemId, a.addon_id, a.qty || 1, a.price_unit, sub]
          );
        }
      }
    }

    res.json({ success: true, sale_id: saleId, total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao registrar venda' });
  }
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar vendas' });
  }
});

app.get('/sales/:id', authMiddleware, async (req, res) => {
  const id = req.params.id;
  try {
    const sale = await dbGet('SELECT * FROM sales WHERE id = ?', [id]);
    if (!sale) return res.status(404).json({ error: 'Venda não encontrada' });

    const items = await dbAll(
      'SELECT si.*, pr.name as product_name FROM sale_items si LEFT JOIN products pr ON si.product_id = pr.id WHERE si.sale_id = ?',
      [id]
    );

    for (const it of items) {
      it.addons = await dbAll(
        'SELECT sia.*, a.name as addon_name FROM sale_item_addons sia LEFT JOIN add_ons a ON sia.addon_id = a.id WHERE sia.sale_item_id = ?',
        [it.id]
      );
    }

    res.json({ sale, items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar venda' });
  }
});

// --- Stock
app.post('/stock/movements', authMiddleware, async (req, res) => {
  const { produto, tipo, quantidade, valor_unitario, motivo } = req.body;
  if (!produto || !tipo || !quantidade) return res.status(400).json({ error: 'produto, tipo e quantidade obrigatórios' });

  try {
    const total = valor_unitario ? valor_unitario * quantidade : null;
    const info = await dbRun(
      'INSERT INTO estoque_movimentos (produto, tipo, quantidade, valor_unitario, valor_total, motivo) VALUES (?, ?, ?, ?, ?, ?)',
      [produto, tipo, quantidade, valor_unitario || null, total, motivo || null]
    );
    res.json({ success: true, id: info.lastID });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao registrar movimento de estoque' });
  }
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

    const result = rows.map(r => ({ produto: r.produto, entrada: r.entrada, saida: r.saida, saldo: r.entrada - r.saida }));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar estoque' });
  }
});

app.get('/stock/history', authMiddleware, async (req, res) => {
  try {
    const rows = await dbAll('SELECT * FROM estoque_movimentos ORDER BY data_movimento DESC LIMIT 500');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar histórico de estoque' });
  }
});

// --- Purchases
app.post('/purchases', authMiddleware, async (req, res) => {
  const { produto, quantity, unit_cost, nota } = req.body;
  if (!produto || !quantity) return res.status(400).json({ error: 'produto e quantity obrigatórios' });

  try {
    const total = unit_cost ? unit_cost * quantity : null;
    const info = await dbRun(
      'INSERT INTO purchases (produto, quantity, unit_cost, total_cost, nota) VALUES (?, ?, ?, ?, ?)',
      [produto, quantity, unit_cost || null, total, nota || null]
    );

    await dbRun(
      'INSERT INTO estoque_movimentos (produto, tipo, quantidade, valor_unitario, valor_total, motivo) VALUES (?, "entrada", ?, ?, ?, ?)',
      [produto, quantity, unit_cost || null, total, 'compra']
    );

    res.json({ success: true, id: info.lastID });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao registrar compra' });
  }
});

app.get('/purchases', authMiddleware, async (req, res) => {
  try {
    const rows = await dbAll('SELECT * FROM purchases ORDER BY date DESC LIMIT 500');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar compras' });
  }
});

// --- Expenses
app.post('/expenses', authMiddleware, async (req, res) => {
  const { date, description, amount, category } = req.body;
  if (!amount || !description) return res.status(400).json({ error: 'description e amount obrigatórios' });

  try {
    const info = await dbRun(
      'INSERT INTO expenses (date, description, amount, category) VALUES (?, ?, ?, ?)',
      [date || new Date().toISOString(), description, amount, category || null]
    );
    res.json({ success: true, id: info.lastID });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao registrar despesa' });
  }
});

app.get('/expenses', authMiddleware, async (req, res) => {
  try {
    const rows = await dbAll('SELECT * FROM expenses ORDER BY date DESC LIMIT 500');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar despesas' });
  }
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao gerar relatório' });
  }
});

app.get('/reports/top-addons', authMiddleware, async (req, res) => {
  const { from, to, limit } = req.query;
  try {
    let q = `SELECT a.name, SUM(sia.qty) as qtd FROM sale_item_addons sia 
             JOIN add_ons a ON sia.addon_id = a.id 
             JOIN sale_items si ON sia.sale_item_id = si.id 
             JOIN sales s ON si.sale_id = s.id WHERE 1=1`;
    const params = [];
    if (from) { q += ' AND date(s.date_time) >= ?'; params.push(from); }
    if (to) { q += ' AND date(s.date_time) <= ?'; params.push(to); }
    q += ' GROUP BY a.name ORDER BY qtd DESC LIMIT ' + (parseInt(limit) || 10);

    const rows = await dbAll(q, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao gerar relatório' });
  }
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao gerar relatório' });
  }
});

// --- Start server
app.listen(PORT, () => console.log('Server running on port', PORT));
