import { openDb } from './db.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT) || 4000;
const db = openDb();
if (!process.env.JWT_SECRET) console.log('JWT_SECRET not set; using a random secret generated for this database');

createApp(db).listen(port, () => {
  console.log(`Tiffin Tracker API listening on http://localhost:${port}`);
});
