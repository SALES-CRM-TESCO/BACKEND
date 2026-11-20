// Sales ⇄ Design CRM bridge. The Sales team raises design requests here; they appear in the
// Design Head's portal automatically (shared design_requests collection). Status, approved
// designs and decision notifications flow back and are read here. Sales only sees Sales-origin
// requests. Mirrors the Procurement bridge so the Design CRM treats all sources the same way.
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { clean, ah } from '../utils.js';
import { designModels, nextDesignReqId } from '../design-bridge-model.js';

const r = Router();
r.use(requireAuth);

const D = designModels();
const SOURCE = 'sales';
const PORTAL = 'Sales';
const MAX = 12 * 1024 * 1024;
const nowStr = () => new Date().toISOString().slice(0, 16).replace('T', ' ');

// ---- Stream an attachment or an approved design file (so Sales can view/download) ----
r.get('/files/:id', ah(async (req, res) => {
  let doc;
  try { doc = await D.DesignFile.findById(req.params.id); } catch { return res.status(404).json({ error: 'File not found' }); }
  if (!doc || !doc.data) return res.status(404).json({ error: 'File not found' });
  const disp = req.query.download ? 'attachment' : 'inline';
  const safe = (doc.name || 'file').replace(/[^\w.\-]+/g, '_');
  res.set('Content-Type', doc.type || 'application/octet-stream');
  res.set('Content-Disposition', `${disp}; filename="${safe}"`);
  res.set('Cache-Control', 'private, max-age=60');
  res.send(doc.data);
}));

// ---- Notifications from the Design CRM (approved / rejected / changes) ----
r.get('/notifications', ah(async (req, res) => {
  const list = await D.DesignNotif.find({ audience: SOURCE }).sort({ createdAt: -1 }).limit(40).lean();
  res.json({ items: list.map((n) => ({ id: String(n._id), title: n.title, message: n.desc || n.message || '', requestId: n.requestId || '', read: !!n.read, createdAt: n.createdAt })), unread: list.filter((n) => !n.read).length });
}));
r.post('/notifications/read-all', ah(async (req, res) => {
  await D.DesignNotif.updateMany({ audience: SOURCE, read: false }, { $set: { read: true } });
  res.json({ ok: true });
}));

// ---- List Sales-origin design requests (role-based: Sales sees only its own source) ----
r.get('/', ah(async (req, res) => {
  const q = { source: SOURCE };
  if (req.query.status) q.status = req.query.status;
  const docs = await D.DesignRequest.find(q).sort({ createdAt: -1 }).limit(500).lean();
  res.json({ requests: docs });
}));

// ---- One request (status + approved files) ----
r.get('/:id', ah(async (req, res) => {
  const doc = await D.DesignRequest.findOne({ id: req.params.id, source: SOURCE }).lean();
  if (!doc) return res.status(404).json({ error: 'Request not found' });
  res.json({ request: doc });
}));

// ---- Raise a design request → appears for the Design Head ----
r.post('/', ah(async (req, res) => {
  const b = req.body || {};
  const projectName = clean(b.projectName);
  const requirement = clean(b.requirement);
  if (!projectName) return res.status(400).json({ error: 'Enter the project name' });
  if (!requirement && !clean(b.description)) return res.status(400).json({ error: 'Describe the design requirement' });

  for (let i = 0; i < 50; i++) {
    try {
      const id = await nextDesignReqId(D.DesignRequest);
      const doc = await D.DesignRequest.create({
        id, source: SOURCE, status: 'New', assignedDesigner: 'Unassigned',
        projectName, customerName: clean(b.customerName), projectType: clean(b.projectType) || 'PEB',
        service: clean(b.service), requirement, description: clean(b.description),
        priority: clean(b.priority) || 'Medium', dueDate: clean(b.dueDate), location: clean(b.location),
        requestFrom: 'Sales Team', requestedBy: `${req.user.name} (${PORTAL})`, requestedByUser: req.user.name,
        salesProjectId: clean(b.salesProjectId), handoverRef: clean(b.handoverRef),
        history: [{ title: `Design request raised from ${PORTAL}`, time: nowStr(), desc: `${projectName}${b.handoverRef ? ' (' + clean(b.handoverRef) + ')' : ''} — ${requirement || clean(b.description)}` }],
      });
      // Notify the Design Head (shared design_notifications collection).
      try {
        await D.DesignNotif.create({
          audience: 'head', type: 'assignment', category: 'Assignments',
          title: `New design request from ${PORTAL}`,
          message: `${doc.projectName} — ${requirement || 'Design'}${doc.priority ? ' · ' + doc.priority : ''}${doc.dueDate ? ' · due ' + doc.dueDate : ''}`,
          desc: `${doc.projectName} — ${requirement || 'Design'}`,
          time: 'just now', read: false, requestId: doc.id, projectName: doc.projectName || '',
        });
      } catch { /* notification failure must not fail the request */ }
      return res.status(201).json({ request: doc.toObject() });
    } catch (e) { if (e && e.code === 11000) continue; throw e; }
  }
  throw new Error('Could not allocate a request id. Please try again.');
}));

// ---- Upload a supporting file (base64) → design_files, linked to the request ----
r.post('/:id/attachments', ah(async (req, res) => {
  const doc0 = await D.DesignRequest.findOne({ id: req.params.id, source: SOURCE });
  if (!doc0) return res.status(404).json({ error: 'Request not found' });
  const { name, type, size, dataBase64 } = req.body || {};
  if (!dataBase64) return res.status(400).json({ error: 'No file data received' });
  const raw = String(dataBase64);
  const b64 = raw.includes(',') ? raw.split(',').pop() : raw;
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) return res.status(400).json({ error: 'The file appears to be empty' });
  if (buf.length > MAX) return res.status(413).json({ error: 'That file is larger than 12 MB' });
  const f = await D.DesignFile.create({ entity: 'request', entityId: req.params.id, name: name || 'file', type: type || 'application/octet-stream', size: size || buf.length, uploadedBy: req.user.name, data: buf });
  const sizeStr = size ? (Math.round((size / 1024 / 1024) * 10) / 10) + ' MB' : '';
  const doc = await D.DesignRequest.findOneAndUpdate(
    { id: req.params.id, source: SOURCE },
    { $push: { attachments: { name: name || 'file', size: sizeStr, type: type || '', fileId: String(f._id) } } },
    { new: true }
  );
  res.json({ ok: true, fileId: String(f._id), request: doc.toObject() });
}));

export default r;
