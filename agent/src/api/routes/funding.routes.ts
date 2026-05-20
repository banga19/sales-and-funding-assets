/**
 * Funding Generation Agent — LangChain Research → Pitch Synthesis chain
 *
 * Researches potential investors (optional search tool),
 * generates a tailored pitch summary, and persists investor
 * prospect records in `investor_prospects`. No raw aiCompletion()
 * calls remain here.
 */

import { Router, Request, Response } from 'express';
import { fundingPitchAgent, type FundingPitchResult } from '../../services/funding.agent';
import { db } from '../../database/db.client';
import { logger } from '../../utils/logger';
import { agentConfig } from '../../config/agent.config';

const router = Router();

const VALID_PROFILES = new Set<string>(['angel', 'vc', 'bank', 'government']);

/**
 * POST /pitch
 * Body: { investorProfile: "angel"|"vc"|"bank"|"government", companyDetails?: object }
 */
router.post('/pitch', async (req: Request, res: Response) => {
  let investorProfile: 'angel' | 'vc' | 'bank' | 'government' = 'angel';
  let companyDetails: Record<string, any> = { name: 'Ultimo Trading Company Limited' };

  try {
    const rawProfile = req.body?.investorProfile;
    investorProfile = (rawProfile === 'angel' || rawProfile === 'vc' || rawProfile === 'bank' || rawProfile === 'government')
      ? rawProfile
      : 'angel';

    companyDetails = typeof req.body?.companyDetails === 'object' && req.body?.companyDetails !== null
      ? req.body.companyDetails
      : { name: 'Ultimo Trading Company Limited' };

    logger.info('Funding pitch generation triggered', { investorProfile });

    // ── Delegate to FundingPitchAgent ─────────────────────────────────────────
    // Step 1: Research (optional — if SEARCH_API_KEY is set)
    // Step 2: Synthesis — pitch summary + suggested contacts via ChatOpenAI
    // Step 3: Persist investor_prospects rows in DB
    const result: FundingPitchResult = await fundingPitchAgent.run({
      investorProfile,
      companyDetails,
    });

    // ── Fetch the persisted prospect rows ──────────────────────────────────────
    const { rows: prospectRows } = await db.query(
      'SELECT id, investor_profile, pitch_summary, status, created_at FROM investor_prospects ORDER BY created_at DESC LIMIT 20',
    );

    logger.info('Funding pitch complete', {
      profile: investorProfile,
      created: result.prospectsCreated,
      errors:  result.messages.length,
    });

    res.json({
      success:         true,
      investorProfile,
      pitchSummary:    result.pitchSummary,
      contactsLinked:  result.prospectsCreated,
      prospects:       prospectRows.slice(0, 5),
    });
  } catch (error: any) {
    logger.warn('Funding pitch agent failed', { error: error.message });
    if (error?.message?.includes('getaddrinfo') || error?.message?.includes('ECONNREFUSED')) {
      res.status(200).json({
        success:         true,
        investorProfile: investorProfile ?? 'angel',
        pitchSummary:    'LLM service temporarily unavailable — check NVIDIA proxy.',
        contactsLinked:  0,
        prospects:       [],
        _unavailable:    true,
      });
    } else {
      res.status(200).json({
        success:         true,
        investorProfile: investorProfile ?? 'angel',
        pitchSummary:    `Pitch generation error: ${error.message}`,
        contactsLinked:  0,
        prospects:       [],
      });
    }
  }
});

export default router;

// Made with Bob
