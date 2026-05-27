import { Router, Request, Response } from 'express';
import { fundingPitchAgent } from '../../services/funding.agent';
import { preSeedFundingAgent } from '../../services/preseed-funding.agent';
import { logger } from '../../utils/logger';
import { db } from '../../database/db.client';
import { z } from 'zod';

const FundingBodySchema = z.object({
  investorProfile: z.enum(['angel', 'vc', 'bank', 'government']),
  companyDetails:  z.record(z.unknown()).optional(),
});

const PreSeedBodySchema = z.object({
  investorType: z.enum(['angel', 'vc', 'corporate_vc', 'impact_fund', 'all']).optional().default('all'),
  companyContext: z.string().optional(),
  singleFund: z.string().optional(),
});

const router = Router();

/**
 * POST /api/agents/funding
 * Body: { investorProfile: 'angel'|'vc'|'bank'|'government', companyDetails?: object }
 * Returns immediately (202) and processes in background.
 */
router.post('/funding', async (req: Request, res: Response) => {
  try {
    const parsed = FundingBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid request body' });
    }

    const { investorProfile, companyDetails = {} } = parsed.data;

    // Return immediately — process in background
    res.json({ success: true, status: 'queued', message: `Funding pitch generation started for ${investorProfile} investors.` });

    (async () => {
      try {
        const result = await fundingPitchAgent.run(investorProfile, companyDetails || {});
        logger.info('[funding] background complete', { investorProfile, prospectsCreated: result.prospectsCreated, durationMs: result.durationMs });
      } catch (err: any) {
        logger.error('[funding] background failed', { error: err.message });
      }
    })();
  } catch (error: any) {
    logger.warn('Funding agent failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message || 'Funding pitch generation failed' });
  }
});

/**
 * POST /api/agents/funding/preseed
 * Body: {
 *   investorType?: 'angel'|'vc'|'corporate_vc'|'impact_fund'|'all' (default 'all'),
 *   companyContext?: string (optional override for company description),
 *   singleFund?: string (fund name to target a single investor instead of batch)
 * }
 */
router.post('/funding/preseed', async (req: Request, res: Response) => {
  try {
    const parsed = PreSeedBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid request body' });
    }

    const { investorType, companyContext, singleFund } = parsed.data;

    if (singleFund) {
      const { EAST_AFRICA_INVESTORS } = await import('../../data/east-africa-investors');
      const investor = EAST_AFRICA_INVESTORS.find(i =>
        i.fundName.toLowerCase() === singleFund.toLowerCase(),
      );
      if (!investor) {
        return res.status(404).json({ success: false, error: `Investor not found: ${singleFund}` });
      }

      res.json({ success: true, status: 'running', message: `Generating pre-seed pitch for ${investor.fundName}…` });

      (async () => {
        try {
          const result = await preSeedFundingAgent.runSingle(investor, companyContext);
          logger.info('[funding/preseed-single] complete', { fund: investor.fundName, durationMs: result.durationMs });
        } catch (err: any) {
          logger.error('[funding/preseed-single] failed', { error: err.message });
        }
      })();
    } else {
      const typeLabel = investorType === 'all' ? 'all pre-seed targets' : investorType;
      res.json({ success: true, status: 'queued', message: `Pre-seed pitch generation started for ${typeLabel} investors.` });

      (async () => {
        try {
          const result = await preSeedFundingAgent.run(investorType || 'all', companyContext);
          logger.info('[funding/preseed] background complete', { investorType, prospectsCreated: result.prospectsCreated, errors: result.errors.length, durationMs: result.durationMs });
        } catch (err: any) {
          logger.error('[funding/preseed] background failed', { error: err.message });
        }
      })();
    }
  } catch (error: any) {
    logger.warn('Pre-seed funding agent failed', { error: error.message });
    res.status(500).json({ success: false, error: error.message || 'Pre-seed pitch generation failed' });
  }
});

/**
 * GET /api/agents/funding/preseed/targets
 * Returns the list of pre-seed investor targets (no sensitive data).
 */
router.get('/funding/preseed/targets', async (_req: Request, res: Response) => {
  const { EAST_AFRICA_INVESTORS } = await import('../../data/east-africa-investors');
  const targets = EAST_AFRICA_INVESTORS.map(i => ({
    fundName: i.fundName,
    tier: i.tier,
    type: i.type,
    ticketRangeUsd: i.ticketRangeUsd,
    geoFocus: i.geoFocus,
    contactStatus: i.contactStatus,
    decisionTimelineWeeks: i.decisionTimelineWeeks,
  }));
  res.json({ success: true, count: targets.length, targets });
});

