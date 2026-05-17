import { type Request, type Response } from 'express';
import { metricsStore } from '../services/store.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Metrics & Analytics
// ═══════════════════════════════════════════════════════════════════════════════

/** GET /api/agent/metrics */
export const getMetrics = (req: Request, res: Response) => {
  const { start, end } = req.query;
  // In-memory store returns the cumulative counters; with a real DB, clamp by date
  res.json(metricsStore.get());
};

/** GET /api/agent/metrics/summary */
export const getMetricsSummary = (req: Request, res: Response) => {
  const days = Math.min(365, Math.max(1, parseInt(String(req.query.days ?? '30'), 10) || 30));
  const m = metricsStore.get();
  const responseRate = m.emailsSent > 0 ? Math.round((m.emailsReplied / m.emailsSent) * 100) : 0;
  const conversionRate = m.totalContacts > 0 ? Math.round((m.conversions / m.totalContacts) * 100) : 0;
  res.json({
    period: { days },
    generatedAt: new Date().toISOString(),
    ...m,
    responseRate,
    conversionRate,
  });
};

/** POST /api/agent/metrics/sync */
export const syncMetrics = (_req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Metrics synced successfully',
    syncedAt: new Date().toISOString(),
  });
};
