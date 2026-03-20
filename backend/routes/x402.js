import { Router } from 'express';
import { buildPaymentRequirement, verifyPayment, requirePayment } from '../services/x402.js';

const router = Router();

/**
 * GET /x402/status
 * Check x402 facilitator health
 */
router.get('/status', (req, res) => {
  res.json({
    status: 'active',
    network: 'celo-alfajores',
    facilitator: 'celopay-x402',
    version: '1'
  });
});

/**
 * POST /x402/verify
 * Verify a payment header (used by external services that want to accept CeloPay payments)
 */
router.post('/verify', async (req, res) => {
  try {
    const { paymentHeader, requirement } = req.body;
    const result = await verifyPayment(paymentHeader, requirement);
    res.json(result);
  } catch (err) {
    res.status(500).json({ valid: false, error: err.message });
  }
});

/**
 * GET /x402/demo
 * A demo x402-gated endpoint (returns a price feed)
 * Requires 0.001 USDC payment to access
 */
router.get('/demo',
  requirePayment({ amount: '0.001', description: 'CeloPay price feed access' }),
  (req, res) => {
    res.json({
      USDC_USD: 1.00,
      CELO_USD: 0.82,
      timestamp: new Date().toISOString(),
      source: 'celopay-oracle'
    });
  }
);

export default router;
