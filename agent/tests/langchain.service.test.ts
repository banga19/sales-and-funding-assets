/**
 * langchain.service.test.ts
 *
 * Unit tests for LangChainService.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LangChainService, parseJsonFromLLM, EnrichmentSchema } from '../src/services/langchain.service';

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
      // withRetry(fn, maxRetries, baseDelay) — positional args
      const result = await service.withRetry(fn, 3, 10);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on transient failure then succeeds', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error('fail'), { status: 429 }))
        .mockResolvedValue('success');
      const result = await service.withRetry(fn, 2, 10);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('throws after max retries', async () => {
      const fn = vi.fn().mockRejectedValue(Object.assign(new Error('fail'), { status: 503 }));
      await expect(service.withRetry(fn, 2, 10)).rejects.toThrow('fail');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('does not retry on non-retryable 400 error', async () => {
      const fn = vi.fn().mockRejectedValue(Object.assign(new Error('bad request'), { status: 400 }));
      await expect(service.withRetry(fn, 3, 10)).rejects.toThrow('bad request');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('getHealthyLLM', () => {
    it('returns fallback=false when health check is fresh', async () => {
      // Simulate a recent successful health check
      (service as any).lastHealthCheck = true;
      (service as any).lastHealthCheckTime = Date.now();
      const { llm, fallback } = await service.getHealthyLLM();
      expect(llm).toBeDefined();
      expect(fallback).toBe(false);
    });

    it('returns fallback=true when last check failed recently', async () => {
      (service as any).lastHealthCheck = false;
      (service as any).lastHealthCheckTime = Date.now();
      (service as any).lastHealthCheckFailureTime = Date.now();
      const { llm, fallback } = await service.getHealthyLLM();
      expect(llm).toBeDefined();
      // fallback=true but llm is still a real ChatOpenAI (no stub crash)
      expect(fallback).toBe(true);
    });
  });
});

describe('parseJsonFromLLM', () => {
  it('parses valid JSON', () => {
    const result = parseJsonFromLLM(
      '{"enrichment_keywords":["test"],"enrichment_tagline":"A 30-word tagline for the product value proposition here","enrichment_selling_points":["point"]}',
      EnrichmentSchema,
    );
    expect(result).not.toBeNull();
    expect(result?.enrichment_keywords).toContain('test');
  });

  it('parses JSON with markdown fences', () => {
    const result = parseJsonFromLLM(
      '```json\n{"enrichment_keywords":["test"],"enrichment_tagline":"A 30-word tagline for the product value proposition here","enrichment_selling_points":["point"]}\n```',
      EnrichmentSchema,
    );
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

  it('extracts JSON embedded in surrounding text', () => {
    const result = parseJsonFromLLM(
      'Here is the result: {"enrichment_keywords":["cement"],"enrichment_tagline":"High-strength cement for B2B construction buyers in East Africa, ideal for large-scale projects","enrichment_selling_points":["Durable","Cost-effective"]} — end.',
      EnrichmentSchema,
    );
    expect(result).not.toBeNull();
    expect(result?.enrichment_keywords).toContain('cement');
  });
});
