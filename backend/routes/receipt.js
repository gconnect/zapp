import { Router } from 'express';
import { generateReceiptPNG, generateReceiptPDF } from '../services/receipt.js';

const router = Router();

/**
 * @swagger
 * /receipt/png:
 *   post:
 *     summary: Generate PNG receipt
 *     description: Generates an image representing a transaction receipt.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amountCusd
 *             properties:
 *               txHash:
 *                 type: string
 *               sender:
 *                 type: string
 *               receiver:
 *                 type: string
 *               amountCusd:
 *                 type: string
 *               memo:
 *                 type: string
 *               timestamp:
 *                 type: string
 *               txType:
 *                 type: string
 *     responses:
 *       200:
 *         description: Image binary stream
 *         content:
 *           image/png:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Bad request
 *       500:
 *         description: Internal server error
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
 * @swagger
 * /receipt/pdf:
 *   post:
 *     summary: Generate PDF receipt
 *     description: Generates a PDF document representing a transaction receipt.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amountCusd
 *             properties:
 *               txHash:
 *                 type: string
 *               sender:
 *                 type: string
 *               receiver:
 *                 type: string
 *               amountCusd:
 *                 type: string
 *               memo:
 *                 type: string
 *               timestamp:
 *                 type: string
 *               txType:
 *                 type: string
 *     responses:
 *       200:
 *         description: PDF binary stream
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Bad request
 *       500:
 *         description: Internal server error
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
