// Inicializa o banco de dados SQLite com tabelas e dados iniciais
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const db = new sqlite3.Database('./database.sqlite');

// Função utilitária para rodar comandos SQL
function run(sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

(async () => {
  try {
    await run(`
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

    // Inserção de dados iniciais
    const adminHash = await bcrypt.hash('senha123', 10);
    const esposaHash = await bcrypt.hash('senha123', 10);

    db.run(
      `INSERT OR IGNORE INTO users (name, email, password_hash, role)
       VALUES (?, ?, ?, ?)`,
      ['Admin Mega Açaí', 'admin@megaacai', adminHash, 'admin']
    );

    db.run(
      `INSERT OR IGNORE INTO users (name, email, password_hash, role)
       VALUES (?, ?, ?, ?)`,
      ['Esposa Mega Açaí', 'esposa@megaacai', esposaHash, 'admin']
    );

    const apps = ['Ifood', 'Aiqfome', 'MaisDelivery', 'WhatsApp', 'UaiRango'];
    apps.forEach((app) => {
      db.run(`INSERT OR IGNORE INTO apps (name) VALUES (?)`, [app]);
    });

    const payments = ['Pix', 'Dinheiro', 'Cartão Crédito', 'Cartão Débito', 'Pagamento Online'];
    payments.forEach((pay) => {
      db.run(`INSERT OR IGNORE INTO payment_methods (name) VALUES (?)`, [pay]);
    });

    db.run(`INSERT OR IGNORE INTO products (name, price) VALUES (?, ?)`, ['Copo 500ml', 18.0]);

    const addons = [
      ['Banana', 3.0],
      ['Morango', 6.0],
      ['Leite Ninho', 6.0],
    ];
    addons.forEach(([n, p]) => {
      db.run(`INSERT OR IGNORE INTO add_ons (name, price) VALUES (?, ?)`, [n, p]);
    });

    console.log('✅ Banco de dados inicializado com sucesso!');
    db.close();
  } catch (err) {
    console.error('❌ Erro ao inicializar banco:', err);
    db.close();
  }
})();
