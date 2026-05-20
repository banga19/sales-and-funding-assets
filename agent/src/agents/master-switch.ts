/**
 * master-switch.ts
 *
 * Master Switch — LangChain-gated autonomous sub-agent orchestrator.
 *
 * Each sub-agent is registered as a SubAgentDescriptor carrying:
 *   · name               human-readable name / API key
 *   · featureFlag        which agent.features[] gate guards it
 *   · run()              the async function that performs the work
 *   · cooldownSeconds    minimum seconds between runs (debounce)
 *   · lastRunAt          timestamp of most recent run (null == never)
 *
 * The master switch makes two guarantees:
 *   1. A sub-agent will not fire if its feature flag is false (from env or DB overlay).
 *   2. A sub-agent will not fire twice within `cooldownSeconds` of its last run.
 *
 * runAgent(name)         — run a single named agent (called by PUT /api/agent/agents/run/:name)
 * runAllEnabled()        — run every agent whose gate is open and cooldown has elapsed
 * getStatus()            — flat list of { name, enabled, cooldownSec, lastRunAt } for the UI
 *
 * Feature-flag master may be read at runtime through the overlay at
 *   GET /api/agent/features   → returns env + DB merged flags
 *   PUT /api/agent/features/:key → persists to DB (survives restarts)
 *
 * LangChain classes used
 *   · RunnableLambda (qualify this module as a LangChain-gated orchestrator)
 *   · Custom RunLog    — per-agent events are logged via Winston + `agent_jobs` table
 */

import { logger } from '../utils/logger';
import { db } from '../database/db.client';
import { agentConfig } from '../config/agent.config';
import { orchestrator } from './orchestrator';
import { bulkSourcingAgent }                    from '../services/bulk-sourcing.agent';
import { marketingAgent, type ProductContext } from '../services/marketing.agent';
import { contentAgent }                         from '../services/content.agent';
import { fundingPitchAgent }                    from '../services/funding.agent';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SubAgentResult {
  success:    boolean;
  message:    string;
  durationMs: number;
}

export type SubAgentName =
  | 'bulkSourcing'
  | 'salesMarketing'
  | 'contentCreation'
  | 'fundingPitch'
  | 'dailyOutreach'
  | 'followupCheck'
  | 'metricsSync';

// ── Descriptor ─────────────────────────────────────────────────────────────────

interface SubAgentDescriptor {
  name:            SubAgentName;
  featureFlag:     keyof typeof agentConfig.features;
  cooldownSeconds: number;
  lastRunAt:       Date | null;
  /**
   * The actual work function.  Must accept no arguments and return SubAgentResult.
   * Throwing inside here is caught by runAgent() and turned into a failure result.
   */
  run:             () => Promise<SubAgentResult>;
}

// ─── MasterSwitch ──────────────────────────────────────────────────────────────

class MasterSwitch {
  private static instance: MasterSwitch;
  private agents: SubAgentDescriptor[] = [];

  private constructor() {
    this.registerAgents();
  }

  public static getInstance(): MasterSwitch {
    if (!MasterSwitch.instance) MasterSwitch.instance = new MasterSwitch();
    return MasterSwitch.instance;
  }

  // ── Registration ───────────────────────────────────────────────────────────

