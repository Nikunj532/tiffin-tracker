// Seeds a demo owner with plans, customers, subscriptions and pauses.
// Usage: npm run seed   (login: demo@tiffin.app / demo1234)
import bcrypt from 'bcryptjs';
import { openDb, tx } from './db.js';
import { addDays, todayLocal } from './dates.js';

const db = openDb();
const EMAIL = 'demo@tiffin.app';

const FIRST = ['Aarav', 'Priya', 'Rohan', 'Sneha', 'Vikram', 'Ananya', 'Karan', 'Meera', 'Arjun', 'Divya', 'Rahul', 'Kavya',
  'Siddharth', 'Pooja', 'Aditya', 'Neha', 'Manish', 'Isha', 'Farhan', 'Lakshmi', 'Gaurav', 'Tanvi', 'Nikhil', 'Ritu',
  'Yash', 'Zoya', 'Harsh', 'Bhavna', 'Omkar', 'Swati', 'Deepak', 'Jaya'];
const LAST = ['Sharma', 'Iyer', 'Patel', 'Reddy', 'Nair', 'Gupta', 'Kulkarni', 'Das', 'Khan', 'Menon', 'Joshi', 'Singh'];
const AREAS = ['Koramangala', 'Indiranagar', 'HSR Layout', 'Whitefield', 'BTM Layout', 'Jayanagar'];
const REASONS = ['Travel', 'Diwali at hometown', 'Work from office canteen', 'Unwell', 'Family function'];

tx(db, () => {
  db.prepare('DELETE FROM users WHERE email = ?').run(EMAIL);
  const ownerId = db.prepare('INSERT INTO users (name, business_name, email, password_hash) VALUES (?, ?, ?, ?)')
    .run('Demo Owner', 'Annapurna Tiffins', EMAIL, bcrypt.hashSync('demo1234', 10)).lastInsertRowid;

  const addPlan = db.prepare('INSERT INTO plans (owner_id, name, description, price_paise) VALUES (?, ?, ?, ?)');
  const plans = [
    addPlan.run(ownerId, 'Veg Mini', '3 rotis, dal, sabzi', 250000).lastInsertRowid,
    addPlan.run(ownerId, 'Veg Full Thali', '4 rotis, rice, dal, 2 sabzi, salad', 350000).lastInsertRowid,
    addPlan.run(ownerId, 'Non-Veg Thali', 'Thali with chicken/egg curry', 450000).lastInsertRowid,
  ];
  const planPrice = Object.fromEntries(db.prepare('SELECT id, price_paise FROM plans WHERE owner_id = ?').all(ownerId).map((p) => [p.id, p.price_paise]));

  const today = todayLocal();
  const addCustomer = db.prepare('INSERT INTO customers (owner_id, name, phone, address, created_at) VALUES (?, ?, ?, ?, ?)');
  const addSub = db.prepare('INSERT INTO subscriptions (customer_id, plan_id, price_paise, start_date, end_date) VALUES (?, ?, ?, ?, ?)');
  const addPause = db.prepare('INSERT INTO pauses (subscription_id, start_date, end_date, reason) VALUES (?, ?, ?, ?)');

  for (let i = 0; i < FIRST.length; i++) {
    const name = `${FIRST[i]} ${LAST[i % LAST.length]}`;
    const phone = `98${String(45000000 + i * 7919).padStart(8, '0')}`;
    const cid = addCustomer.run(ownerId, name, phone, `${10 + i}, ${AREAS[i % AREAS.length]}, Bengaluru`, `${addDays(today, -60 + i)} 10:00:00`).lastInsertRowid;

    if (i % 11 === 10) continue; // a few customers never subscribed
    const planId = plans[i % plans.length];
    const start = i % 9 === 8 ? addDays(today, 5) : addDays(today, -75 + i * 2); // some upcoming
    const end = i % 13 === 12 ? addDays(today, -10) : null; // some ended
    const sid = addSub.run(cid, planId, planPrice[planId], start, end).lastInsertRowid;

    if (end || start > today) continue; // pauses only for running subscriptions
    if (i % 4 === 0) addPause.run(sid, addDays(today, -2), addDays(today, 3), REASONS[i % REASONS.length]); // paused now
    if (i % 5 === 1) addPause.run(sid, addDays(today, -25), addDays(today, -21), REASONS[i % REASONS.length]); // past pause
    if (i % 7 === 3 && i % 4 !== 0) addPause.run(sid, addDays(today, -1), null, 'Until further notice'); // open-ended
  }
});

console.log('Seeded demo data. Login with demo@tiffin.app / demo1234');
