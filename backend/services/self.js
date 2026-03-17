/**
 * Self Protocol verification service
 * Handles ZK identity verification for user onboarding
 * Docs: https://docs.self.xyz/backend-integration/basic-integration
 */
import crypto from 'crypto';
import { SelfBackendVerifier } from '@selfxyz/core';

// ─── Config ───────────────────────────────────────────────────────────────────

const SELF_APP_ID     = process.env.SELF_APP_ID     || 'celopay-app';
const SELF_APP_SECRET = process.env.SELF_APP_SECRET || '';
const WEBHOOK_SECRET  = process.env.SELF_WEBHOOK_SECRET || '';

// ─── Generate Verification Link ──────────────────────────────────────────────

/**
 * Generate a Self Protocol verification link for a user
 * @param {string} telegramUserId - Telegram user ID (used as subject)
 * @returns {object} { link, sessionId }
 */
export function generateVerificationLink(telegramUserId) {
  const sessionId = crypto.randomUUID();

  // Build the Self deeplink
  // In production: use @selfxyz/core SelfBackendVerifier
  const params = new URLSearchParams({
    appId: SELF_APP_ID,
    subject: String(telegramUserId),
    sessionId,
    requirements: JSON.stringify({
      minimumAge: 18,
      excludedCountries: [],
      ofac: true
    })
  });

  const link = `https://self.xyz/verify?${params.toString()}`;
  const appDeeplink = `self://verify?${params.toString()}`;

  return { link, appDeeplink, sessionId };
}

// ─── Verify Webhook Signature ─────────────────────────────────────────────────

export function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!WEBHOOK_SECRET) return true; // skip in dev
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  return signatureHeader === `sha256=${expected}`;
}

// ─── Process Verification Proof ──────────────────────────────────────────────

/**
 * Process a Self Protocol verification webhook
 * @param {object} proof - The proof payload from Self
 * @returns {object} { valid, telegramUserId, nullifier }
 */
export async function processVerificationProof(proof) {
  try {
    const verifier = new SelfBackendVerifier({
      appId: SELF_APP_ID,
      mock: true
    });

    const result = await verifier.verify(proof);

    if (!result.verified) {
      return { valid: false, error: 'Proof verification failed' };
    }

    const telegramUserId = String(result.subject);
    const nullifier = result.nullifier;

    console.log(`✅ Self verification successful for user ${telegramUserId}`);

    return {
      valid: true,
      telegramUserId,
      nullifier,
      verifiedAt: new Date().toISOString()
    };

  } catch (err) {
    console.error('Self verification error:', err);
    return { valid: false, error: err.message };
  }
}

// ─── Onboarding Message ──────────────────────────────────────────────────────

export function buildVerificationMessage(verificationLink) {
  return `🔐 *Identity Verification Required*

To activate your CeloPay wallet, we need to verify your identity.

This uses *Self Protocol* — a privacy-first ZK verification system. We never store your personal data.

👆 Tap the link below to verify:
${verificationLink}

_Or open the Self app and scan the QR code._

Once verified, your wallet will be activated automatically ✅`;
}
