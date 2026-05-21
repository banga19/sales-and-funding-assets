// agent/src/api/routes/funding.routes.ts
import { Router, Request, Response } from 'express';
import { fundingPitchAgent } from '../../services/funding.agent';
import { logger } from '../../utils/logger';
import { db } from '../../database/db.client';

const router = Router();

/**
 * POST /api/agents/funding
 * Body: { investorProfile: 'angel'|'vc'|'bank'|'government', companyDetails?: object }
 * Returns immediately (202) and processes in background.
 */
router.post('/funding', async (req: Request, res: Response) => {
  try {
    const { investorProfile, companyDetails } = req.body ?? {};
    if (!investorProfile) {
      return res.status(400).json({ success: false, error: 'investorProfile required' });
    }

    const validProfiles = ['angel', 'vc', 'bank', 'government'];
    if (!validProfiles.includes(investorProfile)) {
      return res.status(400).json({ success: false, error: `Invalid investorProfile. Must be one of: ${validProfiles.join(', ')}` });
    }

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
