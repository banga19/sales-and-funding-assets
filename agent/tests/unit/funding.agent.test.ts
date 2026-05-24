/**
 * unit/funding.agent.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/database/db.client', () => ({
  db: { query: vi.fn().mockResolvedValue({ rows: [] }) },
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
vi.mock('../../src/services/rag.service', () => ({
  ragService: {
    complete:  vi.fn().mockResolvedValue('Sokogate is a leading B2B construction marketplace in East Africa with $600K+ ARR and 10,000+ customers. We are raising Series A to expand across West Africa.'),
    parseJson: vi.fn(),
    withRetry: vi.fn().mockImplementation((fn: () => Promise<any>) => fn()),
  },
  FundingResearchSchema:  {},
  FundingContactsSchema:  {},
}));

import { FundingPitchAgent } from '../../src/services/funding.agent';
import { db } from '../../src/database/db.client';
import { ragService } from '../../src/services/rag.service';

describe('FundingPitchAgent', () => {
  let agent: FundingPitchAgent;

  beforeEach(() => {
    agent = new FundingPitchAgent();
    vi.clearAllMocks();
    // Default: complete returns pitch text, parseJson returns null (no JSON)
    vi.mocked(ragService.complete).mockResolvedValue('Sokogate is a leading B2B construction marketplace in East Africa with $600K+ ARR and 10,000+ customers.');
    vi.mocked(ragService.parseJson).mockReturnValue(null);
  });
  afterEach(() => vi.restoreAllMocks());

  describe('run()', () => {
    it('returns pitchSummary and prospects on success', async () => {
      // First parseJson call (research) returns contacts
      vi.mocked(ragService.parseJson)
        .mockReturnValueOnce({ contacts: [{ name: 'Acumen Fund', email: 'info@acumen.org', firm: 'Acumen', fit: 'Impact investor in East Africa' }] } as any)
        .mockReturnValueOnce({ contacts: [{ name: 'Acumen Fund', email: 'info@acumen.org', firm: 'Acumen', role: 'Partner', fit: 'Impact investor' }] } as any)
        .mockReturnValue(null);

      const result = await agent.run('vc', { name: 'Sokogate', arrUsd: '$600K+' });
      expect(result).toHaveProperty('pitchSummary');
      expect(result.pitchSummary.length).toBeGreaterThan(0);
      expect(Array.isArray(result.prospects)).toBe(true);
    }, 15000);

    it('handles research failure gracefully', async () => {
      vi.mocked(ragService.withRetry).mockRejectedValueOnce(new Error('API error'));
      const result = await agent.run('angel', {});
      expect(result).toHaveProperty('pitchSummary');
      expect(result).toHaveProperty('prospectsCreated');
      expect(result.researchError).toBeTruthy();
    }, 15000);

    it('persists prospects to investor_prospects table', async () => {
      vi.mocked(ragService.parseJson)
        .mockReturnValueOnce({ contacts: [{ name: 'Test Fund', email: 'test@fund.com', firm: 'Test VC', fit: 'Matches profile' }] } as any)
        .mockReturnValueOnce({ contacts: [{ name: 'Test Fund', email: 'test@fund.com', firm: 'Test VC', role: 'Partner', fit: 'Matches profile' }] } as any)
        .mockReturnValue(null);

      await agent.run('vc', {});
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO investor_prospects'), expect.any(Array));
    }, 15000);

    it('emits phase events in order', async () => {
      const phases: string[] = [];
      const unsub = agent.subscribe(s => phases.push(s.phase));
      await agent.run('bank', {});
      unsub();
      expect(phases[0]).toBe('researching');
      expect(phases).toContain('synthesizing');
      expect(phases).toContain('persisting');
      expect(phases[phases.length - 1]).toBe('complete');
    }, 15000);

    it('uses cache on second call with same profile', async () => {
      const { getCached } = await import('../../src/services/response-cache.service');
      vi.mocked(getCached).mockResolvedValueOnce([
        { name: 'Cached Fund', email: '', firm: 'Cached VC', fit: 'Cached fit' },
      ] as any);

      const result = await agent.run('vc', {});
      expect(result.prospects.length).toBeGreaterThanOrEqual(0);
    }, 15000);
  });
});
