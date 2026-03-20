/**
 * faucet.js — CeloPay skill
 * Request 10 USDC from the Celo Sepolia testnet faucet
 */

const BACKEND = process.env.CELOPAY_BACKEND || 'http://localhost:3000';

export async function requestFaucet(telegramId) {
  const res = await fetch(`${BACKEND}/api/faucet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telegramId })
  });
  
  const data = await res.json();
  if (!res.ok) {
    return {
      display: `⚠️ Faucet request failed:\n${data.error || 'Unknown error'}`,
      error: data.error
    };
  }
  
  return {
    display: `🚰 Faucet Request Successful!\n\n${data.message}\n\nAmount: *${data.amount} ${data.asset}*\nTransaction: [View on Explorer](${data.explorerUrl})`,
    ...data
  };
}
