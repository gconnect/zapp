import { Router } from 'express';
import { verifyWebhookSignature, processVerificationProof } from '../services/self.js';
import { getUserByTelegramId, setUserVerified } from '../db/index.js';

const router = Router();

/**
 * POST /verify
 * Receives Self Protocol ZK proof webhook after user completes verification
 */
router.post('/', async (req, res) => {
  try {
    // Verify webhook signature
    const signature = req.headers['x-self-signature'];
    const rawBody = JSON.stringify(req.body);
    const sigValid = verifyWebhookSignature(rawBody, signature);

    if (!sigValid) {
      console.error('❌ Invalid Self webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const proof = req.body;
    const { valid, telegramUserId, nullifier, error } = await processVerificationProof(proof);

    if (!valid) {
      console.error('❌ Self proof invalid:', error);
      return res.status(400).json({ error });
    }

    // Check user exists
    const user = getUserByTelegramId(telegramUserId);
    if (!user) {
      console.warn(`⚠️  Verified user ${telegramUserId} not found in DB`);
      return res.status(404).json({ error: 'User not found' });
    }

    // Check for nullifier reuse (anti-sybil)
    const existing = req.app.locals.db?.prepare(
      'SELECT id FROM users WHERE self_nullifier = ?'
    ).get(nullifier);

    if (existing && existing.id !== user.id) {
      console.warn(`⚠️  Nullifier reuse detected for user ${telegramUserId}`);
      return res.status(409).json({ error: 'Verification already used' });
    }

    // Mark user as verified
    setUserVerified(telegramUserId, nullifier);

    console.log(`✅ User ${telegramUserId} (@${user.telegram_username}) verified via Self Protocol`);

    // Emit event for bot to send confirmation message
    req.app.locals.events?.emit('user:verified', {
      telegramId: telegramUserId,
      username: user.telegram_username
    });

    return res.json({ success: true, message: 'User verified successfully' });
  } catch (err) {
    console.error('Verify route error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
