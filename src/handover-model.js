// Shared handover data model used by BOTH the Sales Portal and the Execution Portal.
// Both backends connect to the SAME MongoDB database and register these exact models on
// the shared "ho_" collections, so a handover created in Sales is the same record the
// Execution team reviews. Keep this file identical in both portals.
import mongoose from 'mongoose';
import crypto from 'crypto';

export const newId = () => crypto.randomUUID();

export const HANDOVER_STATUSES = ['Draft', 'Submitted', 'Under Review', 'Changes Requested', 'Accepted', 'Rejected'];

const toJSON = {
  virtuals: false,
  versionKey: false,
  transform(doc, ret) { ret.id = ret._id; delete ret._id; return ret; },
};
const idField = { type: String, default: newId };

const actorSchema = new mongoose.Schema({
  id: String, name: String, role: String, portal: String, // portal: 'sales' | 'execution'
}, { _id: false });

const attachmentSchema = new mongoose.Schema({
  fileId: String, filename: String, mime: String, size: Number,
  uploadedAt: { type: Date, default: Date.now }, uploadedBy: String,
}, { _id: false });

// A payment-term milestone row (Section 4).
const milestoneSchema = new mongoose.Schema({
  term: String, percentage: { type: Number, default: 0 }, value: { type: Number, default: 0 },
}, { _id: false });

let MODELS = null;

export function handoverModels(prefix = 'ho_') {
  if (MODELS) return MODELS;

  const handoverSchema = new mongoose.Schema({
    _id: idField,
    ref: { type: String, default: null },
    status: { type: String, enum: HANDOVER_STATUSES, default: 'Draft', index: true },

    // Quick-reference summary fields (used by lists & dashboards)
    clientName: String,
    projectName: String,
    projectValue: { type: Number, default: 0 },

    // Section 1 — Client & Project Details
    details: {
      leadId: String,
      clientName: String,
      projectLocation: String,
      contactDetails: String,
      billingName: String,
      mobileNumber: String,
      alternateMobile: String,
      siteAddress: String,
      billingAddress: String,
      gstNumber: String,
      emailWhatsapp: String,
      salespersonName: String,
      dateOfOrder: String,       // YYYY-MM-DD
      proposalRefNo: String,
    },
    // Section 2 — Scope of Work
    scope: {
      typeOfProject: String,
      projectSizeArea: String,
      design3D: { type: Boolean, default: false },
      design2D: { type: Boolean, default: false },
      transportationClientScope: { type: String, default: 'Yes' }, // 'Yes' | 'No'
      scaffoldingClientScope: { type: String, default: 'Yes' },
    },
    // Section 3 — Timeline & Delivery Commitment
    timeline: {
      tentativeStartDate: String,
      tentativeCompletionDate: String,
      leadTimePromised: String,  // auto-calculated (e.g. "45 days")
    },
    // Section 4 — Pricing & Payment Terms
    pricing: {
      quotedPrice: { type: Number, default: 0 },
      milestones: [milestoneSchema],
    },
    // Section 5 — Site Engineer Visit
    siteVisitCompleted: { type: Boolean, default: false },
    // Section 6 — Salesperson Declaration
    declarationAccepted: { type: Boolean, default: false },

    attachments: [attachmentSchema],

    createdBy: actorSchema,
    reviewedBy: actorSchema,
    submittedAt: Date,
    reviewedAt: Date,
    lastActor: actorSchema,
  }, { collection: prefix + 'handovers', timestamps: true, toJSON, toObject: toJSON });
  handoverSchema.index({ 'createdBy.id': 1, createdAt: -1 });
  handoverSchema.index({ ref: 1 }, { unique: true, partialFilterExpression: { ref: { $type: 'string' } } });

  const activitySchema = new mongoose.Schema({
    _id: idField,
    handoverId: { type: String, index: true },
    ref: String,
    type: String,
    message: String,
    fromStatus: String,
    toStatus: String,
    by: actorSchema,
  }, { collection: prefix + 'activity', timestamps: true, toJSON, toObject: toJSON });
  activitySchema.index({ handoverId: 1, createdAt: 1 });

  const notificationSchema = new mongoose.Schema({
    _id: idField,
    audience: { type: String, index: true },
    userId: { type: String, default: null, index: true },
    handoverId: String,
    ref: String,
    type: String,
    title: String,
    message: String,
    link: String,
    read: { type: Boolean, default: false },
  }, { collection: prefix + 'notifications', timestamps: true, toJSON, toObject: toJSON });
  notificationSchema.index({ audience: 1, createdAt: -1 });

  const counterSchema = new mongoose.Schema({
    _id: String,
    seq: { type: Number, default: 0 },
  }, { collection: prefix + 'counters' });

  const Handover = mongoose.models.Handover || mongoose.model('Handover', handoverSchema);
  const HandoverActivity = mongoose.models.HandoverActivity || mongoose.model('HandoverActivity', activitySchema);
  const HandoverNotification = mongoose.models.HandoverNotification || mongoose.model('HandoverNotification', notificationSchema);
  const HandoverCounter = mongoose.models.HandoverCounter || mongoose.model('HandoverCounter', counterSchema);

  MODELS = { Handover, HandoverActivity, HandoverNotification, HandoverCounter, prefix };
  return MODELS;
}

export async function nextHandoverRef(models, tz = 'Asia/Kolkata') {
  const year = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric' }).format(new Date());
  const key = `HO-${year}`;
  const doc = await models.HandoverCounter.findByIdAndUpdate(key, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return `${key}-${String(doc.seq).padStart(3, '0')}`;
}

export async function logActivity(models, handover, { type, message = '', fromStatus, toStatus, by }) {
  await models.HandoverActivity.create({
    handoverId: handover._id || handover.id, ref: handover.ref || null,
    type, message, fromStatus, toStatus, by,
  });
}
