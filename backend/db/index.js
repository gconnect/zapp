import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const __dirname = dirname(fileURLToPath(import.meta.url));

let db;

export function getDB() {
  if (!db) {
    const dbPath = process.env.DB_PATH || join(__dirname, 'zapp.sqlite');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

export function initDB() {
  const database = getDB();
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  database.exec(schema);
  console.log('✅ Database initialized');
  return database;
}

// ─── User Operations ─────────────────────────────────────────────────────────

export function upsertUser({ telegramId, telegramUsername, telegramName }) {
  const db = getDB();
  db.prepare(`
    INSERT INTO users (telegram_id, telegram_username, telegram_name)
    VALUES (?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      telegram_username = excluded.telegram_username,
      telegram_name = excluded.telegram_name,
      last_active = CURRENT_TIMESTAMP
  `).run(telegramId, telegramUsername || null, telegramName || null);

  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
}

export function getUserByTelegramId(telegramId) {
  return getDB().prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
}

export function getUserByWallet(walletAddress) {
  return getDB().prepare('SELECT * FROM users WHERE wallet_address = ?').get(walletAddress);
}

export function getUserByUsername(username) {
  const clean = username.replace('@', '');
  return getDB().prepare('SELECT * FROM users WHERE telegram_username COLLATE NOCASE = ?').get(clean);
}

export function setUserWallet(telegramId, walletAddress, encryptedKey) {
  return getDB().prepare(`
    UPDATE users SET wallet_address = ?, wallet_private_key = ? WHERE telegram_id = ?
  `).run(walletAddress, encryptedKey, telegramId);
}

export function setUserVerified(telegramId, nullifier) {
  return getDB().prepare(`
    UPDATE users SET self_verified = 1, self_nullifier = ? WHERE telegram_id = ?
  `).run(nullifier, telegramId);
}

export function flagUser(telegramId) {
  return getDB().prepare('UPDATE users SET flagged = 1 WHERE telegram_id = ?').run(telegramId);
}

// ─── Transaction Operations ──────────────────────────────────────────────────

export function createTransaction({ txHash, txType, fromUserId, toUserId, fromAddress, toAddress, amountCusd, memo }) {
  return getDB().prepare(`
    INSERT INTO transactions (tx_hash, tx_type, from_user_id, to_user_id, from_address, to_address, amount_cusd, memo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(txHash, txType, fromUserId || null, toUserId || null, fromAddress, toAddress || null, amountCusd, memo || null);
}

export function confirmTransaction(txHash, blockNumber) {
  return getDB().prepare(`
    UPDATE transactions SET status = 'confirmed', block_number = ?, confirmed_at = CURRENT_TIMESTAMP WHERE tx_hash = ?
  `).run(blockNumber, txHash);
}

export function failTransaction(txHash) {
  return getDB().prepare(`UPDATE transactions SET status = 'failed' WHERE tx_hash = ?`).run(txHash);
}

export function getTransactions({ period = 'today', status = null, limit = 50 } = {}) {
  const db = getDB();
  let query = `
    SELECT t.*, 
           u1.telegram_username as from_username,
           u2.telegram_username as to_username
    FROM transactions t
    LEFT JOIN users u1 ON t.from_user_id = u1.id
    LEFT JOIN users u2 ON t.to_user_id = u2.id
    WHERE 1=1
  `;
  const params = [];

  if (period === 'today') {
    query += ` AND t.created_at >= date('now')`;
  } else if (period === 'week') {
    query += ` AND t.created_at >= date('now', '-7 days')`;
  }

  if (status) { query += ` AND t.status = ?`; params.push(status); }
  query += ` ORDER BY t.created_at DESC LIMIT ?`;
  params.push(limit);

  return db.prepare(query).all(...params);
}

export function getUnnotifiedLargeTx(threshold = 500) {
  return getDB().prepare(`
    SELECT * FROM transactions WHERE amount_cusd >= ? AND notified_admin = 0 AND status = 'confirmed'
  `).all(threshold);
}

export function markAdminNotified(txId) {
  return getDB().prepare('UPDATE transactions SET notified_admin = 1 WHERE id = ?').run(txId);
}

// ─── Esusu Operations ────────────────────────────────────────────────────────

export function createCircle({ name, adminUserId, telegramGroupId, contributionCusd, intervalDays, maxMembers }) {
  const result = getDB().prepare(`
    INSERT INTO esusu_circles (name, admin_user_id, telegram_group_id, contribution_cusd, interval_days, max_members, next_payout_date)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+' || ? || ' days'))
  `).run(name, adminUserId, telegramGroupId || null, contributionCusd, intervalDays, maxMembers, intervalDays);
  return result.lastInsertRowid;
}

export function getCircle(circleId) {
  return getDB().prepare('SELECT * FROM esusu_circles WHERE id = ?').get(circleId);
}

export function getAllCircles() {
  return getDB().prepare('SELECT * FROM esusu_circles ORDER BY created_at DESC').all();
}

export function getCircleMembers(circleId) {
  return getDB().prepare(`
    SELECT u.*, em.joined_at FROM esusu_members em JOIN users u ON em.user_id = u.id WHERE em.circle_id = ?
  `).all(circleId);
}

export function addCircleMember(circleId, userId) {
  return getDB().prepare('INSERT OR IGNORE INTO esusu_members (circle_id, user_id) VALUES (?, ?)').run(circleId, userId);
}

export function recordContribution({ circleId, round, userId, amountCusd, txHash }) {
  return getDB().prepare(`
    INSERT OR IGNORE INTO esusu_contributions (circle_id, round, user_id, amount_cusd, tx_hash) VALUES (?, ?, ?, ?, ?)
  `).run(circleId, round, userId, amountCusd, txHash);
}

export function getUnpaidMembers(circleId, round) {
  return getDB().prepare(`
    SELECT u.telegram_username, u.wallet_address FROM esusu_members em
    JOIN users u ON em.user_id = u.id
    WHERE em.circle_id = ?
    AND em.user_id NOT IN (
      SELECT user_id FROM esusu_contributions WHERE circle_id = ? AND round = ?
    )
  `).all(circleId, circleId, round);
}

// ─── Address Book ────────────────────────────────────────────────────────────

export function resolveAlias(ownerUserId, alias) {
  return getDB().prepare(`
    SELECT ab.*, u.wallet_address as resolved_wallet FROM address_book ab
    LEFT JOIN users u ON ab.target_user_id = u.id
    WHERE ab.owner_user_id = ? AND lower(ab.alias) = lower(?)
  `).get(ownerUserId, alias);
}

export function saveAlias(ownerUserId, alias, targetUserId, walletAddress) {
  return getDB().prepare(`
    INSERT INTO address_book (owner_user_id, alias, target_user_id, wallet_address)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(owner_user_id, alias) DO UPDATE SET target_user_id = excluded.target_user_id, wallet_address = excluded.wallet_address
  `).run(ownerUserId, alias, targetUserId || null, walletAddress || null);
}

// ─── Faucet Operations ───────────────────────────────────────────────────────

export function getFaucetLastRequest(telegramId) {
  const row = getDB().prepare('SELECT last_request FROM faucet_requests WHERE telegram_id = ?').get(telegramId);
  return row ? new Date(row.last_request + 'Z') : null; // SQLite stores locally without timezone, appending Z depends. Let's rely on SQLite's CURRENT_TIMESTAMP being UTC.
}

export function checkFaucetRateLimit(telegramId) {
  const row = getDB().prepare('SELECT last_request FROM faucet_requests WHERE telegram_id = ?').get(telegramId);
  if (!row) return true;
  // SQLite CURRENT_TIMESTAMP is in UTC typically
  const last = new Date(row.last_request + 'Z').getTime();
  const now = Date.now();
  // Limit to once every 24 hours
  if (now - last < 24 * 60 * 60 * 1000) {
    return false;
  }
  return true;
}

export function updateFaucetRequest(telegramId) {
  return getDB().prepare(`
    INSERT INTO faucet_requests (telegram_id, last_request)
    VALUES (?, CURRENT_TIMESTAMP)
    ON CONFLICT(telegram_id) DO UPDATE SET last_request = CURRENT_TIMESTAMP
  `).run(telegramId);
}

// ─── Verification Link Operations ────────────────────────────────────────────

export function saveVerificationLink(shortId, sessionToken) {
  return getDB().prepare(`
    INSERT OR REPLACE INTO verification_links (short_id, session_token)
    VALUES (?, ?)
  `).run(shortId, sessionToken);
}

export function getVerificationLink(shortId) {
  const row = getDB().prepare('SELECT session_token FROM verification_links WHERE short_id = ?').get(shortId);
  return row ? row.session_token : null;
}

export function deleteVerificationLink(shortId) {
  return getDB().prepare('DELETE FROM verification_links WHERE short_id = ?').run(shortId);
}
