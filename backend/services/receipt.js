/**
 * Receipt generation service
 * Generates both PNG (canvas) and PDF (pdfkit) receipts with QR codes
 */

import QRCode from 'qrcode';
import PDFDocument from 'pdfkit';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function truncateTx(hash) {
  if (!hash) return 'N/A';
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function formatDate(dateStr) {
  return new Date(dateStr || Date.now()).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC'
  }) + ' UTC';
}

// ─── PNG Receipt (Canvas) ────────────────────────────────────────────────────

export async function generateReceiptPNG({ txHash, sender, receiver, amountCusd, memo, timestamp, txType = 'send' }) {
  try {
    const { createCanvas, loadImage } = await import('canvas');
    const canvas = createCanvas(600, 420);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#0D1117';
    ctx.fillRect(0, 0, 600, 420);

    // Header bar
    ctx.fillStyle = '#FCFF52';
    ctx.fillRect(0, 0, 600, 6);

    // Logo area
    ctx.fillStyle = '#FCFF52';
    ctx.font = 'bold 24px Arial';
    ctx.fillText('CeloPay', 40, 50);

    ctx.fillStyle = '#666666';
    ctx.font = '13px Arial';
    ctx.fillText('Powered by Celo Alfajores', 40, 70);

    // Divider
    ctx.fillStyle = '#21262D';
    ctx.fillRect(40, 85, 520, 1);

    // Transaction type badge
    const badgeColor = txType === 'send' ? '#238636' : txType === 'split' ? '#1F6FEB' : '#8B5CF6';
    ctx.fillStyle = badgeColor;
    ctx.beginPath();
    ctx.roundRect(40, 100, 80, 24, 4);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 11px Arial';
    ctx.fillText(txType.toUpperCase(), 52, 116);

    // Amount — big and prominent
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 42px Arial';
    ctx.fillText(`${amountCusd} USDC`, 40, 175);

    // Transaction details
    const details = [
      ['From',   sender   || 'Unknown'],
      ['To',     receiver || 'Unknown'],
      ['Date',   formatDate(timestamp)],
      ['Memo',   memo     || '—'],
      ['Tx Hash', truncateTx(txHash)]
    ];

    ctx.font = '13px Arial';
    let y = 210;
    for (const [label, value] of details) {
      ctx.fillStyle = '#8B949E';
      ctx.fillText(label, 40, y);
      ctx.fillStyle = '#E6EDF3';
      ctx.fillText(value, 140, y);
      y += 26;
    }

    // QR Code
    if (txHash) {
      const explorerUrl = `https://alfajores.celoscan.io/tx/${txHash}`;
      const qrDataUrl = await QRCode.toDataURL(explorerUrl, {
        width: 130,
        color: { dark: '#FFFFFF', light: '#0D1117' }
      });
      const qrImage = await loadImage(qrDataUrl);
      ctx.drawImage(qrImage, 445, 95, 115, 115);

      ctx.fillStyle = '#8B949E';
      ctx.font = '10px Arial';
      ctx.fillText('Scan to verify', 454, 222);
    }

    // Footer
    ctx.fillStyle = '#21262D';
    ctx.fillRect(0, 390, 600, 30);
    ctx.fillStyle = '#8B949E';
    ctx.font = '11px Arial';
    ctx.fillText('celopay.app  •  Built on Celo Alfajores', 40, 409);

    return canvas.toBuffer('image/png');
  } catch (err) {
    console.error('Canvas not available, generating fallback receipt:', err.message);
    return generateReceiptPNGFallback({ txHash, sender, receiver, amountCusd, memo, timestamp, txType });
  }
}

// Fallback: returns a JSON buffer when canvas isn't installed
function generateReceiptPNGFallback(data) {
  return Buffer.from(JSON.stringify(data, null, 2));
}

// ─── PDF Receipt (PDFKit) ─────────────────────────────────────────────────────

export async function generateReceiptPDF({ txHash, sender, receiver, amountCusd, memo, timestamp, txType = 'send' }) {
  const explorerUrl = txHash ? `https://alfajores.celoscan.io/tx/${txHash}` : null;

  // Generate QR code as buffer
  let qrBuffer = null;
  if (txHash) {
    qrBuffer = await QRCode.toBuffer(explorerUrl, { width: 120 });
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [420, 320], margin: 30 });
    const buffers = [];

    doc.on('data', chunk => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    // Header stripe
    doc.rect(0, 0, 420, 5).fill('#FCFF52');

    // Title
    doc.fontSize(18).fillColor('#000000').font('Helvetica-Bold').text('CeloPay Receipt', 30, 20);
    doc.fontSize(9).fillColor('#888888').font('Helvetica').text('Powered by Celo Alfajores', 30, 44);

    // Divider
    doc.moveTo(30, 58).lineTo(390, 58).strokeColor('#CCCCCC').stroke();

    // Amount
    doc.fontSize(28).fillColor('#000000').font('Helvetica-Bold').text(`${amountCusd} USDC`, 30, 68);

    // Type badge
    const badgeColors = { send: '#238636', split: '#1F6FEB', esusu_contribute: '#8B5CF6' };
    const bc = badgeColors[txType] || '#888888';
    doc.rect(30, 100, 55, 16).fill(bc);
    doc.fontSize(8).fillColor('#FFFFFF').font('Helvetica-Bold').text(txType.toUpperCase(), 34, 104);

    // Details
    const rows = [
      ['From',    sender   || 'Unknown'],
      ['To',      receiver || 'Unknown'],
      ['Date',    formatDate(timestamp)],
      ['Memo',    memo     || '—'],
      ['Tx Hash', truncateTx(txHash)]
    ];

    let y = 126;
    for (const [label, value] of rows) {
      doc.fontSize(9).fillColor('#888888').font('Helvetica-Bold').text(label, 30, y);
      doc.fontSize(9).fillColor('#000000').font('Helvetica').text(value, 110, y);
      y += 18;
    }

    // QR code
    if (qrBuffer) {
      doc.image(qrBuffer, 300, 68, { width: 90, height: 90 });
      doc.fontSize(7).fillColor('#888888').text('Scan to verify on Celoscan', 295, 162, { width: 100, align: 'center' });
    }

    // Footer
    doc.moveTo(0, 295).lineTo(420, 295).strokeColor('#EEEEEE').stroke();
    doc.fontSize(8).fillColor('#AAAAAA').font('Helvetica').text('celopay.app  •  Built on Celo Alfajores', 30, 302);

    doc.end();
  });
}
