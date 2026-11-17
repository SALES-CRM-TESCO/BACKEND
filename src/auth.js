import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config, ROLES } from './config.js';
import { User } from './db.js';

// ---- passwords (bcrypt, cost from BCRYPT_ROUNDS, default 12) ----
export const hashPassword = (plain) => bcrypt.hash(plain, config.bcryptRounds);
export const checkPassword = (plain, hash) => bcrypt.compare(plain || '', hash || '');
export const MIN_PASSWORD = 8;
export function passwordProblem(pw) {
  if (!pw || pw.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters`;
  if (pw.length > 128) return 'Password is too long';
  return null;
}

// ---- JWT ----
export function signToken(user) {
  return jwt.sign(
    { sub: user._id || user.id, role: user.role, tv: user.tokenVersion || 0 },
    config.jwtSecret,
    { algorithm: 'HS256', expiresIn: config.jwtExpiresIn, issuer: config.jwtIssuer, audience: config.jwtAudience }
  );
}

function readToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  // only attachment links (<a href>/<img src>) may pass the token in the URL
  if (req.method === 'GET' && req.query.token && /\/attachments\//.test(req.path)) return String(req.query.token);
  return null;
}

export async function requireAuth(req, res, next) {
  try {
    const token = readToken(req);
    if (!token) return res.status(401).json({ error: 'Not logged in' });
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'], issuer: config.jwtIssuer, audience: config.jwtAudience });
    } catch (e) {
      return res.status(401).json({ error: e.name === 'TokenExpiredError' ? 'Session expired, please log in again' : 'Invalid session, please log in again' });
    }
    const user = await User.findById(payload.sub);
    if (!user || !user.active) return res.status(401).json({ error: 'Account not active' });
    if ((user.tokenVersion || 0) !== (payload.tv || 0)) return res.status(401).json({ error: 'Session ended – please log in again' });
    req.user = user;
    next();
  } catch (e) { next(e); }
}

export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'You do not have permission to do this' });
export const requireHead = requireRole(ROLES.HEAD);

export const publicUser = (u) => (u ? (u.toJSON ? u.toJSON() : u) : null);

// A compact "actor" record stored on handovers / activity / notifications.
export const actorOf = (user) => ({ id: user._id || user.id, name: user.name, role: user.role, portal: 'sales' });
