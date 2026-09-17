import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError, requireAuth } from './http.js';
import authRoutes from './routes/auth.js';
import planRoutes from './routes/plans.js';
import customerRoutes from './routes/customers.js';
import subscriptionRoutes from './routes/subscriptions.js';
import billRoutes from './routes/bills.js';
import dashboardRoutes from './routes/dashboard.js';

export function createApp(db, { log = true } = {}) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));

  if (log) {
    app.use((req, res, next) => {
      const t0 = Date.now();
      res.on('finish', () => {
        if (req.path.startsWith('/api')) console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - t0}ms)`);
      });
      next();
    });
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes(db));
  app.use('/api/plans', requireAuth, planRoutes(db));
  app.use('/api/customers', requireAuth, customerRoutes(db));
  app.use('/api/bills', requireAuth, billRoutes(db));
  app.use('/api/dashboard', requireAuth, dashboardRoutes(db));
  app.use('/api', requireAuth, subscriptionRoutes(db));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'API route not found')));

  // Serve the built React app in production (single deployable).
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'Malformed JSON body');
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message, details: err.details });
  });

  return app;
}
