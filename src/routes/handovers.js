import { Router } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { Handover, HandoverActivity, fileBucket } from '../db.js';
import { ROLES } from '../config.js';
import { requireAuth, actorOf } from '../auth.js';
import { clean, ah, attachmentAllowed } from '../utils.js';
import { nextHandoverRef, logActivity, HANDOVER_STATUSES } from '../handover-model.js';
import { HO } from '../db.js';
import { config } from '../config.js';
import { notifyExecution } from '../notify.js';

const r = Router();
r.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 20 } });

const isHead = (u) => u.role === ROLES.HEAD;
const owns = (h, u) => (h.createdBy && h.createdBy.id === u._id) || isHead(u);
const EDITABLE = ['Draft', 'Changes Requested'];

// Build the handover document body from the request (shared by create + update).
function readBody(b) {
  const n = (v) => Number(v) || 0;
  const d = b?.details || {}, sc = b?.scope || {}, tl = b?.timeline || {}, pr = b?.pricing || {};
  const quotedPrice = n(pr.quotedPrice);
  const milestones = (Array.isArray(pr.milestones) ? pr.milestones : [])
    .map((m) => ({ term: clean(m?.term), percentage: n(m?.percentage), value: n(m?.value) }))
    .filter((m) => m.term || m.percentage || m.value);
  const yesNo = (v) => (String(v || '').toLowerCase() === 'no' ? 'No' : 'Yes');
  const details = {
    leadId: clean(d.leadId), clientName: clean(d.clientName), projectLocation: clean(d.projectLocation),
    contactDetails: clean(d.contactDetails), billingName: clean(d.billingName), mobileNumber: clean(d.mobileNumber),
    alternateMobile: clean(d.alternateMobile), siteAddress: clean(d.siteAddress), billingAddress: clean(d.billingAddress),
    gstNumber: clean(d.gstNumber), emailWhatsapp: clean(d.emailWhatsapp), salespersonName: clean(d.salespersonName),
    dateOfOrder: clean(d.dateOfOrder), proposalRefNo: clean(d.proposalRefNo),
  };
  const scope = {
    typeOfProject: clean(sc.typeOfProject), projectSizeArea: clean(sc.projectSizeArea),
    design3D: !!sc.design3D, design2D: !!sc.design2D,
    transportationClientScope: yesNo(sc.transportationClientScope), scaffoldingClientScope: yesNo(sc.scaffoldingClientScope),
  };
  return {
    details, scope,
    timeline: { tentativeStartDate: clean(tl.tentativeStartDate), tentativeCompletionDate: clean(tl.tentativeCompletionDate), leadTimePromised: clean(tl.leadTimePromised) },
    pricing: { quotedPrice, milestones },
    siteVisitCompleted: !!b?.siteVisitCompleted,
    declarationAccepted: !!b?.declarationAccepted,
    // summary mirrors for lists & dashboards
    clientName: details.clientName,
    projectName: scope.typeOfProject || details.projectLocation,
    projectValue: quotedPrice,
  };
}

const myFilter = (u) => (isHead(u) ? {} : { 'createdBy.id': u._id });

// ---- Dashboard stats ----
r.get('/dashboard', ah(async (req, res) => {
  const base = myFilter(req.user);
  const all = await Handover.find(base).lean();
  const by = (s) => all.filter((h) => h.status === s).length;
  const pendingStatuses = ['Submitted', 'Under Review', 'Changes Requested'];
  res.json({
    total: all.length,
    draft: by('Draft'),
    submitted: by('Submitted'),
    underReview: by('Under Review'),
    changesRequested: by('Changes Requested'),
    accepted: by('Accepted'),
    rejected: by('Rejected'),
    pending: all.filter((h) => pendingStatuses.includes(h.status)).length,
    completed: by('Accepted'),
    totalValue: all.reduce((s, h) => s + (h.projectValue || 0), 0),
  });
}));