/**
 * GET /api/agents/funding/preseed/scored
 * Returns all investors ranked by pre-seed fit score.
 * Query: ?type=vc|angel|corporate_vc|impact_fund&limit=10
 */
router.get('/funding/preseed/scored', async (req: Request, res: Response) => {
  try {
    const { getRankedInvestors } = await import('../../services/investor-scorer.service');
    const { EAST_AFRICA_INVESTORS } = await import('../../data/east-africa-investors');
    const type = req.query.type as string | undefined;
    const limit = parseInt(req.query.limit as string, 10) || 0;
    const investors = type && type !== 'all'
      ? EAST_AFRICA_INVESTORS.filter(i => i.type === type)
      : EAST_AFRICA_INVESTORS;
    let ranked = getRankedInvestors(investors);
    if (limit > 0) ranked = ranked.slice(0, limit);
    res.json({ success: true, count: ranked.length, investors: ranked });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/agents/funding/preseed/scored/top/:n
 * Returns top N pre-seed investor targets by fit score.
 */
router.get('/funding/preseed/scored/top/:n', async (req: Request, res: Response) => {
  try {
    const { getTopInvestors } = await import('../../services/investor-scorer.service');
    const n = Math.min(Math.max(parseInt(req.params.n, 10) || 5, 1), 50);
    const top = getTopInvestors(n);
    res.json({ success: true, count: top.length, investors: top });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/agents/funding/preseed/campaign
 * Returns pre-seed campaign summary: totals by rank, type, status.
 */
router.get('/funding/preseed/campaign', async (_req: Request, res: Response) => {
  try {
    const { getCampaignSummary } = await import('../../services/investor-scorer.service');
    const summary = getCampaignSummary();
    res.json({ success: true, summary });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/agents/funding/preseed/email-preview
 * Body: { fundName: string }
 * Generates and returns a preview of the outreach email for a specific investor.
 */
router.post('/funding/preseed/email-preview', async (req: Request, res: Response) => {
  try {
    const { fundName } = req.body;
    if (!fundName || typeof fundName !== 'string') {
      return res.status(400).json({ success: false, error: 'fundName is required' });
    }
    const { EAST_AFRICA_INVESTORS } = await import('../../data/east-africa-investors');
    const investor = EAST_AFRICA_INVESTORS.find(i =>
      i.fundName.toLowerCase() === fundName.toLowerCase(),
    );
    if (!investor) {
      return res.status(404).json({ success: false, error: `Investor not found: ${fundName}` });
    }
    const { outreachComposer } = await import('../../services/outreach-composer.service');
    const email = await outreachComposer.composeEmail(investor);
    if (!email) {
      return res.status(500).json({ success: false, error: 'Failed to compose email' });
    }
    res.json({ success: true, email });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/agents/funding/preseed/status
 * Returns current campaign status from DB (prospects created, emails generated, etc.).
 */
router.get('/funding/preseed/status', async (_req: Request, res: Response) => {
  try {
    const { rows } = await db.query(
      `SELECT
         COUNT(*)::int                                                                  AS total_prospects,
         COUNT(*) FILTER (WHERE status = 'proposed')::int                               AS proposed,
         COUNT(*) FILTER (WHERE status = 'contacted')::int                              AS contacted,
         COUNT(*) FILTER (WHERE status = 'interested')::int                             AS interested,
         COUNT(*) FILTER (WHERE status = 'declined')::int                               AS declined,
         COUNT(DISTINCT firm)::int                                                      AS unique_firms,
         MIN(created_at)::text                                                          AS first_prospect_at,
         MAX(created_at)::text                                                          AS last_prospect_at
       FROM investor_prospects
       WHERE investor_profile = 'angel'
         AND created_at >= NOW() - INTERVAL '30 days'`,
    );
    const { getCampaignSummary } = await import('../../services/investor-scorer.service');
    const summary = getCampaignSummary();
    res.json({ success: true, db: rows[0], pipeline: summary });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/agents/funding/preseed/pipeline/dashboard
 * Returns pipeline dashboard: prospects by stage, recent activity, etc.
 */
router.get('/funding/preseed/pipeline/dashboard', async (_req: Request, res: Response) => {
  try {
    const { investorPipeline } = await import('../../services/investor-pipeline.service');
    const dashboard = await investorPipeline.getDashboard();
    res.json({ success: true, dashboard });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/agents/funding/preseed/pipeline/prospects/:stage
 * Returns prospects filtered by pipeline stage.
 */
router.get('/funding/preseed/pipeline/prospects/:stage', async (req: Request, res: Response) => {
  try {
    const { investorPipeline } = await import('../../services/investor-pipeline.service');
    const stage = req.params.stage;
    const validStages = ['proposed', 'emailed', 'opened', 'replied', 'meeting_scheduled', 'meeting_done', 'term_sheet', 'closed_won', 'closed_lost'];
    if (!validStages.includes(stage)) {
      return res.status(400).json({ success: false, error: `Invalid stage. Must be one of: ${validStages.join(', ')}` });
    }
    const prospects = await investorPipeline.getProspectsByStage(stage as any);
    res.json({ success: true, count: prospects.length, prospects });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/agents/funding/preseed/pipeline/log/:prospectId
 * Returns activity log for a specific prospect.
 */
router.get('/funding/preseed/pipeline/log/:prospectId', async (req: Request, res: Response) => {
  try {
    const { investorPipeline } = await import('../../services/investor-pipeline.service');
    const log = await investorPipeline.getProspectLog(req.params.prospectId);
    res.json({ success: true, count: log.length, log });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PATCH /api/agents/funding/preseed/pipeline/prospect/:id
 * Body: { status?: string, notes?: string }
 * Updates prospect status and/or adds notes.
 */
router.patch('/funding/preseed/pipeline/prospect/:id', async (req: Request, res: Response) => {
  try {
    const { status, notes } = req.body;
    if (!status && !notes) {
      return res.status(400).json({ success: false, error: 'Provide status and/or notes' });
    }
    const { investorPipeline } = await import('../../services/investor-pipeline.service');
    if (status) {
      const ok = await investorPipeline.updateStatus(req.params.id, status, notes);
      if (!ok) return res.status(500).json({ success: false, error: 'Failed to update prospect' });
    } else if (notes) {
      const ok = await investorPipeline.addNote(req.params.id, notes);
      if (!ok) return res.status(500).json({ success: false, error: 'Failed to add note' });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/agents/funding/preseed/pipeline/note/:id
 * Body: { note: string }
 * Adds an internal note to a prospect without changing its status.
 */
router.post('/funding/preseed/pipeline/note/:id', async (req: Request, res: Response) => {
  try {
    const { note } = req.body;
    if (!note || typeof note !== 'string') {
      return res.status(400).json({ success: false, error: 'note is required' });
    }
    const { investorPipeline } = await import('../../services/investor-pipeline.service');
    const ok = await investorPipeline.addNote(req.params.id, note);
    if (!ok) return res.status(500).json({ success: false, error: 'Failed to add note' });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/agents/funding/preseed/outreach
 * Body: { targetCount?: number, dryRun?: boolean }
 * Triggers automated outreach to top N scored pre-seed targets.
 */
router.post('/funding/preseed/outreach', async (req: Request, res: Response) => {
  try {
    const { preSeedOutreachRunner } = await import('../../services/preseed-outreach-runner.service');
    const targetCount = Math.min(Math.max(req.body.targetCount || 5, 1), 20);
    const dryRun = req.body.dryRun !== false;

    res.json({ success: true, status: 'running', message: `Outreach started to ${targetCount} investor(s) (dryRun: ${dryRun})` });

    (async () => {
      try {
        const result = await preSeedOutreachRunner.run(targetCount, dryRun);
        logger.info('[funding/outreach] complete', { sent: result.sent, failed: result.failed, durationMs: result.durationMs });
      } catch (err: any) {
        logger.error('[funding/outreach] failed', { error: err.message });
      }
    })();
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/agents/funding/preseed/outreach/:fundName
 * Body: { dryRun?: boolean }
 * Triggers outreach to a single specific fund.
 */
router.post('/funding/preseed/outreach/:fundName', async (req: Request, res: Response) => {
  try {
    const { EAST_AFRICA_INVESTORS } = await import('../../data/east-africa-investors');
    const fundName = req.params.fundName;
    const investor = EAST_AFRICA_INVESTORS.find(i =>
      i.fundName.toLowerCase() === fundName.toLowerCase(),
    );
    if (!investor) {
      return res.status(404).json({ success: false, error: `Investor not found: ${fundName}` });
    }

    const { preSeedOutreachRunner } = await import('../../services/preseed-outreach-runner.service');
    const dryRun = req.body.dryRun !== false;

    res.json({ success: true, status: 'running', message: `Outreach started to ${investor.fundName} (dryRun: ${dryRun})` });

    (async () => {
      try {
        const result = await preSeedOutreachRunner.runSingleTarget(investor, dryRun);
        logger.info('[funding/outreach-single] complete', { fund: investor.fundName, sent: result.sent, durationMs: result.durationMs });
      } catch (err: any) {
        logger.error('[funding/outreach-single] failed', { error: err.message });
      }
    })();
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/agents/funding/preseed/deck
 * Body: { fundName?: string }
 * Generates a full 13-slide pitch deck for Sokogate's $500K pre-seed round.
 */
router.post('/funding/preseed/deck', async (req: Request, res: Response) => {
  try {
    const { pitchDeckGenerator } = await import('../../services/pitch-deck-generator.service');
    const fundName = req.body.fundName as string | undefined;
    const deck = await pitchDeckGenerator.generateDeck(fundName);
    res.json({ success: true, slides: deck.slides.length, deck });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/agents/funding/preseed/deck/slide/:num
 * Body: { fundName?: string }
 * Generates a single pitch deck slide by number (1-13).
 */
router.post('/funding/preseed/deck/slide/:num', async (req: Request, res: Response) => {
  try {
    const { pitchDeckGenerator } = await import('../../services/pitch-deck-generator.service');
    const slideNum = parseInt(req.params.num, 10);
    const fundName = req.body.fundName as string | undefined;
    const slide = await pitchDeckGenerator.generateSlide(slideNum, fundName);
    if (!slide) {
      return res.status(400).json({ success: false, error: `Invalid slide number. Must be 1-13.` });
    }
    res.json({ success: true, slide });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/agents/funding/preseed/memo
 * Body: { fundName: string, pitchSummary?: string }
 * Generates full 10-section investor memorandum for a specific fund.
 */
router.post('/funding/preseed/memo', async (req: Request, res: Response) => {
  try {
    const { fundName, pitchSummary } = req.body;
    if (!fundName || typeof fundName !== 'string') {
      return res.status(400).json({ success: false, error: 'fundName is required' });
    }
    const { EAST_AFRICA_INVESTORS } = await import('../../data/east-africa-investors');
    const investor = EAST_AFRICA_INVESTORS.find(i =>
      i.fundName.toLowerCase() === fundName.toLowerCase(),
    );
    if (!investor) {
      return res.status(404).json({ success: false, error: `Investor not found: ${fundName}` });
    }
    const { investorMemoGenerator } = await import('../../services/investor-memo-generator.service');
    const memo = await investorMemoGenerator.generateMemo(investor, pitchSummary);
    res.json({ success: true, sections: memo.sections.length, memo });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/agents/funding/preseed/memo/section
 * Body: { fundName: string, section: string, pitchSummary?: string }
 * Generates a single memo section for a specific fund.
 */
router.post('/funding/preseed/memo/section', async (req: Request, res: Response) => {
  try {
    const { fundName, section: sectionTitle, pitchSummary } = req.body;
    if (!fundName || !sectionTitle) {
      return res.status(400).json({ success: false, error: 'fundName and section are required' });
    }
    const { EAST_AFRICA_INVESTORS } = await import('../../data/east-africa-investors');
    const investor = EAST_AFRICA_INVESTORS.find(i =>
      i.fundName.toLowerCase() === fundName.toLowerCase(),
    );
    if (!investor) {
      return res.status(404).json({ success: false, error: `Investor not found: ${fundName}` });
    }
    const { investorMemoGenerator } = await import('../../services/investor-memo-generator.service');
    const section = await investorMemoGenerator.generateSection(investor, sectionTitle, pitchSummary);
    if (!section) {
      return res.status(400).json({ success: false, error: `Invalid section. Valid sections: Executive Summary, Company Overview, Market Analysis, Product & Technology, Traction & Financials, Competitive Landscape, Use of Funds, Risk Factors & Mitigation, Investment Highlights, Terms & Structure` });
    }
    res.json({ success: true, section });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/agents/funding/preseed/followups/due
 * Returns list of prospects where follow-up is due based on last contact.
 */
router.get('/funding/preseed/followups/due', async (_req: Request, res: Response) => {
  try {
    const { followUpScheduler } = await import('../../services/followup-scheduler.service');
    const due = await followUpScheduler.getFollowUpsDue();
    res.json({ success: true, count: due.length, followUps: due });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/agents/funding/preseed/followups/process
 * Processes all due follow-ups and logs interactions.
 */
router.post('/funding/preseed/followups/process', async (_req: Request, res: Response) => {
  try {
    const { followUpScheduler } = await import('../../services/followup-scheduler.service');
    res.json({ success: true, status: 'running', message: 'Processing due follow-ups…' });
    (async () => {
      try {
        const result = await followUpScheduler.processAllDueFollowUps();
        logger.info('[funding/followups] batch complete', result);
      } catch (err: any) {
        logger.error('[funding/followups] batch failed', { error: err.message });
      }
    })();
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/agents/funding/preseed/followups/sequence
 * Returns the configured follow-up sequence (days, labels).
 */
router.get('/funding/preseed/followups/sequence', async (_req: Request, res: Response) => {
  const { followUpScheduler } = await import('../../services/followup-scheduler.service');
  res.json({ success: true, sequence: followUpScheduler.getSequence() });
});

export default router;
