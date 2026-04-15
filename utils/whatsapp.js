function normalizeE164(phone) {
  const raw = String(phone || '').trim();
  if (!raw) return '';

  // Already has country code
  if (raw.startsWith('+')) return raw;

  // Digits only -> best-effort normalize for India
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return '';

  // If user stored "91xxxxxxxxxx"
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;

  // If user stored "xxxxxxxxxx" (assume India)
  if (digits.length === 10) return `+91${digits}`;

  // Fallback: prefix '+'
  return `+${digits}`;
}

function normalizeToWhatsAppAddress(phone) {
  const raw = String(phone || '').trim();
  if (!raw) return '';
  if (raw.startsWith('whatsapp:')) return raw;
  const e164 = normalizeE164(raw);
  if (!e164) return '';
  return `whatsapp:${e164}`;
}

export const sendWhatsAppMessage = async (phone, message) => {
  const text = String(message ?? '').trim();
  const to = normalizeToWhatsAppAddress(phone);

  if (!to) return { success: false, error: 'Missing phone' };
  if (!text) return { success: false, error: 'Missing message' };

  // Demo / mock notifications only: do not send real WhatsApp messages.
  console.log(`[MOCK WhatsApp] To: ${to}, Message: ${text}`);
  return { success: true, mock: true };
};
