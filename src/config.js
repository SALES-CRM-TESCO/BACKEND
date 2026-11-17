import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

// All secrets come from environment variables (.env locally, host settings in production).
// Nothing secret is hard-coded here.
function required(name, check = (v) => !!v, hint = '') {
  const v = process.env[name];
  if (!check(v)) {
    console.error(`\n[config] Missing or invalid ${name}. ${hint}\nSet it in Backend/.env (see .env.example).\n`);
    process.exit(1);
  }
  return v;
}

export const config = {
  port: Number(process.env.PORT || 5100),
  // IMPORTANT: use the SAME MongoDB connection string / database as the Execution Portal
  // so both portals share the handover records.
  mongoUri: required('MONGO_URI', (v) => /^mongodb(\+srv)?:\/\//.test(v || ''), 'It must be a MongoDB connection string.'),
  mongoDbName: process.env.MONGO_DB_NAME || undefined, // default: database named in MONGO_URI
  // Sales Portal keeps its own users in "sp_" collections; handover records live in shared "ho_" collections.
  salesPrefix: process.env.SALES_PREFIX || 'sp_',
  handoverPrefix: process.env.HANDOVER_PREFIX || 'ho_',
  jwtSecret: required('JWT_SECRET', (v) => (v || '').length >= 32, 'Use at least 32 random characters (npm run gen:secret).'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  jwtIssuer: 'tesco-sales-portal',
  jwtAudience: 'tesco-sales-portal-web',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 12),
  tz: process.env.TZ_NAME || 'Asia/Kolkata',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  isProd: process.env.NODE_ENV === 'production',
};

export const ROLES = { HEAD: 'sales_head', MEMBER: 'sales_team' };

// Handover lifecycle statuses (shared with the Execution Portal)
export const HANDOVER_STATUSES = ['Draft', 'Submitted', 'Under Review', 'Changes Requested', 'Accepted', 'Rejected'];
