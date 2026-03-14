/**
 * receipt.js — CeloPay skill
 * Fetch PNG and PDF receipts from backend and send via Telegram
 */

const BACKEND = process.env.CELOPAY_BACKEND || 'http://localhost:3000';

export async function fetchReceiptPNG(receiptData) {
  const res = await fetch(`${BACKEND}/receipt/png`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(receiptData)
  });
  if (!res.ok) throw new Error('PNG receipt generation failed');
  return Buffer.from(await res.arrayBuffer());
}

export async function fetchReceiptPDF(receiptData) {
  const res = await fetch(`${BACKEND}/receipt/pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(receiptData)
  });
  if (!res.ok) throw new Error('PDF receipt generation failed');
  return Buffer.from(await res.arrayBuffer());
}
