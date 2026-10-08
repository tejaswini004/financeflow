require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT || 5000);
const JWT_SECRET = process.env.JWT_SECRET || 'financeflow-dev-secret';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'financeflow'
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const defaultCategories = [
  ['Food & Dining', 'expense', '#f97316'], ['Transport', 'expense', '#06b6d4'],
  ['Shopping', 'expense', '#ec4899'], ['Bills & Utilities', 'expense', '#eab308'],
  ['Health', 'expense', '#22c55e'], ['Education', 'expense', '#3b82f6'],
  ['Entertainment', 'expense', '#a855f7'], ['Rent', 'expense', '#ef4444'],
  ['Salary', 'income', '#22c55e'], ['Freelance', 'income', '#14b8a6'], ['Other Income', 'income', '#84cc16']
];

async function query(text, params = []) { return pool.query(text, params); }

async function initDb() {
  await query(`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, email VARCHAR(150) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL, currency VARCHAR(10) NOT NULL DEFAULT 'INR', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await query(`CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL, type VARCHAR(20) NOT NULL CHECK (type IN ('expense','income')),
    color VARCHAR(20) DEFAULT '#8b5cf6', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await query(`CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('expense','income')), amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    description VARCHAR(255) NOT NULL, transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
    payment_method VARCHAR(50) DEFAULT 'Cash', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await query(`CREATE TABLE IF NOT EXISTS budgets (
    id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE, amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    month DATE NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, category_id, month)
  )`);
  await query(`CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL, message TEXT NOT NULL, kind VARCHAR(30) DEFAULT 'info',
    is_read BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await query('CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, transaction_date DESC)');
  await query('CREATE INDEX IF NOT EXISTS idx_budgets_user_month ON budgets(user_id, month)');
  await query('CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC)');
  const count = await query('SELECT COUNT(*)::int AS count FROM categories WHERE user_id IS NULL');
  if (count.rows[0].count === 0) {
    for (const [name, type, color] of defaultCategories) {
      await query('INSERT INTO categories(user_id,name,type,color) VALUES(NULL,$1,$2,$3)', [name, type, color]);
    }
  }
  await seedDemoAccount();
}

async function seedDemoAccount() {
  const existing = await query('SELECT id FROM users WHERE email=$1', ['demo@financeflow.com']);
  let userId;
  if (!existing.rowCount) {
    const hash = await bcrypt.hash('Demo@123', 10);
    const u = await query('INSERT INTO users(name,email,password_hash,currency) VALUES($1,$2,$3,$4) RETURNING id', ['Demo User','demo@financeflow.com',hash,'INR']);
    userId = u.rows[0].id;
  } else userId = existing.rows[0].id;
  const txCount = await query('SELECT COUNT(*)::int AS count FROM transactions WHERE user_id=$1', [userId]);
  if (txCount.rows[0].count === 0) {
    const cats = await query('SELECT id,name FROM categories WHERE user_id IS NULL OR user_id=$1', [userId]);
    const map = Object.fromEntries(cats.rows.map(x => [x.name, x.id]));
    const tx = [
      ['income',65000,'Monthly Salary','Salary','2026-09-01','Bank Transfer'],
      ['expense',8200,'Hostel / Rent','Rent','2026-09-02','UPI'],
      ['expense',2400,'Groceries','Food & Dining','2026-09-04','UPI'],
      ['expense',950,'College transport','Transport','2026-09-06','UPI'],
      ['expense',1800,'Shopping','Shopping','2026-09-10','Card'],
      ['expense',650,'Movie night','Entertainment','2026-09-14','UPI'],
      ['expense',1200,'Electricity and internet','Bills & Utilities','2026-09-18','UPI'],
      ['expense',1100,'Medicines','Health','2026-09-20','Cash'],
      ['expense',900,'Course materials','Education','2026-09-22','UPI'],
      ['income',8500,'Freelance project','Freelance','2026-09-24','Bank Transfer']
    ];
    for (const [type,amount,description,category,date,payment] of tx) {
      await query('INSERT INTO transactions(user_id,category_id,type,amount,description,transaction_date,payment_method) VALUES($1,$2,$3,$4,$5,$6,$7)', [userId,map[category],type,amount,description,date,payment]);
    }
    for (const [category,amount] of [['Food & Dining',5000],['Transport',3000],['Shopping',4000],['Bills & Utilities',3500],['Entertainment',2500],['Education',2500]]) {
      await query(`INSERT INTO budgets(user_id,category_id,amount,month) VALUES($1,$2,$3,'2026-09-01') ON CONFLICT(user_id,category_id,month) DO UPDATE SET amount=EXCLUDED.amount`, [userId,map[category],amount]);
    }
    await query(`INSERT INTO notifications(user_id,title,message,kind) VALUES($1,$2,$3,$4)`, [userId,'Welcome to FinanceFlow','Your demo financial workspace is ready. Explore transactions, budgets, analytics and reports.','success']);
  }
}

function tokenFor(user) { return jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' }); }
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Authentication required' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ message: 'Session expired. Please login again.' }); }
}
function validId(value) { return Number.isInteger(Number(value)) && Number(value) > 0; }
function monthStart(value) {
  if (!value) return new Date().toISOString().slice(0, 7) + '-01';
  return /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : value;
}

app.get('/api/health', async (_req, res) => {
  try { await query('SELECT 1'); res.json({ ok: true, database: 'PostgreSQL' }); }
  catch (e) { res.status(500).json({ ok: false, message: e.message }); }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, currency = 'INR' } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: 'Name, email and password are required.' });
    if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    const cleanEmail = String(email).trim().toLowerCase();
    const exists = await query('SELECT id FROM users WHERE email=$1', [cleanEmail]);
    if (exists.rowCount) return res.status(409).json({ message: 'Email already registered.' });
    const hash = await bcrypt.hash(password, 10);
    const result = await query('INSERT INTO users(name,email,password_hash,currency) VALUES($1,$2,$3,$4) RETURNING id,name,email,currency', [name.trim(), cleanEmail, hash, currency]);
    res.status(201).json({ token: tokenFor(result.rows[0]), user: result.rows[0] });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await query('SELECT * FROM users WHERE email=$1', [String(email || '').trim().toLowerCase()]);
    if (!result.rowCount || !(await bcrypt.compare(password || '', result.rows[0].password_hash))) return res.status(401).json({ message: 'Invalid email or password.' });
    const u = result.rows[0];
    res.json({ token: tokenFor(u), user: { id: u.id, name: u.name, email: u.email, currency: u.currency } });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/auth/me', auth, async (req, res) => {
  const r = await query('SELECT id,name,email,currency FROM users WHERE id=$1', [req.user.id]);
  res.json(r.rows[0]);
});

