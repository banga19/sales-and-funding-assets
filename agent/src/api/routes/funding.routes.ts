// agent/src/api/routes/funding.routes.ts
import { Router } from 'express';
import { fundingPitchAgent } from '../../services/funding.agent';
import { logger } from '../../utils/logger';
import { db } from '../../database/db.client';

const router = Router();

/**
 * POST /api/agents/funding
 * Body: { investorProfile: 'angel'|'vc'|'bank'|'government', companyDetails?: object }
 * Returns { success, pitchSummary, prospectsCreated, prospects, investorProfile }
 */
router.post('/funding', async (req, res) => {
  try {
    const { investorProfile, companyDetails } = req.body ?? {};
    if (!investorProfile) {
      return res.status(400).json({ success: false, error: 'investorProfile required' });
    }

    const result = await fundingPitchAgent.run(investorProfile, companyDetails || {});

    // ── Fetch the latest investor_prospects rows so the UI can display them
    let prospects: any[] = [];
    try {
      const { rows } = await db.query(
        `SELECT id, investor_profile, status, pitch_summary, created_at
           FROM investor_prospects
          ORDER BY created_at DESC
          LIMIT 20`,
      );
      // Map to the shape the UI expects: contact.name, name, investorProfile, status
      prospects = rows.map((r: any) => ({
        id:                        r.id,
        contact:                   { name: r.name || 'Unnamed Contact' },
        name:                      r.name,
        investorProfile:           r.investor_profile,
        status:                    r.status || 'proposed',
      }));
    } catch (err: any) {
      logger.warn('[funding] could not fetch prospect rows', { error: err.message });
    }

    return res.json({
      success:         true,
      investorProfile,
      pitchSummary:    result.pitchSummary,
      prospectsCreated: result.prospectsCreated,
      prospects,
    });
  } catch (error: any) {
    logger.warn('Funding agent failed', { error: error.message });
    if (error?.message?.includes('getaddrinfo') || error?.message?.includes('ECONNREFUSED')) {
      return res.status(200).json({
        success:         true,
        investorProfile: 'vc',
        pitchSummary:    'LLM service temporarily unavailable — check NVIDIA proxy.',
        prospectsCreated: 0,
        prospects:       [],
        _unavailable:    true,
      });
    }
    return res.status(200).json({
      success:         true,
      investorProfile: 'vc',
      pitchSummary:    `Pitch generation error: ${error.message}`,
      prospectsCreated: 0,
      prospects:       [],
    });
  }
});

export default router;
