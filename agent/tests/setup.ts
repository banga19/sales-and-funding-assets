/**
 * tests/setup.ts
 *
 * Global test setup — mocks external services.
 */

import { vi } from 'vitest';

// Mock database
vi.mock('../src/database/db.client', () => ({
  db: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

// Mock agent config — covers all keys used across the test suite
vi.mock('../src/config/agent.config', () => ({
  agentConfig: {
    ai: {
      model:     'nvidia/nemotron-4-340b-instruct',
      apiKey:    'test-key',
      baseUrl:   'https://integrate.api.nvidia.com/v1',
      maxTokens: 512,
    },
    queue: {
      concurrency: 2,
      maxRetries:  3,
      retryDelay:  1000,
    },
    salesMarketing: {
      maxProducts:          5,
      defaultTargetChannel: 'all',
    },
    contentCreation: {
      defaultType:  'blog',
      maxKeywords:  10,
    },
    bulkSourcing: {
      defaultPages:  3,
      maxPages:      10,
      enrichWithAI:  false,
    },
    escalation: {
      email: null,
    },
    redis: {
      host:     'localhost',
      port:     6379,
      password: '',
    },
    monitoring: {
      sentry:   { environment: 'test' },
      logLevel: 'warn',
    },
  },
}));

// Made with Bob
