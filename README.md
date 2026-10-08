# FinanceFlow — Expense Tracker & Finance Management

A complete jury-ready personal finance management project built with **PostgreSQL + Node.js + Express + HTML + CSS + Vanilla JavaScript**.

## Features
- Register / Login with JWT authentication
- Demo account
- Dashboard with income, expenses, balance and savings rate
- Add, edit and delete transactions
- Income and expense categories
- Monthly budgets with progress and alerts
- Notifications for budget limits
- Analytics charts using Chart.js
- Reports with date filters and CSV export
- Responsive modern dark finance UI
- PostgreSQL tables and indexes auto-created by the backend
- Seeded demo data

## Tech Stack
- Frontend: HTML5, CSS3, JavaScript (no React)
- Backend: Node.js, Express.js
- Database: PostgreSQL
- Authentication: JWT + bcryptjs
- Charts: Chart.js CDN

## 1. Create PostgreSQL database
Open pgAdmin 4:
1. Expand your PostgreSQL server.
2. Right-click **Databases** → **Create** → **Database**.
3. Database name: `financeflow`
4. Owner: `postgres`
5. Click Save.

You do NOT need to manually create tables. The Node.js app creates them automatically.

## 2. Configure database password
Open the project folder in VS Code. Copy `.env.example` and rename the copy to `.env`.

Set your PostgreSQL password:

DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=YOUR_POSTGRES_PASSWORD
DB_NAME=financeflow
JWT_SECRET=change_this_to_a_long_random_secret

If your PostgreSQL installation uses a different host/port/user, change those values.

## 3. Install dependencies
Open VS Code Terminal in the project folder:

```bash
npm install
```

## 4. Start the project
```bash
npm start
```

You should see:
- PostgreSQL connected
- Database tables ready
- Server running on http://localhost:5000

Open:
http://localhost:5000

## Demo login
Email: `demo@financeflow.com`
Password: `Demo@123`

The demo account is created automatically on first server start.

## If you see database authentication errors
Check `.env` carefully. The most common issue is an incorrect PostgreSQL password. You can test your PostgreSQL login from pgAdmin first.

## Project structure
```
FinanceFlow_PostgreSQL/
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── .env.example
├── .gitignore
├── database.sql
├── package.json
├── seed.js
├── server.js
└── README.md
```
