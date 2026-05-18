import type { Request, Response } from 'express';
import { Router } from 'express';

import { sendOutreach } from '../services/outreach.service.js';
import { emailLogsStore } from '../services/store.js';
import { logger }      from '../utils/logger.js';

const router = Router();

// ── GET /api/outreach/logs ──────────────────────────────────────────────────
// Returns in-memory email send log (append-only).
router.get('/logs', (_req: Request, res: Response) => {
  res.json(emailLogsStore.list());
});

// ── POST /api/outreach/send ──────────────────────────────────────────────────
// Body: { contactId: string, dryRun? }
router.post('/send', async (req: Request, res: Response) => {
  try {
    const { contactId, dryRun = false } = req.body ?? {};

    if (!contactId || typeof contactId !== 'string') {
      return res.status(400).json({ error: 'contactId (string) is required in request body.' });
    }

    const result = await sendOutreach(contactId, { dryRun });

    if (result.success) {
      return res.status(200).json(result);
    }
    return res.status(500).json(result);
  } catch (err: any) {
    logger.error('[outreach:send] unhandled error', { error: err.message });
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

export default router;
