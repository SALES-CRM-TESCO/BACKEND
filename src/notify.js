import { HandoverNotification } from './db.js';

// Notify the Execution team (whole team) about a handover event.
export async function notifyExecution(handover, { type, title, message }) {
  await HandoverNotification.create({
    audience: 'execution', userId: null,
    handoverId: handover._id || handover.id, ref: handover.ref || null,
    type, title, message, link: '/handovers',
  });
}

// Notify one sales user (usually the handover's owner).
export async function notifySalesUser(userId, handover, { type, title, message }) {
  if (!userId) return;
  await HandoverNotification.create({
    audience: 'sales', userId,
    handoverId: handover._id || handover.id, ref: handover.ref || null,
    type, title, message, link: '/handovers',
  });
}
