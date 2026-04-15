import { compressUploadBuffer } from './imageCompress.js';

function safeBufferCopy(buf) {
  if (!buf || !Buffer.isBuffer(buf)) return buf;
  return Buffer.from(buf);
}

function optimizeText(buffer) {
  try {
    const s = buffer.toString('utf8');
    // Collapse excessive whitespace, keep newlines.
    const out = s
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
      .join('\n')
      .trim() + '\n';
    return Buffer.from(out, 'utf8');
  } catch {
    return buffer;
  }
}

/**
 * Mandatory preprocessing for ALL uploads:
 * - images: compress/resize via sharp
 * - text/plain: whitespace optimization
 * - other types (pdf/doc/etc): safe copy so upload never uses the original buffer reference
 */
export async function preprocessUpload(buffer, mimetype) {
  const mt = (mimetype || '').toLowerCase();

  if (mt.startsWith('image/')) {
    const img = await compressUploadBuffer(buffer, mt);
    return {
      buffer: img.buffer,
      mimetype: img.mimetype || mt,
      processed: true,
      strategy: img.wasCompressed ? 'image-compress' : 'image-pass'
    };
  }

  if (mt === 'text/plain') {
    const out = optimizeText(safeBufferCopy(buffer));
    return { buffer: out, mimetype: mt, processed: true, strategy: 'text-opt' };
  }

  // PDFs / docs / others: no lossy optimization without external tooling; still enforce preprocessing step.
  return { buffer: safeBufferCopy(buffer), mimetype: mt || 'application/octet-stream', processed: true, strategy: 'copy' };
}

