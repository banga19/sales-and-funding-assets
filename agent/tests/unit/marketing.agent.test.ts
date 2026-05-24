/**
 * unit/marketing.agent.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/database/db.client', () => ({
  db: { query: vi.fn() },
}));
vi.mock('../../src/config/agent.config', () => ({
  agentConfig: {
    ai: { model: 'test', apiKey: 'test', baseUrl: 'http://test', maxTokens: 512 },
    salesMarketing: { maxProducts: 5, defaultTargetChannel: 'all' },
    monitoring: { sentry: { environment: 'test' }, logLevel: 'warn' },
  },
}));
vi.mock('../../src/services/response-cache.service', () => ({
  getCached: vi.fn().mockResolvedValue(null),
  setCached: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/services/rag.service', () => ({
  ragService: {
    complete:  vi.fn().mockResolvedValue('Great product email body here'),
    parseJson: vi.fn().mockReturnValue(null),
    withRetry: vi.fn().mockImplementation((fn: () => Promise<any>) => fn()),
  },
  RAGRetriever: {
    fetchByIds:   vi.fn(),
    fetchTrending: vi.fn(),
  },
  MarketingAssetSchema: {},
}));

import { MarketingAgent } from '../../src/services/marketing.agent';
import { db } from '../../src/database/db.client';
import { RAGRetriever } from '../../src/services/rag.service';

const MOCK_PRODUCTS = [
  { id: 'prod-1', name: 'Portland Cement', category: 'Materials', description: '50kg bag', price: '1200' },
  { id: 'prod-2', name: 'Steel Rebar', category: 'Metals', description: '12mm diameter', price: '800' },
];

describe('MarketingAgent', () => {
  let agent: MarketingAgent;

  beforeEach(() => {
    agent = new MarketingAgent();
    vi.clearAllMocks();
    // Default: fetchByIds returns empty, fetchTrending returns empty
    vi.mocked(RAGRetriever.fetchByIds).mockResolvedValue([]);
    vi.mocked(RAGRetriever.fetchTrending).mockResolvedValue([]);
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any);
  });
  afterEach(() => vi.restoreAllMocks());

  describe('run()', () => {
    it('returns zero assets when no products found', async () => {
      const result = await agent.run(['nonexistent-id'], 'all');
      expect(result.assetsCreated).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('generates assets for all channels when targetChannel=all', async () => {
      vi.mocked(RAGRetriever.fetchByIds).mockResolvedValue([MOCK_PRODUCTS[0]]);
      const result = await agent.run(['prod-1'], 'all');
      // 4 asset types × 1 product = 4 assets
      expect(result.assetsCreated).toBe(4);
      expect(result.productsProcessed).toBe(1);
    }, 15000);

    it('generates only email assets when targetChannel=email', async () => {
      vi.mocked(RAGRetriever.fetchByIds).mockResolvedValue([MOCK_PRODUCTS[0]]);
      const result = await agent.run(['prod-1'], 'email');
      expect(result.assetsCreated).toBe(1);
    }, 15000);

    it('throws on invalid targetChannel', async () => {
      await expect(agent.run(['prod-1'], 'invalid-channel')).rejects.toThrow(/Invalid targetChannel/);
    });

    it('emits progress events', async () => {
      vi.mocked(RAGRetriever.fetchByIds).mockResolvedValue([MOCK_PRODUCTS[0]]);
      const phases: string[] = [];
      const unsub = agent.subscribe(s => phases.push(s.phase));
      await agent.run(['prod-1'], 'email');
      unsub();
      expect(phases).toContain('fetching');
      expect(phases).toContain('generating');
      expect(phases).toContain('complete');
    }, 15000);

    it('continues processing remaining products when one fails', async () => {
      vi.mocked(RAGRetriever.fetchByIds).mockResolvedValue(MOCK_PRODUCTS);
      const result = await agent.run(['prod-1', 'prod-2'], 'email');
      expect(result.productsProcessed).toBe(2);
    }, 15000);
  });
});
