import crypto from 'crypto';
import fetch from 'node-fetch';
import QRCode from 'qrcode';
import { getDB } from '../db/index.js';

// const SELF_APP_ID = process.env.SELF_APP_ID || 'zapp-app';
// const SELF_APP_SECRET = process.env.SELF_APP_SECRET || '';
// const WEBHOOK_SECRET = process.env.SELF_WEBHOOK_SECRET || '';
// const MOCK_SELF = process.env.SELF_MOCK === 'true';

const SELF_NETWORK = 'testnet'; // or 'mainnet'

// Session and link data persisted to DB — no in-memory Maps needed

// ─── Step 1: Initiate Self Agent Registration ───────────────────────────────
export async function initiateSelfVerification(walletAddress) {
  const initRes = await fetch('https://app.ai.self.xyz/api/agent/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'linked',
      network: SELF_NETWORK,
      humanAddress: walletAddress
    })
  });

  if (!initRes.ok) {
    const err = await initRes.text();
    throw new Error(`Failed to initiate Self registration: ${err}`);
  }

  const { sessionToken, deepLink, agentAddress } = await initRes.json();

  // Generate QR Code for the deep link
  const qrDataURL = await QRCode.toDataURL(deepLink, { width: 400, margin: 1 });

  // Also save the qrDataURL
  // Persist session token, deep link and QR to DB
  getDB().prepare(`
    INSERT OR REPLACE INTO session_tokens (session_token, telegram_id, deep_link, qr_data_url)
    VALUES (?, NULL, ?, ?)
  `).run(sessionToken, deepLink, qrDataURL);

  const baseUrl = process.env.BACKEND_URL || 'https://zapp.africinnovate.com/';

  return {
    agentAddress,
    sessionToken,
    verificationLink: deepLink,
    qrDataURL,
    qrCodeUrl: `${baseUrl}/api/self/qr/${sessionToken}`
  };
}

// ─── Step 2: Poll for Completion ────────────────────────────────────────────
export async function pollSelfVerificationStatus(sessionToken) {
  const statusRes = await fetch('https://app.ai.self.xyz/api/agent/register/status', {
    headers: { 'Authorization': `Bearer ${sessionToken}` }
  });

  if (!statusRes.ok) {
    const err = await statusRes.text();
    throw new Error(`Failed to poll Self registration status: ${err}`);
  }

  return await statusRes.json(); // { stage, agentId, ... }
}

// ─── Step 3 (Optional): Export Agent Private Key ───────────────────────────
export async function exportSelfAgentKey(sessionToken) {
  const exportRes = await fetch('https://app.ai.self.xyz/api/agent/register/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: sessionToken })
  });

  if (!exportRes.ok) {
    const err = await exportRes.text();
    throw new Error(`Failed to export Self agent key: ${err}`);
  }

  return await exportRes.json(); // { privateKey, agentAddress, agentId }
}


export function saveSessionToken(sessionToken, telegramId) {
  getDB().prepare(`
    INSERT OR REPLACE INTO session_tokens (session_token, telegram_id)
    VALUES (?, ?)
  `).run(sessionToken, String(telegramId));
}

export function getTelegramIdBySessionToken(sessionToken) {
  const row = getDB().prepare('SELECT telegram_id FROM session_tokens WHERE session_token = ?').get(sessionToken);
  return row ? row.telegram_id : null;
}

export function getLinkBySessionToken(sessionToken) {
  const row = getDB().prepare('SELECT deep_link FROM session_tokens WHERE session_token = ?').get(sessionToken);
  return row ? row.deep_link : null;
}

export function getQrDataURLBySessionToken(sessionToken) {
  const row = getDB().prepare('SELECT qr_data_url FROM session_tokens WHERE session_token = ?').get(sessionToken);
  return row ? row.qr_data_url : null;
}

export function getSessionTokenByTelegramId(telegramId) {
  const row = getDB().prepare(
    'SELECT session_token FROM session_tokens WHERE telegram_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(String(telegramId));
  return row ? row.session_token : null;
}