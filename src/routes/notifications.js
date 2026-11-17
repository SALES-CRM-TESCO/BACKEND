import { Router } from 'express';
import { HandoverNotification } from '../db.js';
import { requireAuth } from '../auth.js';
import { ah } from '../utils.js';

const r = Router();
r.use(requireAuth);

const audienceFilter = (user) => ({ audience: 'sales', $or: [{ userId: user._id }, { userId: null }] });

r.get('/', ah(async (req, res) => {
  const mine = await HandoverNotification.find(audienceFilter(req.user)).sort({ createdAt: -1 }).limit(100);
  const items = mine.map((n) => n.toJSON());
  res.json({ items, unread: items.filter((n) => !n.read).length });
}));

r.post('/read-all', ah(async (req, res) => {
  await HandoverNotification.updateMany({ ...audienceFilter(req.user), read: false }, { $set: { read: true } });
  res.json({ ok: true });
}));

r.post('/:id/read', ah(async (req, res) => {
  await HandoverNotification.updateOne({ _id: req.params.id, audience: 'sales' }, { $set: { read: true } });
  res.json({ ok: true });
}));

export default r;
