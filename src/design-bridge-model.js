// Sales ⇄ Design CRM bridge models. These register on the SHARED Design CRM collections
// (design_requests / design_files / design_notifications) in the same MongoDB database, so a
// request raised here appears in the Design CRM automatically, and the approval status +
// approved files the Design CRM writes back are read here. Lenient (strict:false) so the
// Design CRM's richer fields round-trip untouched. Keep aligned with the Procurement bridge.
import mongoose from 'mongoose';

let MODELS = null;

export function designModels() {
  if (MODELS) return MODELS;

  const Att = new mongoose.Schema({ name: String, size: String, type: String, fileId: String }, { _id: false });
  const Hist = new mongoose.Schema({ title: String, time: String, desc: String }, { _id: false });

  const requestSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },   // REQ-2026-001
    source: { type: String, default: 'sales' },
    status: { type: String, default: 'New' },
    projectName: { type: String, default: '' },
    customerName: { type: String, default: '' },
    projectType: { type: String, default: 'PEB' },
    service: { type: String, default: '' },
    requirement: { type: String, default: '' },
    description: { type: String, default: '' },
    priority: { type: String, default: 'Medium' },
    dueDate: { type: String, default: '' },
    location: { type: String, default: '' },
    assignedDesigner: { type: String, default: 'Unassigned' },
    requestFrom: { type: String, default: 'Sales Team' },
    requestedBy: { type: String, default: '' },
    requestedByUser: { type: String, default: '' },
    // Original project linkage (kept across portals).
    salesProjectId: { type: String, default: '' },
    handoverRef: { type: String, default: '' },
    attachments: { type: [Att], default: [] },
    history: { type: [Hist], default: [] },
    // Written back by the Design CRM.
    approvedDate: { type: String, default: '' },
    approvedBy: { type: String, default: '' },
    approvedFiles: { type: [Att], default: [] },
    rejectionReason: { type: String, default: '' },
    changeRemarks: { type: String, default: '' },
  }, { timestamps: true, strict: false, collection: 'design_requests' });

  const fileSchema = new mongoose.Schema({
    entity: { type: String, default: 'request' },
    entityId: String,
    name: { type: String, default: 'file' },
    type: { type: String, default: 'application/octet-stream' },
    size: { type: Number, default: 0 },
    uploadedBy: String,
    data: Buffer,
  }, { timestamps: true, collection: 'design_files' });

  const notifSchema = new mongoose.Schema({
    audience: { type: String, index: true },
    title: String, message: String, desc: String,
    category: String, type: String,
    read: { type: Boolean, default: false },
    time: String, designerName: String,
    requestId: String, projectName: String, projectCode: String,
  }, { timestamps: true, collection: 'design_notifications' });

  const DesignRequest = mongoose.models.SalesDesignRequest || mongoose.model('SalesDesignRequest', requestSchema);
  const DesignFile = mongoose.models.SalesDesignFile || mongoose.model('SalesDesignFile', fileSchema);
  const DesignNotif = mongoose.models.SalesDesignNotif || mongoose.model('SalesDesignNotif', notifSchema);

  MODELS = { DesignRequest, DesignFile, DesignNotif };
  return MODELS;
}

// Allocate the next REQ-<year>-### id by scanning the shared collection.
export async function nextDesignReqId(DesignRequest) {
  const year = new Date().getFullYear();
  const re = new RegExp('^REQ-' + year + '-(\\d+)$');
  const rows = await DesignRequest.find({ id: re }).select('id').lean();
  const max = rows.reduce((m, r) => { const n = parseInt(String(r.id).split('-').pop(), 10); return (Number.isFinite(n) && n > m) ? n : m; }, 0);
  return 'REQ-' + year + '-' + String(max + 1).padStart(3, '0');
}
