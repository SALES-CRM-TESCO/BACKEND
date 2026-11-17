import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import { config, ROOT } from './config.js';
import { connectDB, dbState } from './db.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import handoverRoutes from './routes/handovers.js';
import notificationRoutes from './routes/notifications.js';
import { todayStr } from './utils.js';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim()) }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.status(dbState() === 'connected' ? 200 : 503).json({ ok: dbState() === 'connected', db: dbState(), today: todayStr() }));
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/handovers', handoverRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Serve the built frontend (Frontend/dist) when present -> one server in production
const dist = path.resolve(ROOT, '../Frontend/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'A file is larger than 25 MB' });
  if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'Maximum 20 files per upload' });
  if (err.code === 11000) return res.status(400).json({ error: 'That value is already in use' });
  if (err.name === 'ValidationError' || err.name === 'CastError') return res.status(400).json({ error: 'Invalid data' });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

async function start() {
  try {
    const db = await connectDB();
    console.log(`MongoDB connected → database "${db.databaseName}" (sales users "${config.salesPrefix}", handovers "${config.handoverPrefix}")`);
  } catch (e) {
    console.error('\n[MongoDB] Could not connect:', e.message, '\nCheck MONGO_URI in Backend/.env and that this IP is allowed in Atlas → Network Access.\n');
    process.exit(1);
  }
  const server = app.listen(config.port, () => console.log(`Sales Portal API (MongoDB + JWT) running on http://localhost:${config.port}`));
  const stop = async () => { server.close(); await mongoose.connection.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
start();
