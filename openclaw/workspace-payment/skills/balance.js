/**
 * balance.js — CeloPay skill
 * Get a user's cUSD balance from Celo Alfajores
 */

const BACKEND = process.env.CELOPAY_BACKEND || 'http://localhost:3000';

export async function getBalance(telegramId) {
  const res = await fetch(`${BACKEND}/api/balance/${telegramId}`);
  if (!res.ok) throw new Error(`Balance fetch failed: ${res.status}`);
  const { balance, address } = await res.json();
  return {
    display: `💰 Your balance: *${balance} cUSD*\nWallet: \`${address}\``,
    balance,
    address
  };
}
