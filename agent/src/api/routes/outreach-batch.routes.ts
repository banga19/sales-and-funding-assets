/**
 * outreach-batch.routes.ts
 *
 * API routes for the batch automated email outreach workflow.
 *
 *  POST /api/agents/outreach-batch   — run a full batch send
 *  GET  /api/agents/email-logs       — retrieve persisted email log entries
 */

import { Router, Request, Response } from 'express';
import { db } from '../../database/db.client';
import { logger } from '../../utils/logger';
import { outreachBatchService, type OutreachResult } from '../../outreach/outreach-batch.service';

const router = Router();

// ── POST /api/agents/outreach-batch ────────────────────────────────────────────
// Body (all optional):
//   { dryRun?: boolean, contactType?: string, limit?: number }
// Runs the full batch pipeline for the given type filter and returns per-contact results.
router.post('/outreach-batch', async (req: Request, res: Response) => {
  try {
    const { dryRun = false, contactType = '', limit = 50 } = req.body ?? {};

    logger?.info('[outreach-batch.routes] batch triggered', { dryRun, contactType, limit });

    const results: OutreachResult[] = await outreachBatchService.runBatch({
      dryRun,
      contactType,
      limit,
    });

    const summary = {
      total:   results.length,
      sent:    results.filter((r) => r.status === 'sent').length,
      failed:  results.filter((r) => r.status === 'failed').length,
      dryRun:  results.filter((r) => r.status === 'dry-run').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
    };

    res.json({ success: true, summary, results });
  } catch (err: any) {
    logger.error('[outreach-batch.routes] unhandled error', { error: err.message });
    res.status(500).json({ success: false, error: err.message || 'Batch outreach failed' });
  }
});

// ── GET /api/agents/email-logs ─────────────────────────────────────────────────
// Query params (all optional):
//   contactId  — filter to a single contact UUID
//   status     — filter by status: sent | failed | dry-run
//   limit      — max rows to return (default 100, cap 500)
//   offset     — pagination offset (default 0)
router.get('/email-logs', async (req: Request, res: Response) => {
  try {
    const { contactId, status, limit = '100', offset = '0' } = req.query as Record<string, string>;

    const clauses: string[] = [];
    const params: any[]      = [];

    if (contactId) {
      clauses.push('contact_id = $' + (params.length + 1));
      params.push(contactId);
    }
    if (status) {
      clauses.push('status = $' + (params.length + 1));
      params.push(status);
    }

    const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const lmt   = Math.min(500, Math.max(1, parseInt(limit, 10)  || 100));
    const off   = Math.max(0, parseInt(offset, 10) || 0);

    const countSql = `SELECT COUNT(*) AS cnt FROM email_logs ${whereClause}`;
    const { rows: cntRows } = await db.query<{ cnt: string }>(countSql, params);
    const total = parseInt(cntRows[0]?.cnt || '0', 10);

    const { rows } = await db.query(
      `SELECT * FROM email_logs ${whereClause} ORDER BY sent_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, lmt, off],
    );

    res.json({
      success: true,
      total,
      limit:   lmt,
      offset:  off,
      data:    rows,
    });
  } catch (err: any) {
    logger?.error?.('[outreach-batch.routes] email-logs query failed', { error: err.message });
    res.status(500).json({ success: false, error: 'Failed to fetch email logs' });
  }
});

// ── GET /api/agents/email-logs/summary ─────────────────────────────────────────
// Returns summary counts grouped by contact_type and status.
router.get('/email-logs/summary', async (_req: Request, res: Response) => {
  try {
    const { rows } = await db.query(`
      SELECT
        contact_type,
        status,
        COUNT(*)   AS cnt,
        MIN(sent_at) AS first_sent,
        MAX(sent_at) AS last_sent
      FROM email_logs
      GROUP BY contact_type, status
      ORDER BY contact_type, status
    `);

    const overall = await db.query(`SELECT COUNT(*) AS total, COUNT(DISTINCT contact_id) AS unique_contacts FROM email_logs`);

    res.json({
      success:     true,
      byTypeStatus: rows,
      total:       parseInt(overall.rows[0]?.total || '0', 10),
      uniqueContacts: parseInt(overall.rows[0]?.unique_contacts || '0', 10),
    });
  } catch (err: any) {
    logger?.error?.('[outreach-batch.routes] summary query failed', { error: err.message });
    res.status(500).json({ success: false, error: 'Failed to fetch log summary' });
  }
});

export default router;
