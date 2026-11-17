import crypto from 'crypto';
// Prints a strong random key to paste into Backend/.env as JWT_SECRET.
console.log(crypto.randomBytes(48).toString('base64'));
