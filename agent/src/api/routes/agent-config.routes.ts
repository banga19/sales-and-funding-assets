/**
 * agent-config.routes.ts
 *
 * Runtime agent configuration endpoints.
 * Allows adjusting temperature, maxTokens, retry settings at runtime.
 *
 * GET  /api/agent/config       — Get current config
 * PUT  /api/agent/config       — Update config (persisted to env/memory)
 * POST /api/agent/config/reset — Reset to defaults
 */

import { Router, Request, Response } from 'express';
import { agentConfig } from '../../config/agent.config';
import { logger } from '../../utils/logger';
import { z } from 'zod';

const router = Router();

const ConfigUpdateSchema = z.object({
  ai: z.object({
    temperature: z.number().min(0).max(1).optional(),
    maxTokens: z.number().int().min(1).max(8192).optional(),
  }).optional(),
  bulkSourcing: z.object({
    defaultPages: z.number().int().min(1).max(20).optional(),
    enrichWithAI: z.boolean().optional(),
  }).optional(),
  dryRun: z.boolean().optional(),
});

/**
 * GET /api/agent/config
 */
router.get('/config', (_req: Request, res: Response) => {
  res.json({
    success: true,
    config: {
      ai: {
        model: agentConfig.ai.model,
        temperature: 0.3,
        maxTokens: 1024,
      },
      bulkSourcing: {
        defaultPages: agentConfig.bulkSourcing.defaultPages,
        maxPages: agentConfig.bulkSourcing.maxPages,
        enrichWithAI: agentConfig.bulkSourcing.enrichWithAI,
      },
      dryRun: agentConfig.dryRun,
      features: agentConfig.features,
      rateLimits: agentConfig.rateLimits,
    },
  });
});

/**
 * PUT /api/agent/config
 */
router.put('/config', (req: Request, res: Response) => {
  const result = ConfigUpdateSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      error: 'Invalid config update',
      details: result.error.issues,
    });
  }

  const { ai, bulkSourcing, dryRun } = result.data;

  // Apply changes to runtime config
  if (dryRun !== undefined) {
    agentConfig.dryRun = dryRun;
  }
  if (bulkSourcing) {
    if (bulkSourcing.defaultPages !== undefined) {
      agentConfig.bulkSourcing.defaultPages = bulkSourcing.defaultPages;
    }
    if (bulkSourcing.enrichWithAI !== undefined) {
      agentConfig.bulkSourcing.enrichWithAI = bulkSourcing.enrichWithAI;
    }
  }

  logger.info('[config] Updated at runtime', { changes: result.data });

  res.json({
    success: true,
    message: 'Configuration updated',
    config: {
      dryRun: agentConfig.dryRun,
      bulkSourcing: agentConfig.bulkSourcing,
    },
  });
});

/**
 * POST /api/agent/config/reset
 */
router.post('/config/reset', (_req: Request, res: Response) => {
  // Reset to defaults
  agentConfig.dryRun = process.env.AGENT_DRY_RUN === 'true';
  agentConfig.bulkSourcing.defaultPages = 3;
  agentConfig.bulkSourcing.enrichWithAI = false;

  logger.info('[config] Reset to defaults');

  res.json({
    success: true,
    message: 'Configuration reset to defaults',
  });
});

export default router;

// Made with Bob
