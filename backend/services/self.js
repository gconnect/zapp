import crypto from 'crypto';
import fetch from 'node-fetch';
import QRCode from 'qrcode';

const SELF_APP_ID = process.env.SELF_APP_ID || 'zapp-app';
const SELF_APP_SECRET = process.env.SELF_APP_SECRET || '';
const WEBHOOK_SECRET = process.env.SELF_WEBHOOK_SECRET || '';
const MOCK_SELF = process.env.SELF_MOCK === 'true';

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
    subject: telegramUserId,
    requirements: {
      minimumAge: 18,
      excludedCountries: [],
      ofac: true
    }
  }),
});

const data = await response.json();
const verificationLink = data.verificationLink; // <-- this is the real link

  return {
    sessionId: data.sessionId,
    verificationLink: verificationLink
  };
}

// ─── Generate QR Code ────────────────────────────────────────────────────────
export async function generateVerificationQRCode(verificationLink) {
  return QRCode.toDataURL(verificationLink);
}

// ─── Poll Verification Status ───────────────────────────────────────────────
export async function checkVerificationStatus(sessionId) {
  if (MOCK_SELF) {
    // Always return verified in mock mode
    return {
      verified: true,
      nullifier: 'mock-nullifier',
      subject: 'mock-subject'
    };
  }

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

// ─── Mock processVerificationProof ─────────────────────────────────────────
export async function processVerificationProof(proof) {
  if (MOCK_SELF) {
    return {
      valid: true,
      telegramUserId: proof.subject || 'mock-subject',
      nullifier: 'mock-nullifier',
      verifiedAt: new Date().toISOString()
    };
  }

  // In real mode, call checkVerificationStatus
  const result = await checkVerificationStatus(proof.sessionId);
  if (!result.verified) return { valid: false, error: 'Proof verification failed' };
  return {
    valid: true,
    telegramUserId: result.subject,
    nullifier: result.nullifier,
    verifiedAt: new Date().toISOString()
  };
}