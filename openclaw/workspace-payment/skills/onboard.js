/**
 * onboard.js — CeloPay skill
 * New user onboarding: wallet creation + Self verification
 */

const BACKEND = process.env.CELOPAY_BACKEND || 'http://localhost:3000';

export async function onboardUser({ telegramId, telegramUsername, telegramName }) {
  const res = await fetch(`${BACKEND}/api/onboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telegramId, telegramUsername, telegramName })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Onboarding failed');

  return {
    walletAddress: data.walletAddress,
    verificationLink: data.verificationLink,
    isNewUser: data.isNewUser,
    isVerified: data.isVerified,
    welcomeMessage: buildWelcome(data)
  };
}

function buildWelcome({ walletAddress, verificationLink, isNewUser, isVerified, telegramName }) {
  if (!isNewUser && isVerified) {
    return `Welcome back! Your wallet is ready 💰`;
  }

  if (!isNewUser && !isVerified) {
    return `You're registered but need to complete verification:\n👆 [Click here to Verify Identity](${verificationLink})`;
  }

  return `👋 Welcome to *CeloPay*, ${telegramName || 'friend'}!

Here's what you can do:
• 💸 Send USDC to anyone on Telegram
• 🔀 Split bills instantly  
• 🔄 Join esusu savings circles

Your Celo wallet has been created:
\`${walletAddress}\`

*Before your first transaction*, please verify your identity:
🔐 [Verify Identity Now](${verificationLink})

_Powered by Self Protocol — your data stays private_`;
}
