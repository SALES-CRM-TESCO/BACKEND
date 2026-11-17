// Create or reset a Sales Portal login.
// Usage (run from the Backend folder, where Backend/.env has MONGO_URI):
//   node scripts/set-user.js <username> <password> <role> [full name...]
//   role = sales_head  or  sales_team
// Example:
//   node scripts/set-user.js salestescostructures@gmail.com saleshead@123 sales_head Sales Head
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB, User } from '../src/db.js';
import { hashPassword } from '../src/auth.js';
import { ROLES } from '../src/config.js';

const [, , rawUser, password, role = ROLES.HEAD, ...nameParts] = process.argv;
const username = String(rawUser || '').toLowerCase().trim();
const name = nameParts.join(' ').trim() || (role === ROLES.HEAD ? 'Sales Head' : 'Sales Team');

if (!username || !password) {
  console.error('Usage: node scripts/set-user.js <username> <password> <role: sales_head|sales_team> [full name]');
  process.exit(1);
}
if (!Object.values(ROLES).includes(role)) {
  console.error(`Role must be one of: ${Object.values(ROLES).join(', ')}`);
  process.exit(1);
}

(async () => {
  try {
    await connectDB();
    const passwordHash = await hashPassword(password);
    const existing = await User.findOne({ username });
    if (existing) {
      existing.passwordHash = passwordHash;
      existing.role = role;
      existing.active = true;
      existing.mustChangePassword = false;
      existing.passwordSetAt = new Date();
      existing.tokenVersion = (existing.tokenVersion || 0) + 1; // sign out old sessions
      if (!existing.name) existing.name = name;
      await existing.save();
      console.log(`✔ Updated login "${username}" (role: ${role}).`);
    } else {
      await User.create({ name, username, role, passwordHash, active: true, passwordSetAt: new Date() });
      console.log(`✔ Created login "${username}" (role: ${role}, name: ${name}).`);
    }
    await mongoose.connection.close();
    process.exit(0);
  } catch (e) {
    console.error('Failed:', e.message);
    process.exit(1);
  }
})();
