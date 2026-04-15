import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import { preprocessUpload } from './filePreprocess.js';

const MAX_FILE_BYTES = 25 * 1024 * 1024;

const ALLOWED_MIMES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/tiff',
  'image/avif'
]);

let missingWarned = false;
let successLogged = false;

export function getCloudinaryEnvStatus() {
  const cloud_name = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const api_key = process.env.CLOUDINARY_API_KEY?.trim();
  const api_secret = process.env.CLOUDINARY_API_SECRET?.trim();
  const missing = [];
  if (!cloud_name) missing.push('CLOUDINARY_CLOUD_NAME');
  if (!api_key) missing.push('CLOUDINARY_API_KEY');
  if (!api_secret) missing.push('CLOUDINARY_API_SECRET');
  return { ok: missing.length === 0, missing, cloud_name, api_key, api_secret };
}

/** Call after dotenv.config() — idempotent */
export function initCloudinaryConfig() {
  const { ok, missing, cloud_name, api_key, api_secret } = getCloudinaryEnvStatus();
  if (!ok) {
    if (!missingWarned) {
      console.error('[cloudinary] Missing env:', missing.join(', '));
      missingWarned = true;
    }
    return false;
  }
  cloudinary.config({
    cloud_name,
    api_key,
    api_secret,
    secure: true
  });
  if (!successLogged) {
    console.log('[cloudinary] Config loaded for cloud_name:', cloud_name);
    successLogged = true;
  }
  return true;
}

const fileFilter = (req, file, cb) => {
  const mime = (file.mimetype || '').toLowerCase();
  if (ALLOWED_MIMES.has(mime) || mime.startsWith('image/')) {
    return cb(null, true);
  }
  cb(new Error('Unsupported file type.'));
};

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter
});

/**
 * Multer error → HTTP status + message (no generic 500 for known cases)
 */
export function handleMulterUploadError(err, req, res, next) {
  if (!err) return next();

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `File too large. Maximum size is ${MAX_FILE_BYTES / (1024 * 1024)} MB.` });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'Unexpected file field or too many files.' });
    }
    console.error('[multer]', err.code, err.message);
    return res.status(400).json({ error: err.message || 'Upload rejected.' });
  }

  if (err.message === 'Unsupported file type.') {
    return res.status(400).json({ error: err.message });
  }

  return next(err);
}

export function uploadSingleFile(fieldName = 'file') {
  return (req, res, next) => {
    upload.single(fieldName)(req, res, (err) => {
      if (err) return handleMulterUploadError(err, req, res, next);
      next();
    });
  };
}

/** Applied on upload + delivery-friendly defaults */
const UPLOAD_TRANSFORMATION = [
  { width: 2048, height: 2048, crop: 'limit' },
  { quality: 'auto:good', fetch_format: 'auto' }
];

/**
 * Compress images in-memory, then upload with Cloudinary transformations.
 */
export async function uploadToCloudinary(buffer, folder, meta = {}) {
  const { mimetype, originalname } = meta;

  if (!initCloudinaryConfig()) {
    const { missing } = getCloudinaryEnvStatus();
    const err = new Error(`Cloudinary is not configured. Missing: ${missing.join(', ')}`);
    err.code = 'CLOUDINARY_CONFIG';
    throw err;
  }

  const processed = await preprocessUpload(buffer, mimetype);
  const uploadBuffer = processed.buffer;
  const effectiveMime = (processed.mimetype || mimetype || '').toLowerCase();

  console.log('[cloudinary] upload start', {
    originalname,
    mimetypeIn: mimetype,
    mimetypeOut: processed.mimetype,
    processed: processed.processed,
    strategy: processed.strategy,
    bytesIn: buffer?.length,
    bytesOut: uploadBuffer?.length
  });

  const isImage = effectiveMime.startsWith('image/');
  const uploadOptions = {
    folder: folder || 'vidya',
    resource_type: 'auto',
    use_filename: true,
    unique_filename: true
  };
  if (isImage) {
    uploadOptions.transformation = UPLOAD_TRANSFORMATION;
  }

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) {
          console.error('[cloudinary] upload error:', {
            message: error.message,
            http_code: error.http_code,
            name: error.name
          });
          return reject(error);
        }
        console.log('[cloudinary] upload ok', {
          public_id: result?.public_id,
          bytes: result?.bytes,
          format: result?.format,
          secure_url: result?.secure_url ? '(present)' : '(missing)'
        });
        resolve(result);
      }
    );
    uploadStream.end(uploadBuffer);
  });
}

export { cloudinary };
export default cloudinary;
