// MongoDB (Mongoose) data layer for the Sales Portal.
// Uses the SAME database as the Execution Portal (named in MONGO_URI). Sales users live in
// "sp_" collections; handover records live in the shared "ho_" collections so both portals
// always see the same information.
import mongoose from 'mongoose';
import crypto from 'crypto';
import { config, ROLES } from './config.js';
import { handoverModels } from './handover-model.js';

const SP = config.salesPrefix;
export const newId = () => crypto.randomUUID();

const toJSON = {
  virtuals: false,
  versionKey: false,
  transform(doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.passwordHash;
    delete ret.tokenVersion;
    return ret;
  },
};
const opts = (collection) => ({ collection: SP + collection, timestamps: true, toJSON, toObject: toJSON });
const idField = { type: String, default: newId };

const userSchema = new mongoose.Schema({
  _id: idField,
  name: { type: String, required: true, trim: true },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  employeeId: { type: String, trim: true, uppercase: true },
  email: { type: String, trim: true, lowercase: true },
  phone: { type: String, trim: true },
  designation: { type: String, trim: true },
  role: { type: String, enum: Object.values(ROLES), required: true },
  active: { type: Boolean, default: true },
  passwordHash: { type: String, required: true },
  tokenVersion: { type: Number, default: 0 },
  mustChangePassword: { type: Boolean, default: false },
  passwordSetAt: Date,
  createdBy: String,
}, opts('users'));
userSchema.index({ employeeId: 1 }, { unique: true, partialFilterExpression: { employeeId: { $type: 'string', $gt: '' } } });

export const User = mongoose.model('SalesUser', userSchema);

// Shared handover models (ho_ collections)
export const HO = handoverModels(config.handoverPrefix);
export const { Handover, HandoverActivity, HandoverNotification, HandoverCounter } = HO;

let bucket;
// Handover attachments (PDF / Excel / Word / images) are stored in MongoDB GridFS so both
// portals can download them and they survive redeploys. Bucket: "<ho prefix>files".
export const fileBucket = () => bucket;

export async function connectDB() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongoUri, {
    dbName: config.mongoDbName,
    serverSelectionTimeoutMS: 15000,
    maxPoolSize: 20,
  });
  const db = mongoose.connection.db;
  bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: config.handoverPrefix + 'files' });
  await Promise.all([User, Handover, HandoverActivity, HandoverNotification].map((m) => m.syncIndexes()));
  return db;
}

export const dbState = () => ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] || 'unknown';
