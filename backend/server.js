/**
 * CeloPay Backend Server
 * Handles: Self KYC webhooks, receipt generation, x402, shared DB
 */

import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath as _ftu } from 'url';
dotenv.config({ path: resolve(dirname(_ftu(import.meta.url)), '.env') });
import express from 'express';
import { EventEmitter } from 'events';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { initDB, TX_CTE } from './db/index.js';
import { runEsusuCron } from './services/esusu-cron.js';
import verifyRoutes  from './routes/verify.js';
import receiptRoutes from './routes/receipt.js';
import x402Routes   from './routes/x402.js';
import apiRoutes     from './routes/api.js';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './swagger.js';

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Event Bus (shared between routes and bot) ────────────────────────────────
app.locals.events = new EventEmitter();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));
app.use(express.static(path.join(__dirname, '../frontend')));
app.use(express.urlencoded({ extended: true }));

// Request logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/verify',  verifyRoutes);
app.use('/receipt', receiptRoutes);
app.use('/x402',    x402Routes);
app.use('/api',     apiRoutes);

// Swagger Documentation UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'celopay-backend',
    timestamp: new Date().toISOString(),
    network: 'celo-sepolia',
    env: process.env.NODE_ENV || 'development'
  });
});

// ─── Admin Dashboard ────────────────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/admin.html'));
});

// ─── Admin Stats Endpoint ─────────────────────────────────────────────────────
app.get('/admin/stats', (req, res) => {
  // Simple auth check
  const adminKey = req.headers['x-admin-key'];
  if (process.env.NODE_ENV !== 'test' && adminKey !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const page = parseInt(req.query.page) || 1;
  const limit = 5;
  const offset = (page - 1) * limit;

  try {
    const { getDB } = req.app.locals;
    if (!getDB) return res.json({ message: 'DB not attached to app.locals' });

    const db = getDB();
    const stats = {
      users: {
        total: db.prepare('SELECT COUNT(*) as n FROM users').get().n,
        verified: db.prepare('SELECT COUNT(*) as n FROM users WHERE self_verified = 1').get().n,
        flagged: db.prepare('SELECT COUNT(*) as n FROM users WHERE flagged = 1').get().n
      },
      transactions: {
        total: db.prepare(TX_CTE + 'SELECT COUNT(*) as n FROM all_txs').get().n,
        today: db.prepare(TX_CTE + "SELECT COUNT(*) as n FROM all_txs WHERE created_at >= date('now')").get().n,
        failed: db.prepare(TX_CTE + "SELECT COUNT(*) as n FROM all_txs WHERE status = 'failed'").get().n,
        volume_cusd: db.prepare(TX_CTE + "SELECT COALESCE(SUM(amount_cusd), 0) as s FROM all_txs WHERE status = 'confirmed'").get().s
      },
      circles: {
        total: db.prepare('SELECT COUNT(*) as n FROM esusu_circles').get().n,
        active: db.prepare("SELECT COUNT(*) as n FROM esusu_circles WHERE status = 'active'").get().n
      },
      recent_transactions: db.prepare(TX_CTE + `
        SELECT * FROM all_txs
        ORDER BY created_at DESC LIMIT ? OFFSET ?
      `).all(limit, offset),
      recent_transactions_total: db.prepare(TX_CTE + "SELECT COUNT(*) as n FROM all_txs").get().n
    };
    
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
async function start() {
  // Initialize database
  const db = initDB();
  app.locals.db = db;
  app.locals.getDB = () => db;

  app.listen(PORT, '127.0.0.1', () => {
    console.log(`\n╔══════════════════════════════════════════╗`);
    console.log(`║   Zapp Backend Server                 ║`);
    console.log(`╚══════════════════════════════════════════╝`);
    console.log(`🚀 Running on http://localhost:${PORT}`)
    // Esusu cron — runs every minute
    setInterval(async () => {
      try { await runEsusuCron(); }
      catch (err) { console.error('Esusu cron error:', err.message); }
    }, 60 * 1000);
    console.log('⏰ Esusu cron started — checking circles every minute');;
    console.log(`🌐 Network:  Celo Sepolia Testnet (chainId 11142220)`);
    console.log(`🗄️  Database: ${process.env.DB_PATH || './db/zapp.sqlite'}`);
    console.log(`\nEndpoints:`);
    console.log(`  GET  /health`);
    console.log(`  POST /verify/self/webhook   ← Self Protocol webhook`);
    console.log(`  POST /receipt/png     ← Generate PNG receipt`);
    console.log(`  POST /receipt/pdf     ← Generate PDF receipt`);
    console.log(`  GET  /x402/status     ← x402 facilitator status`);
    console.log(`  GET  /admin/stats     ← Admin statistics\n`);
    console.log(`  GET  /api/self/status/:sessionToken ← Verification status`);
    console.log(`  GET  /api/self/qr/:telegramId ← Verification QR`);
    console.log(`  GET  /api/self/poll/:sessionToken ← Verification poll`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export default app;
