require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const pool = new Pool({host:process.env.DB_HOST||'localhost',port:Number(process.env.DB_PORT||5432),user:process.env.DB_USER||'postgres',password:process.env.DB_PASSWORD||'',database:process.env.DB_NAME||'financeflow'});
async function run(){
  const hash=await bcrypt.hash('Demo@123',10);
  const u=await pool.query(`INSERT INTO users(name,email,password_hash,currency) VALUES($1,$2,$3,'INR') ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name RETURNING id`,['Demo User','demo@financeflow.com',hash]);
  const uid=u.rows[0].id;
  const cats=await pool.query(`SELECT id,name FROM categories WHERE user_id IS NULL OR user_id=$1`,[uid]);
  const map=Object.fromEntries(cats.rows.map(x=>[x.name,x.id]));
  await pool.query('DELETE FROM transactions WHERE user_id=$1',[uid]);
  await pool.query('DELETE FROM budgets WHERE user_id=$1',[uid]);
  const tx=[
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
  for(const [type,amount,desc,cat,date,pay] of tx) await pool.query(`INSERT INTO transactions(user_id,category_id,type,amount,description,transaction_date,payment_method) VALUES($1,$2,$3,$4,$5,$6,$7)`,[uid,map[cat],type,amount,desc,date,pay]);
  for(const [cat,amount] of [['Food & Dining',5000],['Transport',3000],['Shopping',4000],['Bills & Utilities',3500],['Entertainment',2500],['Education',2500]]) await pool.query(`INSERT INTO budgets(user_id,category_id,amount,month) VALUES($1,$2,$3,'2026-09-01') ON CONFLICT(user_id,category_id,month) DO UPDATE SET amount=EXCLUDED.amount`,[uid,map[cat],amount]);
  await pool.query(`INSERT INTO notifications(user_id,title,message,kind) VALUES($1,'Welcome to FinanceFlow','Your demo financial workspace is ready. Explore transactions, budgets, analytics and reports.','success')`,[uid]);
  console.log('✓ Demo account seeded: demo@financeflow.com / Demo@123');
  await pool.end();
}
run().catch(e=>{console.error(e.message);pool.end();process.exit(1)});
