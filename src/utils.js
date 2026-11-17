import { config } from './config.js';

export function todayStr(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export const clean = (v) => (typeof v === 'string' ? v.trim() : v ?? '');

// wrap async route handlers so errors reach the error middleware
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Allowed attachment types: PDF, Excel, Word, images.
const ALLOWED_EXT = ['pdf', 'xls', 'xlsx', 'csv', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'ppt', 'pptx', 'txt'];
const ALLOWED_MIME = /^(application\/pdf|application\/vnd\.(ms-excel|openxmlformats-officedocument\.(spreadsheetml|wordprocessingml|presentationml)|ms-powerpoint)|application\/msword|text\/(csv|plain)|image\/)/i;
export function attachmentAllowed(file) {
  const ext = (file.originalname.split('.').pop() || '').toLowerCase();
  return ALLOWED_EXT.includes(ext) || ALLOWED_MIME.test(file.mimetype || '');
}
