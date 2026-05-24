/**
 * unit/content.agent.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/database/db.client', () => ({
  db: { query: vi.fn() },
}));
vi.mock('../../src/config/agent.config', () => ({
  agentConfig: {
    ai: { model: 'test', apiKey: 'test', baseUrl: 'http://test', maxTokens: 512 },
    monitoring: { sentry: { environment: 'test' }, logLevel: 'warn' },
  },
}));
vi.mock('../../src/services/response-cache.service', () => ({
  getCached: vi.fn().mockResolvedValue(null),
  setCached: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/services/image-generation.service', () => ({
  imageGenerationService: {
    generateInfographic:  vi.fn().mockResolvedValue({ success: false }),
    generateProductImage: vi.fn().mockResolvedValue({ success: false }),
  },
}));
vi.mock('../../src/services/rag.service', () => ({
  ragService: {
    complete:  vi.fn().mockResolvedValue('## B2B Construction Sourcing in Kenya\n\nSokogate connects procurement managers with verified suppliers across East Africa. With over 10,000 customers and $600K+ ARR, the platform offers competitive pricing and reliable delivery.\n\n## Why Choose Sokogate\n\nFast delivery, verified suppliers, and competitive B2B pricing make Sokogate the top choice for construction procurement in Kenya and Nigeria.\n\n## Get Started\n\nVisit sokogate.com to browse our full catalogue and request a quote today.'),
    parseJson: vi.fn().mockReturnValue(null),
    withRetry: vi.fn().mockImplementation((fn: () => Promise<any>) => fn()),
  },
  RAGRetriever: {
    retrieve:     vi.fn(),
    buildContext: vi.fn().mockReturnValue('CATALOG PRODUCTS REFERENCE:\n- Cement (Materials): Portland cement 50kg'),
    fetchByIds:   vi.fn().mockResolvedValue([]),
    fetchByKeywords: vi.fn().mockResolvedValue([]),
    fetchTrending: vi.fn().mockResolvedValue([]),
  },
  ContentPieceSchema: {},
}));

import { ContentAgent, retrieveContext } from '../../src/services/content.agent';
import { db } from '../../src/database/db.client';
import { RAGRetriever } from '../../src/services/rag.service';

describe('retrieveContext()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns matching products by ID', async () => {
    vi.mocked(RAGRetriever.retrieve).mockResolvedValue([
      { id: 'p1', name: 'Cement', category: 'Materials', description: 'Portland', price: '1200' },
    ]);
    const ctx = await retrieveContext('blog', [], ['p1']);
    expect(ctx.matchingProducts.length).toBe(1);
    expect(ctx.matchingProducts[0].name).toBe('Cement');
  });

  it('falls back to keyword search when no IDs provided', async () => {
    vi.mocked(RAGRetriever.retrieve).mockResolvedValue([
      { id: 'p2', name: 'Steel Bar', category: 'Metals', description: 'Rebar', price: '800' },
    ]);
    const ctx = await retrieveContext('product_guide', ['steel', 'rebar'], []);
    expect(ctx.matchingProducts.length).toBe(1);
  });

  it('falls back to trending products when no matches', async () => {
    vi.mocked(RAGRetriever.retrieve).mockResolvedValue([
      { id: 'p3', name: 'Trending Product', category: 'General', description: 'Top seller', price: null },
    ]);
    const ctx = await retrieveContext('company_profile', [], []);
    expect(ctx.matchingProducts.length).toBe(1);
  });

  it('always includes companyFacts', async () => {
    vi.mocked(RAGRetriever.retrieve).mockResolvedValue([]);
    const ctx = await retrieveContext('blog', [], []);
    expect(ctx.companyFacts.name).toBe('Ultimo Trading Company Limited');
    expect(ctx.companyFacts.arrUsd).toBe('$600K+');
  });
});

describe('ContentAgent', () => {
  let agent: ContentAgent;

  beforeEach(() => {
    agent = new ContentAgent();
    vi.clearAllMocks();
    vi.mocked(RAGRetriever.retrieve).mockResolvedValue([]);
    vi.mocked(RAGRetriever.buildContext).mockReturnValue('No matching catalog entries found.');
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any);
  });
  afterEach(() => vi.restoreAllMocks());

  describe('run()', () => {
    it('returns title and body for blog type', async () => {
      const result = await agent.run({ type: 'blog', keywords: ['construction', 'Kenya'], productIds: [] });
      expect(result.title).toBeTruthy();
      expect(result.body.length).toBeGreaterThan(50);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }, 15000);

    it('returns cached result on second call', async () => {
      const { getCached } = await import('../../src/services/response-cache.service');
      vi.mocked(getCached).mockResolvedValueOnce({ title: 'Cached Title', body: 'Cached body content', imageUrls: [] } as any);
      const result = await agent.run({ type: 'blog', keywords: ['test'], productIds: [] });
      expect(result.title).toBe('Cached Title');
      expect(result.body).toBe('Cached body content');
    });

    it('persists content to content_pieces table', async () => {
      await agent.run({ type: 'company_profile', keywords: [], productIds: [] });
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO content_pieces'), expect.any(Array));
    }, 15000);

    it('includes imageUrls when generateImage=true and generation succeeds', async () => {
      const { imageGenerationService } = await import('../../src/services/image-generation.service');
      vi.mocked(imageGenerationService.generateInfographic).mockResolvedValue({ success: true, imageUrl: 'https://example.com/image.png' } as any);
      const result = await agent.run({ type: 'product_guide', keywords: ['cement'], productIds: [], generateImage: true, imageStyle: 'modern' });
      expect(result.imageUrls).toContain('https://example.com/image.png');
    }, 15000);
  });
});
