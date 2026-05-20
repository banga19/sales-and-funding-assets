/**
 * master-switch.routes.ts
 *
 * API routes for the Agent Master Switch panel.
 * Mounted at /api/agent/agents in agent/src/index.ts.
 *
 * Endpoints
 *   POST /api/agent/agents/run-all         — run all enabled, un-cooldown agents
 *   POST /api/agent/agents/run/:agentName  — run a single sub-agent by name
 *   GET  /api/agent/agents/status          — full status for the UI panel
 */

import { Router, Request, Response } from 'express';
import { masterSwitch, type SubAgentName } from '../../agents/master-switch';
import { agentConfig } from '../../config/agent.config';
import { logger } from '../../utils/logger';

const router = Router();

const VALID_AGENTS: SubAgentName[] = masterSwitch.getAgentNames();

// ── POST /api/agent/agents/run-all ─────────────────────────────────────────────
// Body (all optional):
//   { agentNames?: SubAgentName[] } — if provided, only run those agents
// Returns { results: Record<SubAgentName, SubAgentResult> }
router.post('/run-all', async (req: Request, res: Response) => {
  try {
    const requested = req.body?.agentNames as SubAgentName[] | undefined;

    let results: Record<string, any>;
    if (requested && requested.length > 0) {
      // Run individual agents in order (preserves cooldown gating)
      results = {};
      for (const name of requested) {
        if (!VALID_AGENTS.includes(name)) continue;
        results[name] = await masterSwitch.runAgent(name);
      }
    } else {
      // Run all agents whose feature flag is enabled and cooldown has expired
      const sequential = agentConfig.masterSwitch?.sequential !== false;
      if (sequential) {
        results = {};
        for (const name of VALID_AGENTS) {
          results[name] = await masterSwitch.runAgent(name);
        }
      } else {
        results = await masterSwitch.runAllEnabled();
      }
    }

    res.json({ success: true, results });
  } catch (err: any) {
    logger.error('[master-switch] run-all failed', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/agent/agents/run/:agentName ──────────────────────────────────────
// Trigger a single sub-agent.
// Body (none required); optional body: { dryRun?: boolean }
router.post('/run/:agentName', async (req: Request, res: Response) => {
  try {
    const { agentName } = req.params;
    if (!VALID_AGENTS.includes(agentName as SubAgentName)) {
      return res.status(400).json({ success: false, error: `Unknown agent name: "${agentName}". Valid: ${VALID_AGENTS.join(', ')}` });
    }

    const result = await masterSwitch.runAgent(agentName as SubAgentName);
    res.json(result);
  } catch (err: any) {
    logger.error('[master-switch] run single failed', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/agent/agents/status ───────────────────────────────────────────────
// Returns flat array of { name, enabled, cooldownSec, lastRunAt }.
// Used by the UI panel for the agent grid.
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const status = masterSwitch.getStatus();
    res.json({ success: true, agents: status });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
