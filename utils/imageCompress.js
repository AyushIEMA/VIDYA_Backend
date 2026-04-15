import sharp from 'sharp';

const IMAGE_MIME = /^image\/(jpeg|jpg|png|webp|gif|tiff|avif)$/i;

/** Max dimension after resize (maintain aspect ratio) */
const MAX_EDGE = 2048;
const JPEG_QUALITY = 82;
const PNG_COMPRESSION = 8;

/**
 * Buffer-only compression for raster images. Non-images returned unchanged.
 * @returns {{ buffer: Buffer, mimetype: string, wasCompressed: boolean }}
 */
export async function compressUploadBuffer(buffer, mimetype) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    return { buffer, mimetype, wasCompressed: false };
  }

  const mt = (mimetype || '').toLowerCase();
  if (!IMAGE_MIME.test(mt)) {
    return { buffer, mimetype: mt || 'application/octet-stream', wasCompressed: false };
  }

  try {
    let pipeline = sharp(buffer, { failOn: 'truncated' }).rotate();

    const meta = await pipeline.metadata();
    if (meta.width > MAX_EDGE || meta.height > MAX_EDGE) {
      pipeline = pipeline.resize({
        width: MAX_EDGE,
        height: MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true
      });
    }

    let outBuf;
    let outMime = mt;

    if (mt.includes('png')) {
      outBuf = await pipeline.png({ compressionLevel: PNG_COMPRESSION, effort: 7 }).toBuffer();
      outMime = 'image/png';
    } else if (mt.includes('webp')) {
      outBuf = await pipeline.webp({ quality: JPEG_QUALITY, effort: 4 }).toBuffer();
      outMime = 'image/webp';
    } else if (mt.includes('gif')) {
      // Skip re-encoding GIFs (animations); Cloudinary will still apply delivery transforms
      return { buffer, mimetype: mt, wasCompressed: false };
    } else {
      outBuf = await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
      outMime = 'image/jpeg';
    }

    if (!outBuf || outBuf.length >= buffer.length) {
      return { buffer, mimetype: mt, wasCompressed: false };
    }

    return { buffer: outBuf, mimetype: outMime, wasCompressed: true };
  } catch (err) {
    console.warn('[imageCompress] sharp failed, using original buffer:', err.message);
    return { buffer, mimetype: mt || 'application/octet-stream', wasCompressed: false };
  }
}

export function isRasterImageMime(mimetype) {
  return IMAGE_MIME.test((mimetype || '').toLowerCase());
}
