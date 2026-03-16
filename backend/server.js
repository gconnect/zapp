/**
 * CeloPay Backend Server
 * Handles: Self KYC webhooks, receipt generation, x402, shared DB
 */

import 'dotenv/config';
import express from 'express';
import { EventEmitter } from 'events';
import { initDB } from './db/index.js';
import verifyRoutes  from './routes/verify.js';
import receiptRoutes from './routes/receipt.js';
import x402Routes   from './routes/x402.js';
import apiRoutes     from './routes/api.js';

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Event Bus (shared between routes and bot) ────────────────────────────────
app.locals.events = new EventEmitter();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
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

// ─── Admin Stats Endpoint ─────────────────────────────────────────────────────
app.get('/admin/stats', (req, res) => {
  // Simple auth check
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_SECRET && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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
        total: db.prepare('SELECT COUNT(*) as n FROM transactions').get().n,
        today: db.prepare("SELECT COUNT(*) as n FROM transactions WHERE created_at >= date('now')").get().n,
        failed: db.prepare("SELECT COUNT(*) as n FROM transactions WHERE status = 'failed'").get().n,
        volume_cusd: db.prepare("SELECT COALESCE(SUM(amount_cusd), 0) as s FROM transactions WHERE status = 'confirmed'").get().s
      },
      circles: {
        total: db.prepare('SELECT COUNT(*) as n FROM esusu_circles').get().n,
        active: db.prepare("SELECT COUNT(*) as n FROM esusu_circles WHERE status = 'active'").get().n
      }
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

  app.listen(PORT, () => {
    console.log(`\n╔══════════════════════════════════════════╗`);
    console.log(`║   Zapp Backend Server                 ║`);
    console.log(`╚══════════════════════════════════════════╝`);
    console.log(`🚀 Running on http://localhost:${PORT}`);
    console.log(`🌐 Network:  Celo Sepolia Testnet (chainId 11142220)`);
    console.log(`🗄️  Database: ${process.env.DB_PATH || './db/zapp.sqlite'}`);
    console.log(`\nEndpoints:`);
    console.log(`  GET  /health`);
    console.log(`  POST /verify/self/webhook   ← Self Protocol webhook`);
    console.log(`  POST /receipt/png     ← Generate PNG receipt`);
    console.log(`  POST /receipt/pdf     ← Generate PDF receipt`);
    console.log(`  GET  /x402/status     ← x402 facilitator status`);
    console.log(`  GET  /admin/stats     ← Admin statistics\n`);
    console.log(`  GET  /api/self/status/:telegramId ← Verification status`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export default app;
