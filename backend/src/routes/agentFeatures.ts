import { Router, Request, Response } from 'express';
import { dbQuery } from '../database/db.js';
import { config } from '../config/agent.config.js';

const AGENT_FEATURES = [
  'autonomousAgents',
  'bulkSourcing',
  'marketing',
  'content',
  'fundingPitch',
] as const;
type AgentFeatureKey = typeof AGENT_FEATURES[number];

const router = Router();

// ── GET /agent/features ────────────────────────────────────────────────────────
router.get('/', async (_req: Request, res: Response) => {
  try {
    const { rows } = await dbQuery<{ key: string; value: boolean }>(
      'SELECT key, value FROM feature_flags',
    );

    const dbOverrides: Record<string, boolean> = {};
    for (const r of rows) { dbOverrides[r.key] = r.value; }

    const features: Record<AgentFeatureKey, boolean> = {} as Record<AgentFeatureKey, boolean>;
    for (const k of AGENT_FEATURES) {
      features[k] = k in dbOverrides ? dbOverrides[k] : (config.features as any)[k];
    }

    res.json({ success: true, features });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PUT /agent/features/:featureName ─────────────────────────────────────────
router.put('/:featureName', async (req: Request, res: Response) => {
  const { featureName } = req.params;
  const { enabled }  = req.body;

  if (!AGENT_FEATURES.includes(featureName as AgentFeatureKey)) {
    return res.status(404).json({ success: false, error: `Feature "${featureName}" not found` });
  }
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ success: false, error: '"enabled" must be boolean' });
  }

  try {
    await dbQuery(
      `INSERT INTO feature_flags (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [featureName, enabled],
    );

    // When the master is turned off, force all sub-features off too
    const fName = featureName as AgentFeatureKey;
    if (fName === 'autonomousAgents' && !enabled) {
      for (const sub of ['bulkSourcing', 'marketing', 'content', 'fundingPitch'] as AgentFeatureKey[]) {
        await dbQuery(
          `INSERT INTO feature_flags (key, value, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [sub, false],
        );
      }
    }

    res.json({ success: true, feature: featureName, enabled });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
