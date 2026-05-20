/**
 * langchain.service.test.ts
 *
 * Unit tests for LangChainService.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LangChainService, parseJsonFromLLM, EnrichmentSchema } from '../services/langchain.service';

describe('LangChainService', () => {
  let service: LangChainService;

  beforeEach(() => {
    // Clear singleton instance for each test
    (LangChainService as any).instance = undefined;
    service = LangChainService.getInstance();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getInstance', () => {
    it('returns the same instance', () => {
      const instance1 = LangChainService.getInstance();
      const instance2 = LangChainService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('getLLM', () => {
    it('returns a ChatOpenAI instance', () => {
      const llm = service.getLLM();
      expect(llm).toBeDefined();
    });

    it('returns different instances when maxTokens differs', () => {
      const llm1 = service.getLLM(0.3, 100);
      const llm2 = service.getLLM(0.3, 200);
      expect(llm1).not.toBe(llm2);
    });
  });

  describe('withRetry', () => {
    it('returns result on first success', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await service.withRetry(fn);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on failure then succeeds', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');
      const result = await service.withRetry(fn, { maxRetries: 2, baseDelay: 10 });
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('throws after max retries', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      await expect(service.withRetry(fn, { maxRetries: 2, baseDelay: 10 }))
        .rejects.toThrow('fail');
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });
});

describe('parseJsonFromLLM', () => {
  it('parses valid JSON', () => {
    const result = parseJsonFromLLM('{"enrichment_keywords":["test"],"enrichment_tagline":"tag","enrichment_selling_points":["point"]}', EnrichmentSchema);
    expect(result).not.toBeNull();
    expect(result?.enrichment_keywords).toContain('test');
  });

  it('parses JSON with markdown fences', () => {
    const result = parseJsonFromLLM('```json\n{"enrichment_keywords":["test"],"enrichment_tagline":"tag","enrichment_selling_points":["point"]}\n```', EnrichmentSchema);
    expect(result).not.toBeNull();
  });

  it('returns null on invalid JSON', () => {
    const result = parseJsonFromLLM('not json', EnrichmentSchema);
    expect(result).toBeNull();
  });

  it('returns null on schema validation failure', () => {
    const result = parseJsonFromLLM('{"wrong_field": true}', EnrichmentSchema);
    expect(result).toBeNull();
  });
});

// Made with Bob