// ---- List ----
r.get('/', ah(async (req, res) => {
  const filter = myFilter(req.user);
  if (req.query.status && HANDOVER_STATUSES.includes(req.query.status)) filter.status = req.query.status;
  const q = clean(req.query.q).toLowerCase();
  let list = await Handover.find(filter).sort({ updatedAt: -1 }).lean();
  if (q) {
    list = list.filter((h) => [h.ref, h.clientName, h.projectName, h.details?.proposalRefNo, h.details?.leadId, h.createdBy?.name]
      .filter(Boolean).join(' ').toLowerCase().includes(q));
  }
  res.json({ handovers: list.map((h) => ({ ...h, id: h._id, attachmentCount: (h.attachments || []).length })) });
}));

// ---- Create (Draft) ----
r.post('/', ah(async (req, res) => {
  const doc = readBody(req.body);
  const h = await Handover.create({ ...doc, status: 'Draft', createdBy: actorOf(req.user), lastActor: actorOf(req.user) });
  await logActivity(HO, h, { type: 'created', message: 'Handover draft created', by: actorOf(req.user) });
  res.json({ handover: h.toJSON() });
}));

// ---- Detail (+ history) ----
r.get('/:id', ah(async (req, res) => {
  const h = await Handover.findById(req.params.id);
  if (!h) return res.status(404).json({ error: 'Handover not found' });
  if (!owns(h, req.user)) return res.status(403).json({ error: 'You can only view your own handovers' });
  const activity = await HandoverActivity.find({ handoverId: h._id }).sort({ createdAt: 1 });
  res.json({ handover: h.toJSON(), activity: activity.map((a) => a.toJSON()) });
}));

// ---- Update (only Draft / Changes Requested) ----
r.put('/:id', ah(async (req, res) => {
  const h = await Handover.findById(req.params.id);
  if (!h) return res.status(404).json({ error: 'Handover not found' });
  if (!owns(h, req.user)) return res.status(403).json({ error: 'You can only edit your own handovers' });
  if (!EDITABLE.includes(h.status)) return res.status(400).json({ error: `A handover that is "${h.status}" cannot be edited` });
  Object.assign(h, readBody(req.body));
  h.lastActor = actorOf(req.user);
  await h.save();
  await logActivity(HO, h, { type: 'updated', message: 'Handover details updated', by: actorOf(req.user) });
  res.json({ handover: h.toJSON() });
}));

// ---- Submit / Resubmit ----
r.post('/:id/submit', ah(async (req, res) => {
  const h = await Handover.findById(req.params.id);
  if (!h) return res.status(404).json({ error: 'Handover not found' });
  if (!owns(h, req.user)) return res.status(403).json({ error: 'You can only submit your own handovers' });
  if (!EDITABLE.includes(h.status)) return res.status(400).json({ error: `This handover is already "${h.status}"` });
  if (!h.clientName && !h.projectName) return res.status(400).json({ error: 'Add at least the client name or project type before submitting' });

  const wasChanges = h.status === 'Changes Requested';
  if (!h.ref) h.ref = await nextHandoverRef(HO, config.tz);
  const from = h.status;
  h.status = 'Submitted';
  h.submittedAt = new Date();
  h.lastActor = actorOf(req.user);
  await h.save();
  await logActivity(HO, h, { type: wasChanges ? 'resubmitted' : 'submitted', fromStatus: from, toStatus: 'Submitted', message: wasChanges ? 'Updated handover resubmitted to Execution' : 'Handover submitted to Execution', by: actorOf(req.user) });
  await notifyExecution(h, { type: 'handover', title: wasChanges ? `Handover ${h.ref} resubmitted` : `New handover ${h.ref}`, message: `${h.project?.name || 'Project'} — from ${req.user.name}` });
  res.json({ handover: h.toJSON() });
}));

// ---- Delete a draft ----
r.delete('/:id', ah(async (req, res) => {
  const h = await Handover.findById(req.params.id);
  if (!h) return res.status(404).json({ error: 'Handover not found' });
  if (!owns(h, req.user)) return res.status(403).json({ error: 'You can only delete your own handovers' });
  if (h.status !== 'Draft') return res.status(400).json({ error: 'Only a draft can be deleted' });
  await Promise.all((h.attachments || []).map((a) => fileBucket().delete(new mongoose.Types.ObjectId(a.fileId)).catch(() => {})));
  await HandoverActivity.deleteMany({ handoverId: h._id });
  await h.deleteOne();
  res.json({ ok: true });
}));

