import crypto from 'crypto';
import fetch from 'node-fetch';
import QRCode from 'qrcode';
import { verifyWebhookSignature as verifySignatureFromHeaders } from './utils.js'; // optional helper for signature verification

const SELF_APP_ID = process.env.SELF_APP_ID || 'zapp-app';
const SELF_APP_SECRET = process.env.SELF_APP_SECRET || '';
const WEBHOOK_SECRET = process.env.SELF_WEBHOOK_SECRET || '';

// ─── Create a Self Verification Session ──────────────────────────────────────

export async function createVerificationSession(telegramUserId) {
  const response = await fetch('https://api.self.xyz/v1/verification-sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-app-id': SELF_APP_ID,
      'x-app-secret': SELF_APP_SECRET,
    },
    body: JSON.stringify({
      subject: String(telegramUserId),
      requirements: {
        minimumAge: 18,
        excludedCountries: [],
        ofac: true
      }
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to create verification session');

  return {
    sessionId: data.sessionId,
    verificationLink: data.verificationLink
  };
}

// ─── Generate QR Code ────────────────────────────────────────────────────────

export async function generateVerificationQRCode(verificationLink) {
  return QRCode.toDataURL(verificationLink);
}

// ─── Poll Verification Status (Optional) ─────────────────────────────────────

export async function checkVerificationStatus(sessionId) {
  const response = await fetch(`https://api.self.xyz/v1/verification-sessions/${sessionId}`, {
    headers: {
      'x-app-id': SELF_APP_ID,
      'x-app-secret': SELF_APP_SECRET,
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to fetch verification status');
  return data; // contains: verified, nullifier, subject
}

// ─── Webhook Signature Verification ──────────────────────────────────────────

export function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!WEBHOOK_SECRET) return true; // skip in dev/mock
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  return signatureHeader === `sha256=${expected}`;
}