app.get('/api/categories', auth, async (req, res) => {
  const r = await query(`SELECT id,user_id,name,type,color FROM categories WHERE user_id IS NULL OR user_id=$1 ORDER BY type,name`, [req.user.id]);
  res.json(r.rows);
});

app.post('/api/categories', auth, async (req, res) => {
  const { name, type = 'expense', color = '#8b5cf6' } = req.body;
  if (!name || !['expense', 'income'].includes(type)) return res.status(400).json({ message: 'Valid category name and type are required.' });
  const r = await query('INSERT INTO categories(user_id,name,type,color) VALUES($1,$2,$3,$4) RETURNING *', [req.user.id, name.trim(), type, color]);
  res.status(201).json(r.rows[0]);
});

app.delete('/api/categories/:id', auth, async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid category id.' });
  const r = await query('DELETE FROM categories WHERE id=$1 AND user_id=$2 RETURNING id', [req.params.id, req.user.id]);
  if (!r.rowCount) return res.status(404).json({ message: 'Custom category not found.' });
  res.json({ message: 'Category deleted.' });
});

app.get('/api/transactions', auth, async (req, res) => {
  const { type, from, to, search, limit = 200 } = req.query;
  const params = [req.user.id]; let where = 't.user_id=$1';
  if (type && ['expense', 'income'].includes(type)) { params.push(type); where += ` AND t.type=$${params.length}`; }
  if (from) { params.push(from); where += ` AND t.transaction_date >= $${params.length}`; }
  if (to) { params.push(to); where += ` AND t.transaction_date <= $${params.length}`; }
  if (search) { params.push(`%${search}%`); where += ` AND (LOWER(t.description) LIKE LOWER($${params.length}) OR LOWER(COALESCE(c.name,'')) LIKE LOWER($${params.length}))`; }
  params.push(Math.min(Number(limit) || 200, 500));
  const r = await query(`SELECT t.id,t.type,t.amount,t.description,t.transaction_date,t.payment_method,t.category_id,COALESCE(c.name,'Uncategorized') category,COALESCE(c.color,'#8b5cf6') color
    FROM transactions t LEFT JOIN categories c ON c.id=t.category_id WHERE ${where} ORDER BY t.transaction_date DESC,t.id DESC LIMIT $${params.length}`, params);
  res.json(r.rows);
});