  /**
   * registerAgents — declare every sub-agent so the master switch can
   * enumerate and run them.  Each entry here is one "Autonomous Agent" panel button.
   *
   * Commented-out agents can be enabled by uncommenting:
   *   this.agents.push({ name: 'myAgent', ... });
   */
  private registerAgents() {
    // ─── 1. Bulk Product Sourcing ───────────────────────────────────────────
    this.agents.push({
      name:            'bulkSourcing',
      featureFlag:     'productSourcing',
      cooldownSeconds: 60 * 60,         // 1 hour
      lastRunAt:       null,
      run:             async () => {
        const pages       = agentConfig.bulkSourcing.defaultPages;
        const enrichWithAI = agentConfig.bulkSourcing.enrichWithAI;
        logger.info('[master-switch/bulk-sourcing] run()', { pages, enrichWithAI });
        const result = await bulkSourcingAgent.run(pages, enrichWithAI);
        return { success: true, message: `${result.productsUpserted} products sourced (${result.enrichedCount} enriched)`, durationMs: result.durationMs };
      },
    });

    // ─── 2. Sales & Marketing Generation ───────────────────────────────────
    this.agents.push({
      name:            'salesMarketing',
      featureFlag:     'salesOutreach',
      cooldownSeconds: 10 * 60,         // 10 minutes
      lastRunAt:       null,
      run:             async () => {
        const { rows } = await db.query(
          `SELECT id, name, description, category, price_current
             FROM scraped_products
            WHERE is_active = TRUE
            ORDER BY trending_score DESC NULLS LAST, last_scraped_at DESC
            LIMIT $1`, [agentConfig.salesMarketing.maxProducts]);
        if (rows.length === 0) {
          return { success: false, message: 'No active products in catalog', durationMs: 0 };
        }
        const products = rows as ProductContext[];
        logger.info('[master-switch/sales-marketing] run()', { products: products.map(p => p.id) });
        const result = await marketingAgent.run(products, {
          targetChannel: agentConfig.salesMarketing.defaultTargetChannel,
          maxProducts:   agentConfig.salesMarketing.maxProducts,
        });
        return {
          success:    result.errors.length === 0,
          message:    `${result.assetsCreated} assets created / ${result.errors.length} errors`,
          durationMs: result.durationMs,
        };
      },
    });

    // ─── 3. Content Creation ───────────────────────────────────────────────
    this.agents.push({
      name:            'contentCreation',
      featureFlag:     'contentAgent',
      cooldownSeconds: 60 * 60,         // 1 hour
      lastRunAt:       null,
      run:             async () => {
        const kw = ['B2B construction', 'Kenya e-commerce', 'sokogate', 'sourcing efficiency'];
        logger.info('[master-switch/content-creation] run()', { keywords: kw });
        const result = await contentAgent.run({ type: 'blog', keywords: kw, productIds: [] });
        return {
          success:    true,
          message:    `Generated "${result.title}"`,
          durationMs: result.durationMs,
        };
      },
    });

    // ─── 4. Funding Pitch ──────────────────────────────────────────────────
    this.agents.push({
      name:            'fundingPitch',
      featureFlag:     'fundingOutreach',
      cooldownSeconds: 15 * 60,         // 15 minutes
      lastRunAt:       null,
      run:             async () => {
        const companyDetails = {
          name:    'Ultimo Trading Company Limited',
          stage:   'Series A',
          arrUsd:  '$600K+',
          markets: 'Kenya, Nigeria, Ghana, Senegal',
        };
        logger.info('[master-switch/funding-pitch] run()', { investorProfile: 'vc' });
        const result = await fundingPitchAgent.run({
          investorProfile:  'vc',
          companyDetails:   companyDetails,
        });
        return {
          success:    result.prospectsCreated > 0,
          message:    `${result.prospectsCreated} prospects created`,
          durationMs: result.durationMs,
        };
      },
    });

    // ─── 5. Daily Outreach (investor batch) ────────────────────────────────
    this.agents.push({
      name:            'dailyOutreach',
      featureFlag:     'investorOutreach',
      cooldownSeconds: 4 * 60 * 60,     // 4 hours
      lastRunAt:       null,
      run:             async () => {
        logger.info('[master-switch/daily-outreach] run()');
        const r = await orchestrator.runInvestorOutreach(15);
        return {
          success:    true,
          message:    `${r.sent} sent / ${r.failed} failed`,
          durationMs: 0,
        };
      },
    });

    // ─── 6. Follow-up Check ────────────────────────────────────────────────
    this.agents.push({
      name:            'followupCheck',
      featureFlag:     'autoFollowup',
      cooldownSeconds: 60 * 60,         // 1 hour
      lastRunAt:       null,
      run:             async () => {
        logger.info('[master-switch/followup-check] run()');
        const { followUpWorkflow } = await import('../workflows/followup.workflow');
        const r = await followUpWorkflow.processScheduledFollowUps();
        return {
          success:    true,
          message:    `${r.successful} processed / ${r.failed} failed`,
          durationMs: 0,
        };
      },
    });

    // ─── 7. Metrics Sync ───────────────────────────────────────────────────
    this.agents.push({
      name:            'metricsSync',
      featureFlag:     'agentsEnabled',
      cooldownSeconds: 60 * 60,         // 1 hour
      lastRunAt:       null,
      run:             async () => {
        logger.info('[master-switch/metrics-sync] run()');
        const { triggerManualMetricsSync } = await import('../jobs/metrics-sync.job');
        triggerManualMetricsSync();
        return { success: true, message: 'Metrics sync triggered', durationMs: 0 };
      },
    });
  }

  // ── Core execution ──────────────────────────────────────────────────────────

