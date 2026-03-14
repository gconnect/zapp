/**
 * x402 payment facilitation service
 * Handles HTTP 402 Payment Required flows for API-gated resources
 * Spec: https://x402.org
 */

import crypto from 'crypto';

const FACILITATOR_SECRET = process.env.X402_FACILITATOR_SECRET || 'dev-secret';

// ─── Payment Requirement Builder ─────────────────────────────────────────────

/**
 * Build an x402 payment requirement response
 * @param {object} opts
 * @returns {object} x402-compliant payment requirement
 */
export function buildPaymentRequirement({ amount, currency = 'USDC', recipientAddress, resourcePath, description }) {
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: 'exact',
        network: 'celo-alfajores',
        maxAmountRequired: String(Math.round(parseFloat(amount) * 1e6)), // USDC uses 6 decimals
        resource: resourcePath,
        description: description || 'API access payment',
        mimeType: 'application/json',
        payTo: recipientAddress || process.env.AGENT_WALLET_ADDRESS,
        maxTimeoutSeconds: 300,
        asset: process.env.CUSD_ADDRESS || '0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1',
        extra: { name: 'CeloPay API', version: '1' }
      }
    ],
    error: 'Payment required to access this resource'
  };
}

// ─── Payment Verification ────────────────────────────────────────────────────

/**
 * Verify an x402 payment header
 * @param {string} paymentHeader - X-PAYMENT header value
 * @param {object} requirement - The payment requirement that was issued
 * @returns {object} { valid, error }
 */
export async function verifyPayment(paymentHeader, requirement) {
  if (!paymentHeader) {
    return { valid: false, error: 'No X-PAYMENT header provided' };
  }

  try {
    let paymentData;
    try {
      paymentData = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf8'));
    } catch {
      return { valid: false, error: 'Invalid payment header encoding' };
    }

    // Validate required fields
    if (!paymentData.payload || !paymentData.payload.authorization) {
      return { valid: false, error: 'Missing payment authorization' };
    }

    const auth = paymentData.payload.authorization;

    // Validate amount
    const required = requirement?.accepts?.[0];
    if (required) {
      if (BigInt(auth.value || 0) < BigInt(required.maxAmountRequired)) {
        return { valid: false, error: 'Insufficient payment amount' };
      }

      if (auth.to?.toLowerCase() !== required.payTo?.toLowerCase()) {
        return { valid: false, error: 'Payment recipient mismatch' };
      }
    }

    // In production: verify the on-chain transaction via Celo RPC
    // For MVP: trust the signed authorization
    console.log(`💳 x402 payment verified: ${auth.value} units to ${auth.to}`);

    return {
      valid: true,
      txHash: auth.transactionHash || null,
      amount: auth.value,
      payer: auth.from
    };
  } catch (err) {
    return { valid: false, error: `Verification failed: ${err.message}` };
  }
}

// ─── Express Middleware ──────────────────────────────────────────────────────

/**
 * Express middleware that enforces x402 payment for a route
 * Usage: app.use('/api/premium', requirePayment({ amount: '0.01' }))
 */
export function requirePayment({ amount, currency = 'USDC', description }) {
  return async (req, res, next) => {
    const paymentHeader = req.headers['x-payment'];
    const recipientAddress = process.env.AGENT_WALLET_ADDRESS;

    const requirement = buildPaymentRequirement({
      amount,
      currency,
      recipientAddress,
      resourcePath: req.path,
      description
    });

    if (!paymentHeader) {
      return res.status(402).json(requirement);
    }

    const { valid, error } = await verifyPayment(paymentHeader, requirement);
    if (!valid) {
      return res.status(402).json({ ...requirement, error });
    }

    next();
  };
}