app.post('/api/transactions', auth, async (req, res) => {
  try {
    const { type, amount, description, transaction_date, category_id, payment_method = 'Cash' } = req.body;
    if (!['expense','income'].includes(type) || Number(amount) <= 0 || !description) return res.status(400).json({ message: 'Type, positive amount and description are required.' });
    let category = null;
    if (category_id) {
      const cr = await query('SELECT id FROM categories WHERE id=$1 AND (user_id IS NULL OR user_id=$2)', [category_id, req.user.id]);
      if (!cr.rowCount) return res.status(400).json({ message: 'Invalid category.' });
      category = category_id;
    }
    const r = await query(`INSERT INTO transactions(user_id,category_id,type,amount,description,transaction_date,payment_method)
      VALUES($1,$2,$3,$4,$5,COALESCE($6::date,CURRENT_DATE),$7) RETURNING *`, [req.user.id, category, type, Number(amount), description.trim(), transaction_date || null, payment_method]);
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put('/api/transactions/:id', auth, async (req, res) => {
  const { type, amount, description, transaction_date, category_id, payment_method = 'Cash' } = req.body;
  if (!validId(req.params.id) || !['expense','income'].includes(type) || Number(amount) <= 0 || !description) return res.status(400).json({ message: 'Invalid transaction data.' });
  const r = await query(`UPDATE transactions SET type=$1,amount=$2,description=$3,transaction_date=$4,category_id=$5,payment_method=$6
    WHERE id=$7 AND user_id=$8 RETURNING *`, [type, Number(amount), description.trim(), transaction_date, category_id || null, payment_method, req.params.id, req.user.id]);
  if (!r.rowCount) return res.status(404).json({ message: 'Transaction not found.' });
  res.json(r.rows[0]);
});

app.delete('/api/transactions/:id', auth, async (req, res) => {
  const r = await query('DELETE FROM transactions WHERE id=$1 AND user_id=$2 RETURNING id', [req.params.id, req.user.id]);
  if (!r.rowCount) return res.status(404).json({ message: 'Transaction not found.' });
  res.json({ message: 'Transaction deleted.' });
});

app.get('/api/dashboard', auth, async (req, res) => {
  const currentMonth = monthStart(req.query.month);
  const totals = await query(`SELECT
    COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) income,
    COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) expenses,
    COUNT(*)::int transaction_count
    FROM transactions WHERE user_id=$1 AND transaction_date >= $2::date AND transaction_date < ($2::date + INTERVAL '1 month')`, [req.user.id, currentMonth]);
  const byCategory = await query(`SELECT COALESCE(c.name,'Uncategorized') category,COALESCE(c.color,'#8b5cf6') color,COALESCE(SUM(t.amount),0) amount
    FROM transactions t LEFT JOIN categories c ON c.id=t.category_id WHERE t.user_id=$1 AND t.type='expense'
    AND t.transaction_date >= $2::date AND t.transaction_date < ($2::date + INTERVAL '1 month') GROUP BY c.name,c.color ORDER BY amount DESC`, [req.user.id, currentMonth]);
  const recent = await query(`SELECT t.id,t.type,t.amount,t.description,t.transaction_date,t.payment_method,COALESCE(c.name,'Uncategorized') category,COALESCE(c.color,'#8b5cf6') color
    FROM transactions t LEFT JOIN categories c ON c.id=t.category_id WHERE t.user_id=$1 ORDER BY t.transaction_date DESC,t.id DESC LIMIT 8`, [req.user.id]);
  const budget = await query(`SELECT b.id,b.amount,b.month,b.category_id,c.name category,c.color,
    COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.user_id=b.user_id AND t.category_id=b.category_id AND t.type='expense' AND t.transaction_date >= b.month AND t.transaction_date < (b.month + INTERVAL '1 month')),0) spent
    FROM budgets b JOIN categories c ON c.id=b.category_id WHERE b.user_id=$1 AND b.month=$2::date ORDER BY c.name`, [req.user.id, currentMonth]);
  const t = totals.rows[0];
  res.json({ totals: { income:Number(t.income), expenses:Number(t.expenses), balance:Number(t.income)-Number(t.expenses), transaction_count:t.transaction_count }, byCategory:byCategory.rows.map(x=>({...x,amount:Number(x.amount)})), recent:recent.rows, budgets:budget.rows.map(x=>({...x,amount:Number(x.amount),spent:Number(x.spent)})) });
});

app.get('/api/analytics', auth, async (req, res) => {
  try {
    const months = await query(`
      WITH month_series AS (
        SELECT generate_series(
          date_trunc('month', CURRENT_DATE) - INTERVAL '5 months',
          date_trunc('month', CURRENT_DATE),
          INTERVAL '1 month'
        ) AS month_start
      )
      SELECT
        TO_CHAR(month_series.month_start, 'YYYY-MM') AS month_name,
        COALESCE(
          SUM(
            CASE
              WHEN t.type = 'income' THEN t.amount
              ELSE 0
            END
          ), 0
        ) AS income,
        COALESCE(
          SUM(
            CASE
              WHEN t.type = 'expense' THEN t.amount
              ELSE 0
            END
          ), 0
        ) AS expenses
      FROM month_series
      LEFT JOIN transactions t
        ON t.user_id = $1
        AND date_trunc('month', t.transaction_date::timestamp)
            = month_series.month_start
      GROUP BY month_series.month_start
      ORDER BY month_series.month_start
    `, [req.user.id]);

    const categories = await query(`
      SELECT
        COALESCE(c.name, 'Uncategorized') AS category,
        COALESCE(c.color, '#8b5cf6') AS color,
        COALESCE(SUM(t.amount), 0) AS amount
      FROM transactions t
      LEFT JOIN categories c
        ON c.id = t.category_id
      WHERE
        t.user_id = $1
        AND t.type = 'expense'
        AND t.transaction_date >= CURRENT_DATE - INTERVAL '6 months'
      GROUP BY c.name, c.color
      ORDER BY amount DESC
    `, [req.user.id]);

    res.json({
      monthly: months.rows.map(x => ({
        month: x.month_name,
        income: Number(x.income),
        expenses: Number(x.expenses)
      })),
      categories: categories.rows.map(x => ({
        ...x,
        amount: Number(x.amount)
      }))
    });

  } catch (e) {
    console.error('Analytics error:', e);
    res.status(500).json({
      message: 'Failed to load analytics.',
      error: e.message
    });
  }
});

app.get('/api/budgets', auth, async (req, res) => {
  try {
    const month = monthStart(req.query.month);

    const r = await query(`
      SELECT
        b.id,
        b.amount,
        b.month,
        b.category_id,
        c.name AS category,
        c.color,
        COALESCE(
          (
            SELECT SUM(t.amount)
            FROM transactions t
            WHERE t.user_id = b.user_id
              AND t.category_id = b.category_id
              AND t.type = 'expense'
              AND t.transaction_date >= b.month
              AND t.transaction_date < (b.month + INTERVAL '1 month')
          ), 0
        ) AS spent
      FROM budgets b
      JOIN categories c ON c.id = b.category_id
      WHERE b.user_id = $1
        AND b.month = $2::date
      ORDER BY c.name
    `, [req.user.id, month]);

    res.json(
      r.rows.map(x => ({
        ...x,
        amount: Number(x.amount),
        spent: Number(x.spent)
      }))
    );

  } catch (e) {
    console.error('Budgets error:', e);
    res.status(500).json({
      message: 'Failed to load budgets.',
      error: e.message
    });
  }
});

app.post('/api/budgets', auth, async (req, res) => {
  try {
    const { category_id, amount, month } = req.body;

    if (!validId(category_id) || Number(amount) <= 0) {
      return res.status(400).json({
        message: 'Category and positive amount are required.'
      });
    }

    const cr = await query(
      `SELECT id
       FROM categories
       WHERE id = $1
         AND (user_id IS NULL OR user_id = $2)
         AND type = 'expense'`,
      [category_id, req.user.id]
    );

    if (!cr.rowCount) {
      return res.status(400).json({
        message: 'Invalid expense category.'
      });
    }

    const r = await query(`
      INSERT INTO budgets(user_id, category_id, amount, month)
      VALUES($1, $2, $3, $4::date)
      ON CONFLICT(user_id, category_id, month)
      DO UPDATE SET amount = EXCLUDED.amount
      RETURNING *
    `, [
      req.user.id,
      category_id,
      Number(amount),
      monthStart(month)
    ]);

    res.status(201).json(r.rows[0]);

  } catch (e) {
    console.error('Create budget error:', e);
    res.status(500).json({
      message: 'Failed to save budget.',
      error: e.message
    });
  }
});

app.delete('/api/budgets/:id', auth, async (req, res) => {
  try {
    const r = await query(
      `DELETE FROM budgets
       WHERE id = $1
         AND user_id = $2
       RETURNING id`,
      [req.params.id, req.user.id]
    );

    if (!r.rowCount) {
      return res.status(404).json({
        message: 'Budget not found.'
      });
    }

    res.json({
      message: 'Budget deleted.'
    });

  } catch (e) {
    console.error('Delete budget error:', e);
    res.status(500).json({
      message: 'Failed to delete budget.',
      error: e.message
    });
  }
});

app.get('/api/notifications', auth, async (req, res) => {
  try {
    const r = await query(
      `SELECT *
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 30`,
      [req.user.id]
    );

    res.json(r.rows);

  } catch (e) {
    console.error('Notifications error:', e);
    res.status(500).json({
      message: 'Failed to load notifications.',
      error: e.message
    });
  }
});

app.post('/api/notifications/read-all', auth, async (req, res) => {
  try {
    await query(
      'UPDATE notifications SET is_read = true WHERE user_id = $1',
      [req.user.id]
    );

    res.json({
      message: 'Notifications marked as read.'
    });

  } catch (e) {
    console.error('Notification update error:', e);
    res.status(500).json({
      message: 'Failed to update notifications.',
      error: e.message
    });
  }
});

app.get('/api/reports', auth, async (req, res) => {
  try {
    const from =
      req.query.from ||
      new Date(new Date().setDate(1))
        .toISOString()
        .slice(0, 10);

    const to =
      req.query.to ||
      new Date()
        .toISOString()
        .slice(0, 10);

    const r = await query(`
      SELECT
        t.id,
        t.transaction_date,
        t.type,
        t.amount,
        t.description,
        t.payment_method,
        COALESCE(c.name, 'Uncategorized') AS category
      FROM transactions t
      LEFT JOIN categories c
        ON c.id = t.category_id
      WHERE t.user_id = $1
        AND t.transaction_date BETWEEN $2::date AND $3::date
      ORDER BY t.transaction_date DESC, t.id DESC
    `, [req.user.id, from, to]);

    const summary = await query(`
      SELECT
        COALESCE(
          SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END),
          0
        ) AS income,
        COALESCE(
          SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END),
          0
        ) AS expenses,
        COUNT(*)::int AS count
      FROM transactions
      WHERE user_id = $1
        AND transaction_date BETWEEN $2::date AND $3::date
    `, [req.user.id, from, to]);

    res.json({
      from,
      to,
      transactions: r.rows,
      summary: {
        income: Number(summary.rows[0].income),
        expenses: Number(summary.rows[0].expenses),
        count: summary.rows[0].count
      }
    });

  } catch (e) {
    console.error('Reports error:', e);
    res.status(500).json({
      message: 'Failed to load reports.',
      error: e.message
    });
  }
});

app.use((_req, res) => {
  res.sendFile(
    path.join(__dirname, 'public', 'index.html')
  );
});

async function start() {
  try {
    await query('SELECT 1');

    console.log('✓ PostgreSQL connected');

    await initDb();

    console.log('✓ Database tables and indexes ready');

    app.listen(PORT, () => {
      console.log(
        `✓ FinanceFlow running at http://localhost:${PORT}`
      );
    });

  } catch (e) {
    console.error(
      '\n✗ PostgreSQL connection failed.\n',
      e.message
    );

    process.exit(1);
  }
}

start();