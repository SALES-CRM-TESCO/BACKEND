import { Router } from 'express';
import { User } from '../db.js';
import { ROLES } from '../config.js';
import { requireAuth, requireHead, hashPassword, passwordProblem, publicUser } from '../auth.js';
import { clean, ah } from '../utils.js';

const r = Router();
r.use(requireAuth);

const usernameFromName = (name) => clean(name).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'user';
async function uniqueUsername(base) {
  let u = base, i = 1;
  while (await User.exists({ username: u })) u = `${base}${++i}`;
  return u;
}
function genPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// List sales team members (Head only)
r.get('/', requireHead, ah(async (req, res) => {
  const users = await User.find().sort({ createdAt: -1 });
  res.json({ users: users.map(publicUser) });
}));

// Create a login for a sales team member (or another Sales Head)
r.post('/', requireHead, ah(async (req, res) => {
  const name = clean(req.body.name);
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const role = req.body.role === ROLES.HEAD ? ROLES.HEAD : ROLES.MEMBER;
  let username = clean(req.body.username).toLowerCase();
  if (username) { if (await User.exists({ username })) return res.status(400).json({ error: 'That username is already taken' }); }
  else username = await uniqueUsername(usernameFromName(name));

  const forceChange = !!req.body.mustChangePassword;
  const password = req.body.password || genPassword();
  const bad = passwordProblem(password);
  if (bad) return res.status(400).json({ error: bad });

  const employeeId = clean(req.body.employeeId).toUpperCase() || undefined;
  if (employeeId && await User.exists({ employeeId })) return res.status(400).json({ error: 'That Employee ID is already in use' });

  const user = await User.create({
    name, username, employeeId, email: clean(req.body.email), phone: clean(req.body.phone),
    designation: clean(req.body.designation), role,
    passwordHash: await hashPassword(password), mustChangePassword: forceChange, passwordSetAt: new Date(),
    createdBy: req.user._id,
  });
  // The plain password is shown ONCE to the Head so they can share it; never stored.
  res.json({ user: publicUser(user), credentials: { username, employeeId, password } });
}));

// Edit details
r.put('/:id', requireHead, ah(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  ['name', 'email', 'phone', 'designation'].forEach((k) => { if (req.body[k] !== undefined) user[k] = clean(req.body[k]); });
  if (req.body.employeeId !== undefined) {
    const eid = clean(req.body.employeeId).toUpperCase() || undefined;
    if (eid && await User.exists({ employeeId: eid, _id: { $ne: user._id } })) return res.status(400).json({ error: 'That Employee ID is already in use' });
    user.employeeId = eid;
  }
  await user.save();
  res.json({ user: publicUser(user) });
}));

// Reset password
r.post('/:id/reset-password', requireHead, ah(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const password = req.body.password || genPassword();
  const bad = passwordProblem(password);
  if (bad) return res.status(400).json({ error: bad });
  user.passwordHash = await hashPassword(password);
  user.mustChangePassword = !!req.body.mustChangePassword;
  user.passwordSetAt = new Date();
  user.tokenVersion = (user.tokenVersion || 0) + 1; // log them out everywhere
  await user.save();
  res.json({ ok: true, credentials: { username: user.username, employeeId: user.employeeId, password } });
}));

// Change role
r.post('/:id/role', requireHead, ah(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const role = req.body.role;
  if (role !== ROLES.HEAD && role !== ROLES.MEMBER) return res.status(400).json({ error: 'Invalid role' });
  if (user._id === req.user._id) return res.status(400).json({ error: 'You cannot change your own role' });
  user.role = role;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  res.json({ user: publicUser(user) });
}));

// Enable / disable
r.post('/:id/active', requireHead, ah(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user._id === req.user._id) return res.status(400).json({ error: 'You cannot disable your own account' });
  user.active = !!req.body.active;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  res.json({ user: publicUser(user) });
}));

export default r;
