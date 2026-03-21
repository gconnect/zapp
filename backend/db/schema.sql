-- CeloPay Database Schema
-- SQLite

-- ─── Users ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id       TEXT    NOT NULL UNIQUE,
  telegram_username TEXT,
  telegram_name     TEXT,

  wallet_address    TEXT UNIQUE,
  wallet_private_key TEXT,

  self_verified     INTEGER NOT NULL DEFAULT 0,
  self_nullifier    TEXT UNIQUE,

  self_verified_at  DATETIME,
  self_verification_method TEXT,

  flagged           INTEGER NOT NULL DEFAULT 0,

  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_active       DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ─── Transactions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_hash         TEXT    UNIQUE,
  tx_type         TEXT    NOT NULL,  -- 'send' | 'split' | 'esusu_contribute' | 'esusu_payout'
  from_user_id    INTEGER REFERENCES users(id),
  to_user_id      INTEGER REFERENCES users(id),
  from_address    TEXT    NOT NULL,
  to_address      TEXT,
  amount_cusd     REAL    NOT NULL,
  memo            TEXT,
  status          TEXT    NOT NULL DEFAULT 'pending',  -- 'pending' | 'confirmed' | 'failed'
  block_number    INTEGER,
  gas_used        TEXT,
  receipt_sent    INTEGER NOT NULL DEFAULT 0,  -- 0 = not sent, 1 = sent
  notified_admin  INTEGER NOT NULL DEFAULT 0,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  confirmed_at    DATETIME
);

-- ─── Esusu Circles ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS esusu_circles (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_circle_id   INTEGER,                           -- on-chain circle ID
  name                 TEXT    NOT NULL,
  admin_user_id        INTEGER REFERENCES users(id),
  telegram_group_id    TEXT,                              -- Telegram group chat ID
  contribution_cusd    REAL    NOT NULL,
  interval_days        INTEGER NOT NULL DEFAULT 30,
  max_members          INTEGER NOT NULL,
  current_round        INTEGER NOT NULL DEFAULT 1,
  next_payout_date     DATETIME,
  status               TEXT    NOT NULL DEFAULT 'active', -- 'active' | 'completed' | 'cancelled'
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS esusu_members (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  circle_id  INTEGER NOT NULL REFERENCES esusu_circles(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  joined_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(circle_id, user_id)
);

CREATE TABLE IF NOT EXISTS esusu_rounds (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  circle_id     INTEGER NOT NULL REFERENCES esusu_circles(id),
  round_number  INTEGER NOT NULL,
  recipient_id  INTEGER REFERENCES users(id),
  total_pot     REAL,
  tx_hash       TEXT,
  paid_out_at   DATETIME,
  UNIQUE(circle_id, round_number)
);

CREATE TABLE IF NOT EXISTS esusu_contributions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  circle_id   INTEGER NOT NULL REFERENCES esusu_circles(id),
  round       INTEGER NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  amount_cusd REAL    NOT NULL,
  tx_hash     TEXT,
  paid_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(circle_id, round, user_id)
);

-- ─── Carts (Supermarket) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS carts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  store_name     TEXT,
  store_wallet   TEXT,
  items          TEXT    NOT NULL DEFAULT '[]',  -- JSON array
  total_cusd     REAL    NOT NULL DEFAULT 0,
  status         TEXT    NOT NULL DEFAULT 'active',  -- 'active' | 'paid' | 'abandoned'
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ─── Address Book ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS address_book (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id   INTEGER NOT NULL REFERENCES users(id),
  alias           TEXT    NOT NULL,   -- e.g. "peter", "mum"
  target_user_id  INTEGER REFERENCES users(id),
  wallet_address  TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(owner_user_id, alias)
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tx_from      ON transactions(from_user_id);
CREATE INDEX IF NOT EXISTS idx_tx_status    ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_tx_created   ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_users_tgid   ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_wallet ON users(wallet_address);
CREATE INDEX IF NOT EXISTS idx_users_self_verified
ON users(self_verified);

CREATE INDEX IF NOT EXISTS idx_users_self_nullifier
ON users(self_nullifier);

-- ─── Faucet Requests ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS faucet_requests (
  telegram_id TEXT PRIMARY KEY,
  last_request DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Verification short links
CREATE TABLE IF NOT EXISTS verification_links (
  short_id TEXT PRIMARY KEY,
  session_token TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Session tokens for Self verification
CREATE TABLE IF NOT EXISTS session_tokens (
  session_token TEXT PRIMARY KEY,
  telegram_id TEXT,
  deep_link TEXT,
  qr_data_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
