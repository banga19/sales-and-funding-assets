/**
 * batch-send.routes.ts
 *
 * API routes for the "Quick Send" batch email workflow.
 *
 * Endpoints
 *   GET  /api/agents/batch-send/preview               — parse & preview only (no sends)
 *   POST /api/agents/batch-send                       — parse → filter → send → result
 *
 * Body for POST
 *   { batchFile: "INVESTOR-OUTREACH-BATCH.md", dryRun?: boolean, overrideNhod?: boolean }
 *
 * Both endpoints read the batch markdown file from the project root and
 * cross-reference the relevant tracker CSV (TRACKER-INVESTORS.csv /
 * TRACKER-PARTNERSHIPS.csv) to compute per-contact sendability decisions.
 *
 * The actual send bypasses the contacts table and goes direct-to-Rsend via
 * batchSendOrchestrator.sendBatch() — all DB lifecycle writes (conversations,
 * message_history, email_logs, scheduled_actions) are handled separately by
 * the orchestrator for Contacts-table sends; marks are handled in-batch for
 * batch-file sends by those same auxiliaries in the orchestrator.
 */

import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { sendBatch, getBatchPreview } from '../../services/batch-send-orchestrator';
import type { BatchSendPreview, BatchSendResult } from '../../types/batch-send.types';

const router = Router();

// ── GET /api/agents/batch-send/preview ─────────────────────────────────────────
// Returns the parsed send-ability breakdown without sending any emails.
// Call from the frontend immediately after opening the batch UI so the user
// sees send / quarantine / blocked / no-email counts before clicking "Send All".
router.get('/batch-send/preview', async (_req: Request, res: Response) => {
  try {
    const batchFile  = _req.query.batchFile as string;
    const override   = _req.query.overrideNhod === 'true';

    if (!batchFile) {
      return res.status(400).json({ success: false, error: 'Query param "batchFile" is required' });
    }

    logger.info('[batch-send] preview requested', { batchFile, overrideNhod: override });

    const preview: BatchSendPreview = await getBatchPreview(batchFile, override);

    res.json({
      success:       true,
      batchFile,
      category:      preview.category,
      categoryLabel: preview.categoryLabel,
      totalEntries:  preview.totalEntries,
      sendable:      preview.sendable,
      quarantined:   preview.quarantined,
      blocked:       preview.blocked,
      noEmail:       preview.noEmail,
      entries:       preview.entries.map((e) => ({
        index:      e.index,
        companyName: e.companyName,
        toEmail:    e.toEmail,
        subject:    e.subject,
        tier:       e.tier,
        ticket:     e.ticket,
        timeline:   e.timeline,
        thesis:     e.thesis,
        decision:   e.decision,
        csvNotes:   e.csvNotes,
        sendNotes:  e.sendNotes,
        rawHints:   e.rawHints,
      })),
      // Presence of nhod blocks auto-right-cursoring send on "Send All" click
      canSendAll:   preview.blocked === 0 && override,
    });
  } catch (err: any) {
    const msg = err.message || 'Failed to build preview';
    logger.error('[batch-send] preview error', { error: msg });
    res.status(500).json({ success: false, error: msg });
  }
});

// ── POST /api/agents/batch-send ─────────────────────────────────────────────────
// Sends all sendable emails from the batch file.
//
// Body
//   batchFile     "INVESTOR-OUTREACH-BATCH.md" | "PARTNERSHIP-OUTREACH-BATCH.md"
//   dryRun        (default false) — compose + log only, no actual send
//   overrideNhod  (default false) — clear nhod blocks and force-send
//
// Response
//   { success: bool, dryRun: bool, totalEntries, sent, failed, skipped, results }
//
// Frontend sends this request when the user clicks "Send All" after verifying
// the preview counts match expectations.
router.post('/batch-send', async (req: Request, res: Response) => {
  try {
    const { batchFile, dryRun = false, overrideNhod = false } = req.body ?? {};

    if (!batchFile) {
      return res.status(400).json({ success: false, error: 'Field "batchFile" (string) is required in request body.' });
    }

    logger.info('[batch-send] send triggered', { batchFile, dryRun, overrideNhod });

    const { preview, result } = await sendBatch({
      batchFile,
      dryRun,
      overrideNhod,
    });

    res.json({
      success:        result.success,
      batchFile,
      category:       result.category,
      dryRun:         result.dryRun,
      totalEntries:   result.totalEntries,
      sent:           result.sent,
      failed:         result.failed,
      skipped:        result.skipped,
      sendableBatch:  preview.sendable,
      quarantined:    preview.quarantined,
      blocked:        preview.blocked,
      results:        result.results,
    });
  } catch (err: any) {
    const msg = err.message || 'Failed to run batch send';
    logger.error('[batch-send] send error', { error: msg });
    res.status(500).json({ success: false, error: msg });
  }
});

// ── GET /api/agents/batch-send/trackers ─────────────────────────────────────────
// Returns the list of available batch files and their categories.
// Useful for building a batch-selector in the UI.
router.get('/batch-send/trackers', (_req: Request, res: Response) => {
  const trackers = [
    { filename: 'INVESTOR-OUTREACH-BATCH.md',    category: 'investor', label: 'Investor Batch — Week 1 Cold Emails' },
    { filename: 'PARTNERSHIP-OUTREACH-BATCH.md', category: 'partner',  label: 'Partnership Batch — Week 1 Intro Emails' },
  ];
  res.json({ success: true, trackers });
});

export default router;