// ---- Add a comment (to the Execution team) ----
r.post('/:id/comments', ah(async (req, res) => {
  const h = await Handover.findById(req.params.id);
  if (!h) return res.status(404).json({ error: 'Handover not found' });
  if (!owns(h, req.user)) return res.status(403).json({ error: 'Not allowed' });
  const message = clean(req.body.message);
  if (!message) return res.status(400).json({ error: 'Enter a comment' });
  await logActivity(HO, h, { type: 'comment', message, by: actorOf(req.user) });
  if (h.ref) await notifyExecution(h, { type: 'comment', title: `Comment on ${h.ref}`, message: `${req.user.name}: ${message.slice(0, 80)}` });
  res.json({ ok: true });
}));

// ---- Upload attachments ----
r.post('/:id/attachments', upload.array('files', 20), ah(async (req, res) => {
  const h = await Handover.findById(req.params.id);
  if (!h) return res.status(404).json({ error: 'Handover not found' });
  if (!owns(h, req.user)) return res.status(403).json({ error: 'Not allowed' });
  if (!EDITABLE.includes(h.status)) return res.status(400).json({ error: `Attachments can only be changed while the handover is a Draft or has Changes Requested` });
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'No files received' });
  const bad = files.find((f) => !attachmentAllowed(f));
  if (bad) return res.status(400).json({ error: `"${bad.originalname}" is not an allowed file type (PDF, Excel, Word, PowerPoint, images)` });

  const added = [];
  for (const f of files) {
    const stream = fileBucket().openUploadStream(f.originalname, { contentType: f.mimetype, metadata: { handoverId: h._id } });
    await new Promise((resolve, reject) => { stream.on('error', reject); stream.on('finish', resolve); stream.end(f.buffer); });
    added.push({ fileId: String(stream.id), filename: f.originalname, mime: f.mimetype, size: f.size, uploadedAt: new Date(), uploadedBy: req.user.name });
  }
  h.attachments.push(...added);
  h.lastActor = actorOf(req.user);
  await h.save();
  await logActivity(HO, h, { type: 'attachment', message: `Added ${added.length} attachment(s): ${added.map((a) => a.filename).join(', ')}`, by: actorOf(req.user) });
  res.json({ handover: h.toJSON() });
}));

// ---- Download an attachment ----
r.get('/:id/attachments/:fileId', ah(async (req, res) => {
  const h = await Handover.findById(req.params.id);
  if (!h) return res.status(404).json({ error: 'Handover not found' });
  if (!owns(h, req.user)) return res.status(403).json({ error: 'Not allowed' });
  const att = (h.attachments || []).find((a) => a.fileId === req.params.fileId);
  if (!att) return res.status(404).json({ error: 'Attachment not found' });
  res.set('Content-Type', att.mime || 'application/octet-stream');
  res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(att.filename)}"`);
  fileBucket().openDownloadStream(new mongoose.Types.ObjectId(att.fileId))
    .on('error', () => res.status(404).end())
    .pipe(res);
}));

// ---- Remove an attachment (while editable) ----
r.delete('/:id/attachments/:fileId', ah(async (req, res) => {
  const h = await Handover.findById(req.params.id);
  if (!h) return res.status(404).json({ error: 'Handover not found' });
  if (!owns(h, req.user)) return res.status(403).json({ error: 'Not allowed' });
  if (!EDITABLE.includes(h.status)) return res.status(400).json({ error: 'Attachments can only be changed while editable' });
  const att = (h.attachments || []).find((a) => a.fileId === req.params.fileId);
  if (!att) return res.status(404).json({ error: 'Attachment not found' });
  await fileBucket().delete(new mongoose.Types.ObjectId(att.fileId)).catch(() => {});
  h.attachments = h.attachments.filter((a) => a.fileId !== req.params.fileId);
  await h.save();
  res.json({ handover: h.toJSON() });
}));

export default r;
