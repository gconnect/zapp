import { Router } from 'express';
import { generateReceiptPNG, generateReceiptPDF } from '../services/receipt.js';

const router = Router();

/**
 * POST /receipt/png
 * Generate a PNG receipt image
 */
router.post('/png', async (req, res) => {
  try {
    const { txHash, sender, receiver, amountCusd, memo, timestamp, txType } = req.body;

    if (!amountCusd) return res.status(400).json({ error: 'amountCusd is required' });

    const pngBuffer = await generateReceiptPNG({ txHash, sender, receiver, amountCusd, memo, timestamp, txType });

    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', `inline; filename="receipt_${Date.now()}.png"`);
    res.send(pngBuffer);
  } catch (err) {
    console.error('PNG receipt error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /receipt/pdf
 * Generate a PDF receipt
 */
router.post('/pdf', async (req, res) => {
  try {
    const { txHash, sender, receiver, amountCusd, memo, timestamp, txType } = req.body;

    if (!amountCusd) return res.status(400).json({ error: 'amountCusd is required' });

    const pdfBuffer = await generateReceiptPDF({ txHash, sender, receiver, amountCusd, memo, timestamp, txType });

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="celopay_receipt_${Date.now()}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('PDF receipt error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
