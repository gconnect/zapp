/**
 * esusu-cron.js — Auto-deduction and payout cron for esusu circles
 */

import * as db from '../db/index.js';
import { sendCUSD } from './celo.js';

const BACKEND_URL = (process.env.BACKEND_URL || 'https://zapp.africinnovate.com').replace(/\/$/, '');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export async function runEsusuCron() {
  const database = db.getDB();

  const activeCircles = database.prepare(`
    SELECT * FROM esusu_circles 
    WHERE status = 'active'
    AND round_start_date IS NOT NULL
  `).all();

  if (activeCircles.length > 0) {
    console.log(`Esusu cron: checking ${activeCircles.length} active circle(s)`);
  }

  for (const circle of activeCircles) {
    try {
      await processCircle(circle, database);
    } catch (err) {
      console.error(`Esusu cron error for circle ${circle.id}:`, err.message);
    }
  }
}

async function processCircle(circle, database) {
  const now = new Date();
  const roundStart = new Date(circle.round_start_date);
  const intervalMs = circle.interval_days * 24 * 60 * 60 * 1000;
  const deadline = new Date(roundStart.getTime() + intervalMs);
  const msLeft = deadline - now;
  const minutesLeft = Math.round(msLeft / 60000);

  // Send reminder 1 minute before deadline
  if (minutesLeft === 1) {
    const unpaid = db.getUnpaidMembers(circle.id, circle.current_round);
    for (const member of unpaid) {
      await notify(member.telegram_id,
        `⏰ *Reminder:* Your contribution of *${circle.contribution_cusd} USDC* to "${circle.name}" circle is due in 1 minute!\n\nType: *contribute to circle ${circle.id}*`
      );
    }
    return;
  }

  // Not yet due
  if (now < deadline) return;

  console.log(`Esusu cron: Circle ${circle.id} "${circle.name}" round ${circle.current_round} is due — auto-debiting`);

  const members = db.getCircleMembers(circle.id);
  const unpaid = db.getUnpaidMembers(circle.id, circle.current_round);

  // Auto-debit unpaid members
  for (const member of unpaid) {
    const user = db.getUserByTelegramId(member.telegram_id);
    if (!user?.wallet_private_key) continue;

    try {
      console.log(`Attempting auto-debit for ${user.telegram_username} wallet ${user.wallet_address}`);
      const result = await sendCUSD({
        fromPrivateKey: user.wallet_private_key,
        toAddress: process.env.ESUSU_CIRCLE_ADDRESS,
        amountCusd: circle.contribution_cusd,
        memo: `esusu-auto-circle-${circle.id}-round-${circle.current_round}`
      });

      db.recordContribution({
        circleId: circle.id,
        round: circle.current_round,
        userId: user.id,
        amountCusd: circle.contribution_cusd,
        txHash: result.txHash
      });

      console.log(`Auto-debit success: ${user.telegram_username} → ${result.txHash}`);

      await notify(user.telegram_id,
        `🔄 *Auto-contribution* of *${circle.contribution_cusd} USDC* made to "${circle.name}" circle.\n[View on Blockscout](${result.explorerUrl})`
      );

    } catch (err) {
      console.error(`Auto-debit failed for ${user?.telegram_username}:`, err.message, err.cause?.message || '', err.shortMessage || '');
      await notify(member.telegram_id,
        `⚠️ Auto-contribution to "${circle.name}" failed — insufficient balance.\nPlease add funds and contribute manually: *contribute to circle ${circle.id}*`
      );
    }
  }

  // Check if all paid now
  const stillUnpaid = db.getUnpaidMembers(circle.id, circle.current_round);
  if (stillUnpaid.length > 0) {
    console.log(`Circle ${circle.id}: ${stillUnpaid.length} still unpaid after auto-debit`);
    return;
  }

  // All paid — release payout
  await releasePayout(circle, members, database);
}

async function releasePayout(circle, members, database) {
  const round = circle.current_round;
  const recipientIndex = (round - 1) % members.length;
  const recipient = members[recipientIndex];

  if (!recipient?.wallet_address) {
    console.error(`Circle ${circle.id}: no wallet for recipient`);
    return;
  }

  const potSize = circle.contribution_cusd * members.length;
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;

  if (!deployerKey) {
    console.error('No DEPLOYER_PRIVATE_KEY set for payout');
    return;
  }

  try {
    console.log(`Releasing ${potSize} USDC to ${recipient.telegram_username} for circle ${circle.id} round ${round}`);

    const result = await sendCUSD({
      fromPrivateKey: deployerKey,
      toAddress: recipient.wallet_address,
      amountCusd: potSize,
      memo: `esusu-payout-circle-${circle.id}-round-${round}`
    });

    console.log(`Payout success: ${result.txHash}`);

    // Notify all members
    for (const member of members) {
      const isRecipient = member.telegram_id === recipient.telegram_id;
      await notify(member.telegram_id, isRecipient
        ? `🎉 You received *${potSize} USDC* from "${circle.name}" circle!\nRound ${round} payout complete.\n[View on Blockscout](${result.explorerUrl})`
        : `✅ Round ${round} of "${circle.name}" complete!\n@${recipient.telegram_username} received *${potSize} USDC*.\nYour turn is coming!`
      );
    }

    // Advance to next round or complete circle
    const totalRounds = members.length;
    if (round >= totalRounds) {
      database.prepare("UPDATE esusu_circles SET status = 'completed' WHERE id = ?").run(circle.id);
      console.log(`Circle ${circle.id} completed after ${totalRounds} rounds`);
      for (const member of members) {
        await notify(member.telegram_id,
          `🏆 "${circle.name}" circle is complete! All ${members.length} members have received their payout. Great saving together! 🌍`
        );
      }
    } else {
      database.prepare(`
        UPDATE esusu_circles 
        SET current_round = current_round + 1,
            round_start_date = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(circle.id);
      console.log(`Circle ${circle.id} advanced to round ${round + 1}`);
      for (const member of members) {
        await notify(member.telegram_id,
          `📅 Round *${round + 1}* of "${circle.name}" has started!\nContribute *${circle.contribution_cusd} USDC* when ready.\nType: *contribute to circle ${circle.id}*`
        );
      }
    }

  } catch (err) {
    console.error(`Payout failed for circle ${circle.id}:`, err.message);
    for (const member of members) {
      await notify(member.telegram_id,
        `⚠️ Payout for "${circle.name}" round ${round} failed. Admin will process manually.`
      );
    }
  }
}

async function notify(telegramId, message) {
  if (!BOT_TOKEN || !telegramId) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramId,
        text: message,
        parse_mode: 'Markdown'
      })
    });
  } catch (err) {
    console.error(`Notify failed for ${telegramId}:`, err.message);
  }
}