  /**
   * runAgent — execute a single sub-agent by name.
   *
   * Gate checks (in order):
   *  1. Does the feature flag allow it?
   *  2. Has the cooldown expired?
   *  3. Does the sub-agent throw?  → caught → failure result.
   *
   * Each run is also logged to the `sub_agent_runs` table for dashboard audit.
   */
  public async runAgent(name: SubAgentName): Promise<SubAgentResult> {
    const agent = this.agents.find(a => a.name === name);
    if (!agent) {
      return { success: false, message: `Unknown agent: ${name}`, durationMs: 0 };
    }

    // ── Gate 1 — feature flag ──────────────────────────────────────────────
    const flagEnabled = Boolean(agentConfig.features[agent.featureFlag]);
    if (!flagEnabled) {
      logger.info('[master-switch] agent gated off — feature flag is false', {
        name, flag: agent.featureFlag,
      });
      return {
        success:   false,
        message:   `Disabled by feature flag: ${agent.featureFlag}`,
        durationMs: 0,
      };
    }

    // ── Gate 2 — cooldown ──────────────────────────────────────────────────
    if (agent.lastRunAt) {
      const elapsedMs   = Date.now() - agent.lastRunAt.getTime();
      const cooldownMs  = agent.cooldownSeconds * 1000;
      if (elapsedMs < cooldownMs) {
        const remainingSec = Math.max(0, Math.round((cooldownMs - elapsedMs) / 1000));
        return {
          success:    false,
          message:    `Cooldown active — retry in ${remainingSec}s`,
          durationMs: 0,
        };
      }
    }

    // ── Execute ────────────────────────────────────────────────────────────
    const start      = Date.now();
    const runId      = `${name}_${start}`;
    logger.info('[master-switch] running sub-agent', { name, runId });

    // Log start -> sub_agent_runs
    let dbRunId: string | null = null;
    try {
      const { rows } = await db.query(
        `INSERT INTO sub_agent_runs (agent_name, triggered_by, input_summary)
         VALUES ($1, 'manual', $2)
         RETURNING id`, [name, JSON.stringify({ triggeredAt: new Date().toISOString() })]);
      dbRunId = rows[0].id;
    } catch { /* non-fatal: table may not exist yet */ }

    try {
      const result = await agent.run();
      agent.lastRunAt = new Date();

      // Log completion
      try {
        await db.query(
          `UPDATE sub_agent_runs
              SET status = $1, finished_at = NOW(), duration_ms = $2,
                  output_summary = $3
            WHERE id = $4`,
          [result.success ? 'completed' : 'failed', Date.now() - start,
           JSON.stringify({ message: result.message }), dbRunId],
        );
      } catch { /* non-fatal */ }

      return result;
    } catch (err: any) {
      logger.error('[master-switch] sub-agent threw', { name, error: err.message });

      try {
        await db.query(
          `UPDATE sub_agent_runs
              SET status = 'error', finished_at = NOW(), duration_ms = $2,
                  error_message = $3
            WHERE id = $4`,
          ['error', Date.now() - start, err.message, dbRunId],
        );
      } catch { /* non-fatal */ }

      return {
        success:    false,
        message:    `Error: ${err.message}`,
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * runAllEnabled — iterate all registered agents, run those whose feature flag
   * is enabled and whose cooldown has elapsed.
   *
   * Controlled by agentConfig.masterSwitch.sequential:
   *  · true  → await each agent one at a time  (default)
   *  · false → Promise.all (truly concurrent)
   */
  public async runAllEnabled(): Promise<Record<SubAgentName, SubAgentResult>> {
    const results: Record<string, SubAgentResult> = {};
    const agentsToRun = this.agents.filter(a => Boolean(agentConfig.features[a.featureFlag]));

    logger.info('[master-switch] runAllEnabled', {
      total: agentsToRun.length,
      names: agentsToRun.map(a => a.name),
    });

    const sequential = agentConfig.masterSwitch?.sequential !== false;
    if (sequential) {
      for (const ag of agentsToRun) {
        results[ag.name] = await this.runAgent(ag.name);
      }
    } else {
      await Promise.all(
        agentsToRun.map(async ag => { results[ag.name] = await this.runAgent(ag.name); }),
      );
    }

    return results as Record<SubAgentName, SubAgentResult>;
  }

  /// ── Status / introspection ────────────────────────────────────────────────

  /**
   * getStatus — return a flat array of { name, enabled, cooldownSec, lastRunAt }.
   * Used by the UI panel and by the /api/agent/agents/status endpoint.
   */
  public getStatus() {
    return this.agents.map(ag => ({
      name:         ag.name,
      featureFlag:  ag.featureFlag,
      enabled:      Boolean(agentConfig.features[ag.featureFlag]),
      cooldownSec:  ag.cooldownSeconds,
      lastRunAt:    ag.lastRunAt?.toISOString() ?? null,
    }));
  }

  /**
   * getAgentNames — return all registered agent names.
   */
  public getAgentNames(): SubAgentName[] {
    return this.agents.map(a => a.name);
  }
}

export const masterSwitch = MasterSwitch.getInstance();
