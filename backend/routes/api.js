/**
 * api.js — Main API routes for CeloPay backend
 * All routes called by OpenClaw skills
 */

import { Router } from 'express';
import { getCUSDBalance, sendCUSD, splitEqualOnChain, generateWallet, waitForTransaction, getExplorerUrl, getCELOBalance, sendCELO } from '../services/celo.js';
import { generateReceiptPNG, generateReceiptPDF } from '../services/receipt.js';
import { createCircle, joinCircle, contribute, getCircleStatus, getUserCircles } from '../services/esusu.js';
import {
  getDB, upsertUser, getUserByTelegramId, getUserByUsername,
  setUserWallet, createTransaction, confirmTransaction, failTransaction,
  getTransactions, flagUser, resolveAlias, saveAlias
} from '../db/index.js';
import {
  initiateSelfVerification,
  pollSelfVerificationStatus,
  saveSessionToken,
  getTelegramIdBySessionToken,
  getLinkBySessionToken,
  getQrDataURLBySessionToken,
  getSessionTokenByTelegramId
} from '../services/self.js';

const db = getDB();

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

    // Start Self verification session only if not verified
    let verificationLink = null;
    let sessionToken = null;
    let qrCode = null;

    // in your /onboard route
    if (!user.self_verified) {
      const verificationData = await initiateSelfVerification(user.wallet_address);

      verificationLink = verificationData.verificationLink; // send direct link to bot
      sessionToken = verificationData.sessionToken;
      qrCode = verificationData.qrCodeUrl;

      // Save sessionToken → telegramId mapping
      saveSessionToken(sessionToken, telegramId);
    }

    res.json({
      isNewUser,
      isVerified: !!user.self_verified,
      walletAddress: user.wallet_address,
      verificationLink,
      qrCode,
      sessionToken,       // frontend/bot can use this to poll
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
    const { fromTelegramId, recipientIdentifiers, totalAmount, token = 'cUSD', memo = '' } = req.body;
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
      if (token === 'cUSD') {
        ({ txHash, explorerUrl } = await splitEqualOnChain({
          fromPrivateKey: sender.wallet_private_key,
          recipients: wallets,
          totalAmount,
          memo
        }));
      } else if (token === 'CELO') {
        const perPerson = totalAmount / wallets.length;
        const hashes = [];
        for (const w of wallets) {
          const r = await sendCELO({ fromPrivateKey: sender.wallet_private_key, toAddress: w, amountCelo: perPerson, memo });
          hashes.push(r.txHash);
        }
        txHash = hashes[0];
        explorerUrl = getExplorerUrl(txHash);
      } else {
        return res.status(400).json({ error: 'Unsupported token. Only cUSD or CELO allowed.' });
      }
    } else {
      // Fallback for no contract
      if (token === 'cUSD') {
        const perPerson = totalAmount / wallets.length;
        const hashes = [];
        for (const w of wallets) {
          const r = await sendCUSD({ fromPrivateKey: sender.wallet_private_key, toAddress: w, amountCusd: perPerson, memo });
          hashes.push(r.txHash);
        }
        txHash = hashes[0];
        explorerUrl = getExplorerUrl(txHash);
      } else if (token === 'CELO') {
        const perPerson = totalAmount / wallets.length;
        const hashes = [];
        for (const w of wallets) {
          const r = await sendCELO({ fromPrivateKey: sender.wallet_private_key, toAddress: w, amountCelo: perPerson, memo });
          hashes.push(r.txHash);
        }
        txHash = hashes[0];
        explorerUrl = getExplorerUrl(txHash);
      } else {
        return res.status(400).json({ error: 'Unsupported token. Only cUSD or CELO allowed.' });
      }
    }

    createTransaction({
      txHash, txType: 'split',
      fromUserId: sender.id, toUserId: null,
      fromAddress: sender.wallet_address, toAddress: wallets.join(','),
      amountCusd: token === 'cUSD' ? parseFloat(totalAmount) : 0,
      amountCelo: token === 'CELO' ? parseFloat(totalAmount) : 0
    });

    res.json({ txHash, explorerUrl, recipients: recipientIdentifiers.length });
  } catch (err) {
    console.error('Split error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Split Custom ─────────────────────────────────────────────────────────────

router.post('/split/custom', async (req, res) => {
  try {
    const { fromTelegramId, recipients, token = 'cUSD', memo = '' } = req.body;
    if (!fromTelegramId || !recipients?.length) {
      return res.status(400).json({ error: 'fromTelegramId and recipients[] required' });
    }

    const sender = getUserByTelegramId(String(fromTelegramId));
    if (!sender) return res.status(404).json({ error: 'Sender not found' });
    if (!sender.self_verified) return res.status(403).json({ error: 'Identity verification required' });

    // Resolve all recipient wallets
    const wallets = [];
    for (const r of recipients) {
      let walletAddress;
      if (r.identifier.startsWith('0x')) {
        walletAddress = r.identifier;
      } else {
        const user = getUserByUsername(r.identifier);
        if (!user?.wallet_address) {
          return res.status(404).json({ error: `Recipient "${r.identifier}" not found or has no wallet` });
        }
        walletAddress = user.wallet_address;
      }
      wallets.push({ wallet: walletAddress, amount: r.amount });
    }

    // Execute on-chain transfers
    const hashes = [];
    for (const w of wallets) {
      if (token === 'cUSD') {
        const r = await sendCUSD({ fromPrivateKey: sender.wallet_private_key, toAddress: w.wallet, amountCusd: w.amount, memo });
        hashes.push(r.txHash);
      } else if (token === 'CELO') {
        const r = await sendCELO({ fromPrivateKey: sender.wallet_private_key, toAddress: w.wallet, amountCelo: w.amount, memo });
        hashes.push(r.txHash);
      } else {
        return res.status(400).json({ error: 'Unsupported token. Only cUSD or CELO allowed.' });
      }
    }

    const txHash = hashes[0];
    const explorerUrl = getExplorerUrl(txHash);

    // Record transactions in DB
    for (const w of wallets) {
      createTransaction({
        txHash, txType: 'split_custom',
        fromUserId: sender.id, toUserId: null,
        fromAddress: sender.wallet_address, toAddress: w.wallet,
        amountCusd: token === 'cUSD' ? parseFloat(w.amount) : 0,
        amountCelo: token === 'CELO' ? parseFloat(w.amount) : 0,
        memo
      });
    }

    res.json({
      txHash,
      explorerUrl,
      total: wallets.reduce((sum, w) => sum + w.amount, 0),
      recipients: wallets.length,
      token
    });
  } catch (err) {
    console.error('Custom split error:', err);
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

// ─── CELO Native Balance ──────────────────────────────────────────────────────

router.get('/celo/balance/:telegramId', async (req, res) => {
  try {
    const user = getUserByTelegramId(req.params.telegramId);
    if (!user) return res.status(404).json({ error: 'User not found. Use /start to register.' });
    if (!user.wallet_address) return res.status(400).json({ error: 'No wallet found.' });

    const balance = await getCELOBalance(user.wallet_address);
    res.json({ balance: balance.formatted, address: user.wallet_address, raw: balance.raw.toString(), currency: 'CELO' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Send Native CELO ─────────────────────────────────────────────────────────

router.post('/celo/send', async (req, res) => {
  try {
    const { fromTelegramId, toIdentifier, amountCelo, memo = '' } = req.body;
    if (!fromTelegramId || !toIdentifier || !amountCelo) {
      return res.status(400).json({ error: 'fromTelegramId, toIdentifier, amountCelo required' });
    }

    const sender = getUserByTelegramId(String(fromTelegramId));
    if (!sender) return res.status(404).json({ error: 'Sender not found' });
    if (!sender.wallet_private_key) return res.status(400).json({ error: 'Sender has no wallet' });

    let recipientWallet;
    if (toIdentifier.startsWith('0x')) {
      recipientWallet = toIdentifier;
    } else {
      const alias = resolveAlias(sender.id, toIdentifier.replace('@', ''));
      if (alias) {
        recipientWallet = alias.resolved_wallet || alias.wallet_address;
      } else {
        const recipient = getUserByUsername(toIdentifier);
        if (!recipient) return res.status(404).json({ error: `User "${toIdentifier}" not found` });
        recipientWallet = recipient.wallet_address;
      }
    }

    if (!recipientWallet) return res.status(400).json({ error: 'Recipient has no wallet' });

    const balance = await getCELOBalance(sender.wallet_address);
    if (parseFloat(balance.formatted) < parseFloat(amountCelo)) {
      return res.status(400).json({ error: `Insufficient balance. You have ${balance.formatted} CELO` });
    }

    const { txHash, explorerUrl } = await sendCELO({
      fromPrivateKey: sender.wallet_private_key,
      toAddress: recipientWallet,
      amountCelo
    });

    createTransaction({
      txHash, txType: 'send',
      fromUserId: sender.id, toUserId: null,
      fromAddress: sender.wallet_address, toAddress: recipientWallet,
      amountCusd: parseFloat(amountCelo), memo
    });

    waitForTransaction(txHash)
      .then(r => r.status === 'confirmed' ? confirmTransaction(txHash, r.blockNumber) : failTransaction(txHash))
      .catch(console.error);

    res.json({ txHash, explorerUrl, amount: amountCelo, currency: 'CELO' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/self/register', async (req, res) => {
  const { telegramId, walletAddress } = req.body;

  const user = getUserByTelegramId(telegramId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    const { agentAddress, sessionToken, qrDataURL } = await initiateSelfVerification(walletAddress);
    // Optionally store sessionToken → telegramId mapping in memory or DB
    res.json({ agentAddress, sessionToken, qrDataURL });
  } catch (err) {
    console.error('Self registration error:', err);
    res.status(500).json({ error: 'Failed to start Self verification' });
  }
});

router.get('/self/status/:telegramId', async (req, res) => {
  const { telegramId } = req.params;

  try {
    // Look up the latest sessionToken for this Telegram ID
    const sessionToken = getSessionTokenByTelegramId(telegramId); // implement reverse lookup

    if (!sessionToken) {
      return res.json({ verified: false, message: 'No Self session found for this user.' });
    }

    const status = await pollSelfVerificationStatus(sessionToken);

    if (status.stage === 'completed') {
      const user = getUserByTelegramId(telegramId);
      if (!user.self_verified) setUserVerified(telegramId, status.agentId);
      return res.json({ verified: true, stage: status.stage, agentId: status.agentId, humanAddress: status.humanAddress });
    }

    res.json({ verified: false, stage: status.stage });
  } catch (err) {
    console.error('Error polling Self status:', err);
    res.status(500).json({ error: 'Failed to check verification status' });
  }
});

router.get('/self/verify/:sessionToken', (req, res) => {
  const { sessionToken } = req.params;
  const deepLink = getLinkBySessionToken(sessionToken);

  if (!deepLink) {
    return res.status(404).send('Verification link expired or not found. Please type /start in the bot to generate a new one.');
  }

  res.redirect(deepLink);
});

router.get('/self/qr/:sessionToken', (req, res) => {
  const { sessionToken } = req.params;
  const qrDataURL = getQrDataURLBySessionToken(sessionToken);

  if (!qrDataURL) {
    return res.status(404).send('QR code not found for this session.');
  }

  // Convert base64 data URL to image buffer
  const base64Data = qrDataURL.replace(/^data:image\/png;base64,/, "");
  const img = Buffer.from(base64Data, 'base64');

  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': img.length
  });
  res.end(img);
});

router.get('/self/status/:sessionToken', async (req, res) => {
  const { sessionToken } = req.params;

  try {
    const status = await pollSelfVerificationStatus(sessionToken);

    const telegramId = getTelegramIdBySessionToken(sessionToken);

    if (!telegramId) {
      console.warn('No telegramId found for sessionToken:', sessionToken);
    }

    if (status.stage === 'completed') {
      if (telegramId) {
        const user = getUserByTelegramId(telegramId);

        if (!user?.self_verified) {
          setUserVerified(telegramId, status.agentId);
        }
      }

      return res.json({
        verified: true,
        stage: status.stage,
        agentId: status.agentId,
        humanAddress: status.humanAddress,
        telegramId
      });
    }

    // ⬇️ still inside try block
    return res.json({
      verified: false,
      stage: status.stage,
      telegramId
    });

  } catch (err) {
    console.error('Error polling Self status:', err);
    return res.status(500).json({ error: 'Failed to check verification status' });
  }
});

router.get('/self/session/:sessionToken', (req, res) => {
  const { sessionToken } = req.params;

  const telegramId = getTelegramIdBySessionToken(sessionToken);

  if (!telegramId) {
    return res.status(404).json({
      error: 'Session not found or expired'
    });
  }

  res.json({
    sessionToken,
    telegramId
  });
});

export default router;
