/**
 * split.js — CeloPay skill
 * Split USDC equally or with custom amounts among multiple recipients
 */

const BACKEND = process.env.CELOPAY_BACKEND || 'http://localhost:3000';

export async function splitEqual({ fromTelegramId, recipientIdentifiers, totalAmountCusd, memo = '' }) {
  const res = await fetch(`${BACKEND}/api/split/equal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fromTelegramId, recipientIdentifiers, totalAmountCusd, memo })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Split failed');

  const perPerson = (totalAmountCusd / recipientIdentifiers.length).toFixed(2);
  return {
    txHash: data.txHash,
    explorerUrl: data.explorerUrl,
    display: `✅ Split *${totalAmountCusd} USDC* — *${perPerson} USDC* each to ${recipientIdentifiers.length} people\n[View on Celoscan](${data.explorerUrl})`
  };
}

export async function splitCustom({ fromTelegramId, recipients, memo = '' }) {
  // recipients: [{ identifier: '@james', amount: 60 }, ...]
  const res = await fetch(`${BACKEND}/api/split/custom`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fromTelegramId, recipients, memo })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Custom split failed');

  const total = recipients.reduce((sum, r) => sum + r.amount, 0).toFixed(2);
  return {
    txHash: data.txHash,
    display: `✅ Split *${total} USDC* across ${recipients.length} people\n[View on Celoscan](${data.explorerUrl})`
  };
}
