import crypto from 'crypto';
import fetch from 'node-fetch';
import QRCode from 'qrcode';

// const SELF_APP_ID = process.env.SELF_APP_ID || 'zapp-app';
// const SELF_APP_SECRET = process.env.SELF_APP_SECRET || '';
// const WEBHOOK_SECRET = process.env.SELF_WEBHOOK_SECRET || '';
// const MOCK_SELF = process.env.SELF_MOCK === 'true';

const SELF_NETWORK = 'testnet'; // or 'mainnet'

const sessionMap = new Map();
const linkMap = new Map();

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
  linkMap.set(`qr_${sessionToken}`, qrDataURL);

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
  sessionMap.set(sessionToken, telegramId);
}

export function getTelegramIdBySessionToken(sessionToken) {
  return sessionMap.get(sessionToken);
}

export function getLinkBySessionToken(sessionToken) {
  return linkMap.get(sessionToken);
}

export function getQrDataURLBySessionToken(sessionToken) {
  return linkMap.get(`qr_${sessionToken}`);
}

export function getSessionTokenByTelegramId(telegramId) {
  let latestToken = null;
  for (const [token, tid] of sessionMap.entries()) {
    if (String(tid) === String(telegramId)) {
      latestToken = token;
    }
  }
  return latestToken;
}