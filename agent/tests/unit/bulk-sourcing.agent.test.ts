/**
 * unit/bulk-sourcing.agent.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/database/db.client', () => ({
  db: { query: vi.fn() },
}));
vi.mock('../../src/config/agent.config', () => ({
  agentConfig: {
    ai: { model: 'test', apiKey: 'test', baseUrl: 'http://test', maxTokens: 512 },
    queue: { concurrency: 2 },
    monitoring: { sentry: { environment: 'test' }, logLevel: 'warn' },
  },
}));
vi.mock('../../src/services/product-source.service', () => ({
  sourceProductData: vi.fn(),
}));
vi.mock('../../src/services/response-cache.service', () => ({
  getCached: vi.fn().mockResolvedValue(null),
  setCached: vi.fn().mockResolvedValue(undefined),
}));
// Mock ragService — the agent uses ragService.complete + ragService.parseJson
vi.mock('../../src/services/rag.service', () => ({
  ragService: {
    complete:   vi.fn().mockResolvedValue('{"enrichment_keywords":["cement"],"enrichment_tagline":"High-quality cement for B2B buyers in East Africa","enrichment_selling_points":["Durable","Cost-effective","Fast delivery"]}'),
    parseJson:  vi.fn(),
    withRetry:  vi.fn().mockImplementation((fn: () => Promise<any>) => fn()),
  },
  EnrichmentSchema: {},
}));

import { BulkSourcingAgent } from '../../src/services/bulk-sourcing.agent';
import { sourceProductData } from '../../src/services/product-source.service';
import { db } from '../../src/database/db.client';
import { ragService } from '../../src/services/rag.service';

describe('BulkSourcingAgent', () => {
  let agent: BulkSourcingAgent;

  beforeEach(() => {
    agent = new BulkSourcingAgent();
    vi.clearAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());

  describe('run()', () => {
    it('returns zero counts when scraper finds nothing', async () => {
      vi.mocked(sourceProductData).mockResolvedValue({ productsFound: 0, productsUpserted: 0, runId: 'r1', durationMs: 100 } as any);
      const result = await agent.run(1, false);
      expect(result.productsFound).toBe(0);
      expect(result.productsUpserted).toBe(0);
      expect(result.enrichedCount).toBe(0);
    });

    it('returns upserted count without enrichment', async () => {
      vi.mocked(sourceProductData).mockResolvedValue({ productsFound: 5, productsUpserted: 5, runId: 'r2', durationMs: 200 } as any);
      const result = await agent.run(2, false);
      expect(result.productsUpserted).toBe(5);
      expect(result.enrichedCount).toBe(0);
    });

    it('enriches products when enrichWithAI=true', async () => {
      vi.mocked(sourceProductData).mockResolvedValue({ productsFound: 2, productsUpserted: 2, runId: 'r3', durationMs: 300 } as any);
      vi.mocked(db.query).mockResolvedValue({
        rows: [
          { id: 'p1', name: 'Cement', category: 'Materials', description: 'Portland cement' },
          { id: 'p2', name: 'Steel Bar', category: 'Metals', description: 'Rebar' },
        ],
      } as any);
      vi.mocked(ragService.parseJson).mockReturnValue({
        enrichment_keywords: ['cement', 'construction'],
        enrichment_tagline: 'High-quality cement for B2B buyers',
        enrichment_selling_points: ['Durable', 'Cost-effective'],
      } as any);

      const result = await agent.run(1, true);
      expect(result.enrichedCount).toBeGreaterThan(0);
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE scraped_products'), expect.any(Array));
    }, 15000);

    it('emits progress events during run', async () => {
      vi.mocked(sourceProductData).mockResolvedValue({ productsFound: 3, productsUpserted: 3, runId: 'r4', durationMs: 150 } as any);
      const events: string[] = [];
      const unsub = agent.subscribe(s => events.push(s.phase));
      await agent.run(1, false);
      unsub();
      expect(events).toContain('scraping');
      expect(events).toContain('complete');
    });

    it('includes durationMs in result', async () => {
      vi.mocked(sourceProductData).mockResolvedValue({ productsFound: 1, productsUpserted: 1, runId: 'r5', durationMs: 50 } as any);
      const result = await agent.run(1, false);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
