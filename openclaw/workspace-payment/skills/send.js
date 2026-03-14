/**
 * send.js — CeloPay skill
 * Send cUSD from one user to another
 */

const BACKEND = process.env.CELOPAY_BACKEND || 'http://localhost:3000';

export async function sendCUSD({ fromTelegramId, toIdentifier, amountCusd, memo = '' }) {
  const res = await fetch(`${BACKEND}/api/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fromTelegramId, toIdentifier, amountCusd, memo })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Send failed');

  return {
    txHash: data.txHash,
    explorerUrl: data.explorerUrl,
    display: `✅ Sent *${amountCusd} cUSD* to *${data.recipientName || toIdentifier}*\n[View on Celoscan](${data.explorerUrl})`
  };
}
