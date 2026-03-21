/**
 * split.js — CeloPay skill
 * Split USDC equally or with custom amounts among multiple recipients
 */

const BACKEND = process.env.BACKEND_URL || 'https://zapp.africinnovate.com';

/**
 * Split an amount equally among multiple recipients
 * @param {Object} params
 * @param {string} params.fromTelegramId - The sender's Telegram ID
 * @param {string[]} params.recipientIdentifiers - List of @usernames or wallet addresses
 * @param {string} [params.totalAmount] - Total amount to split (e.g. "10.0")
 * @param {string} [params.totalAmountUsdc] - Alias for totalAmount (backward compatibility)
 * @param {string} [params.token='USDC'] - Token to use (USDC or CELO)
 * @param {string} [params.memo] - Optional transaction memo
 */
export async function splitEqual({ fromTelegramId, recipientIdentifiers, totalAmount, totalAmountUsdc, token = 'USDC', memo = '' }) {
  const finalAmount = totalAmount || totalAmountUsdc;
  
  const res = await fetch(`${BACKEND}/api/split/equal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fromTelegramId, recipientIdentifiers, totalAmount: finalAmount, token, memo })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Split failed');

  const perPerson = (finalAmount / recipientIdentifiers.length).toFixed(2);
  return {
    txHash: data.txHash,
    explorerUrl: data.explorerUrl,
    display: `✅ Split *${finalAmount} ${token}* — *${perPerson} ${token}* each to ${recipientIdentifiers.length} people`
  };
}

export async function splitCustom({ fromTelegramId, recipients, token = 'USDC', memo = '' }) {
  // recipients: [{ identifier: '@james', amount: 60 }, ...]
  const res = await fetch(`${BACKEND}/api/split/custom`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fromTelegramId, recipients, token, memo })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Custom split failed');

  const total = recipients.reduce((sum, r) => sum + r.amount, 0).toFixed(2);
  return {
    txHash: data.txHash,
    display: `✅ Split *${total} ${token}* across ${recipients.length} people\n[View on Celoscan](${data.explorerUrl})`
  };
}
