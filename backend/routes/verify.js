import { Router } from 'express';
import { initiateSelfVerification, pollSelfVerificationStatus } from '../services/self.js';
import { getUserByTelegramId } from '../db/index.js';

const router = Router();

/**
 * POST /verify
 * Start Self verification: returns QR + sessionToken for frontend/bot
 */
router.post('/', async (req, res) => {
  try {
    const { telegramUserId, walletAddress } = req.body;

    // Check user exists
    const user = getUserByTelegramId(telegramUserId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Start Self registration
    const { agentAddress, sessionToken, qrDataURL } = await initiateSelfVerification(walletAddress);

    // Return QR & sessionToken to frontend/bot
    return res.json({
      agentAddress,
      sessionToken,
      qrDataURL,
      message: 'Scan QR to complete verification'
    });
  } catch (err) {
    console.error('Error starting Self verification:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;