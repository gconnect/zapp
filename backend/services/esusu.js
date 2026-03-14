/**
 * Esusu service — orchestrates circle operations between DB and blockchain
 */

import * as db from '../db/index.js';
import { contributeToCircle, waitForTransaction } from './celo.js';

// ─── Create Circle ────────────────────────────────────────────────────────────

export async function createCircle({ adminTelegramId, name, contributionCusd, intervalDays, maxMembers, telegramGroupId }) {
  const admin = db.getUserByTelegramId(adminTelegramId);
  if (!admin) throw new Error('Admin user not found');
  if (!admin.self_verified) throw new Error('Admin must be Self-verified to create a circle');

  const circleId = db.createCircle({
    name,
    adminUserId: admin.id,
    telegramGroupId,
    contributionCusd,
    intervalDays: intervalDays || 30,
    maxMembers
  });

  // Add admin as first member
  db.addCircleMember(circleId, admin.id);

  return { circleId, message: `Circle "${name}" created! Share this ID with members: #${circleId}` };
}

// ─── Join Circle ──────────────────────────────────────────────────────────────

export async function joinCircle({ telegramId, circleId }) {
  const user = db.getUserByTelegramId(telegramId);
  if (!user) throw new Error('User not found');
  if (!user.self_verified) throw new Error('You must complete identity verification before joining a circle');

  const circle = db.getCircle(circleId);
  if (!circle) throw new Error(`Circle #${circleId} not found`);
  if (circle.status !== 'active') throw new Error('This circle is no longer active');

  const members = db.getCircleMembers(circleId);
  if (members.length >= circle.max_members) throw new Error('This circle is full');
  if (members.find(m => m.telegram_id === telegramId)) throw new Error('You are already in this circle');

  db.addCircleMember(circleId, user.id);

  return {
    message: `✅ You joined "${circle.name}"!\nContribution: ${circle.contribution_cusd} cUSD every ${circle.interval_days} days\nMembers: ${members.length + 1}/${circle.max_members}`
  };
}

// ─── Contribute ───────────────────────────────────────────────────────────────

export async function contribute({ telegramId, circleId }) {
  const user = db.getUserByTelegramId(telegramId);
  if (!user) throw new Error('User not found');
  if (!user.wallet_address || !user.wallet_private_key) throw new Error('No wallet found. Use /start to set up your wallet');

  const circle = db.getCircle(circleId);
  if (!circle) throw new Error(`Circle #${circleId} not found`);

  const round = circle.current_round;

  // Check if already paid
  const existing = db.getDB().prepare(
    'SELECT * FROM esusu_contributions WHERE circle_id = ? AND round = ? AND user_id = ?'
  ).get(circleId, round, user.id);

  if (existing) throw new Error(`You already contributed to round ${round} of "${circle.name}"`);

  let txHash = null;

  // If contract is deployed, use on-chain contribution
  if (process.env.ESUSU_CIRCLE_ADDRESS && circle.contract_circle_id) {
    const result = await contributeToCircle({
      fromPrivateKey: user.wallet_private_key,
      contractCircleId: circle.contract_circle_id,
      contributionCusd: circle.contribution_cusd
    });
    txHash = result.txHash;
    await waitForTransaction(txHash);
  }

  // Record in DB
  db.recordContribution({
    circleId,
    round,
    userId: user.id,
    amountCusd: circle.contribution_cusd,
    txHash
  });

  // Check if all members have now paid
  const unpaid = db.getUnpaidMembers(circleId, round);
  const members = db.getCircleMembers(circleId);
  const paidCount = members.length - unpaid.length;

  let statusMsg = `\nPaid: ${paidCount}/${members.length} members`;
  if (unpaid.length > 0) {
    const names = unpaid.map(m => `@${m.telegram_username || 'unknown'}`).join(', ');
    statusMsg += `\nStill outstanding: ${names}`;
  } else {
    statusMsg += `\n✅ All members have paid! Admin can now release payout.`;
  }

  return {
    txHash,
    message: `✅ Contributed ${circle.contribution_cusd} cUSD to "${circle.name}" (Round ${round})${statusMsg}`
  };
}

// ─── Get Circle Status ────────────────────────────────────────────────────────

export async function getCircleStatus(circleId) {
  const circle = db.getCircle(circleId);
  if (!circle) throw new Error(`Circle #${circleId} not found`);

  const members = db.getCircleMembers(circleId);
  const unpaid = db.getUnpaidMembers(circleId, circle.current_round);
  const paidCount = members.length - unpaid.length;

  const nextPayoutDate = circle.next_payout_date
    ? new Date(circle.next_payout_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'TBD';

  const potSize = (circle.contribution_cusd * members.length).toFixed(2);

  let msg = `🔄 *${circle.name}* (Circle #${circleId})\n\n`;
  msg += `💰 Contribution: ${circle.contribution_cusd} cUSD / ${circle.interval_days} days\n`;
  msg += `👥 Members: ${members.length}/${circle.max_members}\n`;
  msg += `📍 Round: ${circle.current_round}\n`;
  msg += `🏆 Pot: ${potSize} cUSD\n`;
  msg += `📅 Next payout: ${nextPayoutDate}\n\n`;
  msg += `✅ Paid this round: ${paidCount}/${members.length}\n`;

  if (unpaid.length > 0) {
    msg += `⏳ Outstanding: ${unpaid.map(m => `@${m.telegram_username || 'unknown'}`).join(', ')}`;
  } else {
    msg += `🎉 Everyone has paid!`;
  }

  return { circle, members, unpaid, message: msg };
}

// ─── List User Circles ────────────────────────────────────────────────────────

export async function getUserCircles(telegramId) {
  const user = db.getUserByTelegramId(telegramId);
  if (!user) throw new Error('User not found');

  const allCircles = db.getAllCircles();
  const userCircleIds = db.getDB().prepare(
    'SELECT circle_id FROM esusu_members WHERE user_id = ?'
  ).all(user.id).map(r => r.circle_id);

  const myCircles = allCircles.filter(c => userCircleIds.includes(c.id));

  if (myCircles.length === 0) return { message: "You're not in any circles yet. Ask an admin to add you or create one with /newcircle" };

  let msg = `🔄 *Your Esusu Circles*\n\n`;
  for (const c of myCircles) {
    const members = db.getCircleMembers(c.id);
    msg += `• *${c.name}* (#${c.id}) — ${c.contribution_cusd} cUSD, Round ${c.current_round}/${members.length}\n`;
  }

  return { circles: myCircles, message: msg };
}
