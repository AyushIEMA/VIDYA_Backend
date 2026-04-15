import express from 'express';
import { sendWhatsAppMessage } from '../utils/whatsapp.js';

const router = express.Router();

function normalizeJoinText(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  // Twilio sandbox uses "join <code>"
  if (/^join\s+/i.test(t)) return t;
  return `join ${t}`;
}

router.get('/sandbox/config', (req, res) => {
  const fromNumber = String(process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886').trim();
  const joinRaw = process.env.TWILIO_WHATSAPP_SANDBOX_JOIN_CODE || process.env.WHATSAPP_SANDBOX_JOIN_CODE || '';
  const joinText = normalizeJoinText(joinRaw);

  // wa.me expects phone number without "whatsapp:" and without "+"
  const waPhone = fromNumber.replace(/^whatsapp:/, '').replace(/^\+/, '').trim();
  const waLink = joinText ? `https://wa.me/${waPhone}?text=${encodeURIComponent(joinText)}` : `https://wa.me/${waPhone}`;

  res.json({
    fromNumber,
    joinText,
    waLink,
    configured: Boolean(joinText),
  });
});

router.post('/sandbox/verify', async (req, res) => {
  try {
    const phone = String(req.body?.phone || '').trim();
    if (!phone) return res.status(400).json({ error: 'phone is required' });

    const result = await sendWhatsAppMessage(
      phone,
      '✅ Vidya WhatsApp verified.\nYou can complete your registration now.\n\nReply not monitored.'
    );

    if (!result?.success) {
      return res.status(400).json({ error: 'Join WhatsApp first' });
    }

    return res.json({ verified: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;

