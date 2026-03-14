/**
 * api.js — Main API routes for CeloPay backend
 * All routes called by OpenClaw skills
 */

import { Router } from 'express';
import { getCUSDBalance, sendCUSD, splitEqualOnChain, generateWallet, waitForTransaction, getExplorerUrl } from '../services/celo.js';
import { generateReceiptPNG, generateReceiptPDF } from '../services/receipt.js';
import { generateVerificationLink } from '../services/self.js';
import { createCircle, joinCircle, contribute, getCircleStatus, getUserCircles } from '../services/esusu.js';
import {
  upsertUser, getUserByTelegramId, getUserByUsername,
  setUserWallet, createTransaction, confirmTransaction, failTransaction,
  getTransactions, flagUser, resolveAlias, saveAlias
} from '../db/index.js';

const router = Router();

// ─── Onboarding ──────────────────────────────────────────────────────────────

router.post('/onboard', async (req, res) => {
  try {
    const { telegramId, telegramUsername, telegramName } = req.body;
    if (!telegramId) return res.status(400).json({ error: 'telegramId required' });

    // Upsert user
    let user = upsertUser({ telegramId: String(telegramId), telegramUsername, telegramName });

    const isNewUser = !user.wallet_address;

    // Generate wallet if needed
    if (!user.wallet_address) {
      const wallet = generateWallet();
      setUserWallet(String(telegramId), wallet.address, wallet.privateKey);
      user = getUserByTelegramId(String(telegramId));
    }

    // Generate Self verification link
    const { link: verificationLink } = generateVerificationLink(String(telegramId));

    res.json({
      isNewUser,
      isVerified: !!user.self_verified,
      walletAddress: user.wallet_address,
      verificationLink,
      telegramName
    });
  } catch (err) {
    console.error('Onboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Balance ─────────────────────────────────────────────────────────────────

router.get('/balance/:telegramId', async (req, res) => {
  try {
    const user = getUserByTelegramId(req.params.telegramId);
    if (!user) return res.status(404).json({ error: 'User not found. Use /start to register.' });
    if (!user.wallet_address) return res.status(400).json({ error: 'No wallet found. Use /start to set up.' });

    const balance = await getCUSDBalance(user.wallet_address);
    res.json({ balance: balance.formatted, address: user.wallet_address, raw: balance.raw.toString() });
  } catch (err) {
    console.error('Balance error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Send ─────────────────────────────────────────────────────────────────────

router.post('/send', async (req, res) => {
  try {
    const { fromTelegramId, toIdentifier, amountCusd, memo = '' } = req.body;
    if (!fromTelegramId || !toIdentifier || !amountCusd) {
      return res.status(400).json({ error: 'fromTelegramId, toIdentifier, amountCusd required' });
    }

    const sender = getUserByTelegramId(String(fromTelegramId));
    if (!sender) return res.status(404).json({ error: 'Sender not found' });
    if (!sender.self_verified) return res.status(403).json({ error: 'Identity verification required before sending' });
    if (!sender.wallet_private_key) return res.status(400).json({ error: 'Sender has no wallet' });

    // Resolve recipient: @username, wallet address, or alias
    let recipient, recipientWallet;
    if (toIdentifier.startsWith('0x')) {
      recipientWallet = toIdentifier;
      recipient = { telegram_username: toIdentifier };
    } else {
      const alias = resolveAlias(sender.id, toIdentifier.replace('@', ''));
      if (alias) {
        recipientWallet = alias.resolved_wallet || alias.wallet_address;
        recipient = getUserByTelegramId(String(alias.target_user_id)) || { telegram_username: toIdentifier };
      } else {
        recipient = getUserByUsername(toIdentifier);
        if (!recipient) return res.status(404).json({ error: `User "${toIdentifier}" not found on CeloPay` });
        recipientWallet = recipient.wallet_address;
      }
    }

    if (!recipientWallet) return res.status(400).json({ error: 'Recipient has no wallet' });

    // Check sender balance
    const balance = await getCUSDBalance(sender.wallet_address);
    if (parseFloat(balance.formatted) < parseFloat(amountCusd)) {
      return res.status(400).json({ error: `Insufficient balance. You have ${balance.formatted} cUSD but need ${amountCusd}` });
    }

    // Execute transfer
    const { txHash, explorerUrl } = await sendCUSD({
      fromPrivateKey: sender.wallet_private_key,
      toAddress: recipientWallet,
      amountCusd,
      memo
    });

    // Record in DB
    createTransaction({
      txHash, txType: 'send',
      fromUserId: sender.id, toUserId: recipient.id || null,
      fromAddress: sender.wallet_address, toAddress: recipientWallet,
      amountCusd: parseFloat(amountCusd), memo
    });

    // Wait for confirmation async
    waitForTransaction(txHash)
      .then(r => r.status === 'confirmed' ? confirmTransaction(txHash, r.blockNumber) : failTransaction(txHash))
      .catch(console.error);

    res.json({
      txHash, explorerUrl,
      recipientName: recipient.telegram_username || toIdentifier,
      amount: amountCusd
    });
  } catch (err) {
    console.error('Send error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Split Equal ──────────────────────────────────────────────────────────────

router.post('/split/equal', async (req, res) => {
  try {
    const { fromTelegramId, recipientIdentifiers, totalAmountCusd, memo = '' } = req.body;
    if (!fromTelegramId || !recipientIdentifiers?.length || !totalAmountCusd) {
      return res.status(400).json({ error: 'fromTelegramId, recipientIdentifiers[], totalAmountCusd required' });
    }

    const sender = getUserByTelegramId(String(fromTelegramId));
    if (!sender) return res.status(404).json({ error: 'Sender not found' });
    if (!sender.self_verified) return res.status(403).json({ error: 'Identity verification required' });

    // Resolve all recipients
    const wallets = [];
    for (const id of recipientIdentifiers) {
      const user = id.startsWith('0x') ? { wallet_address: id } : getUserByUsername(id);
      if (!user?.wallet_address) return res.status(404).json({ error: `Recipient "${id}" not found or has no wallet` });
      wallets.push(user.wallet_address);
    }

    // Execute on-chain or direct if no contract deployed
    let txHash, explorerUrl;
    if (process.env.SPLIT_PAYMENT_ADDRESS) {
      ({ txHash, explorerUrl } = await splitEqualOnChain({
        fromPrivateKey: sender.wallet_private_key,
        recipients: wallets,
        totalAmountCusd,
        memo
      }));
    } else {
      // Fallback: sequential sends
      const perPerson = totalAmountCusd / wallets.length;
      const hashes = [];
      for (const w of wallets) {
        const r = await sendCUSD({ fromPrivateKey: sender.wallet_private_key, toAddress: w, amountCusd: perPerson, memo });
        hashes.push(r.txHash);
      }
      txHash = hashes[0];
      explorerUrl = getExplorerUrl(txHash);
    }

    createTransaction({
      txHash, txType: 'split',
      fromUserId: sender.id, toUserId: null,
      fromAddress: sender.wallet_address, toAddress: wallets.join(','),
      amountCusd: parseFloat(totalAmountCusd), memo
    });

    res.json({ txHash, explorerUrl, recipients: recipientIdentifiers.length });
  } catch (err) {
    console.error('Split error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Esusu Routes ─────────────────────────────────────────────────────────────

router.post('/esusu/create', async (req, res) => {
  try {
    const result = await createCircle(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/esusu/join', async (req, res) => {
  try {
    const result = await joinCircle(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/esusu/contribute', async (req, res) => {
  try {
    const result = await contribute(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/esusu/:circleId/status', async (req, res) => {
  try {
    const result = await getCircleStatus(req.params.circleId);
    res.json(result);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.get('/esusu/user/:telegramId', async (req, res) => {
  try {
    const result = await getUserCircles(req.params.telegramId);
    res.json(result);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// ─── Admin Routes ─────────────────────────────────────────────────────────────

function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (process.env.NODE_ENV !== 'test' && key !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.get('/admin/transactions', adminAuth, async (req, res) => {
  try {
    const { period = 'today', status, minAmount } = req.query;
    let txs = getTransactions({ period, status });
    if (minAmount) txs = txs.filter(t => t.amount_cusd >= parseFloat(minAmount));
    res.json({ transactions: txs, count: txs.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/users', adminAuth, (req, res) => {
  try {
    res.json({ message: 'Use /admin/stats for summary' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/users/:username/flag', adminAuth, (req, res) => {
  try {
    flagUser(req.params.username);
    res.json({ success: true, message: `User @${req.params.username} flagged` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/circles', adminAuth, async (req, res) => {
  try {
    const circles = await getUserCircles('all'); // returns all
    res.json(circles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
