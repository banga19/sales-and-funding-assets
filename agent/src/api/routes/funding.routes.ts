import { Router, Request, Response } from 'express';
import { fundingPitchAgent } from '../../services/funding.agent';
import { logger } from '../../utils/logger';
import { db } from '../../database/db.client';
import { z } from 'zod';

const FundingBodySchema = z.object({
  investorProfile: z.enum(['angel', 'vc', 'bank', 'government']),
  companyDetails:  z.record(z.unknown()).optional(),
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

export default router;
