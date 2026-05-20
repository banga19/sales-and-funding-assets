/**
 * tests/setup.ts
 *
 * Global test setup — mocks external services.
 */

import { vi } from 'vitest';

// Mock database
vi.mock('../database/db.client', () => ({
  db: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

// Mock agent config
vi.mock('../config/agent.config', () => ({
  agentConfig: {
    ai: {
      model: 'nvidia/nemotron-4-340b-instruct',
      apiKey: 'test-key',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
    },
    redis: {
      host: 'localhost',
      port: 6379,
      password: '',
    },
    monitoring: {
      sentry: { environment: 'test' },
      logLevel: 'warn',
    },
  },
}));

// Made with Bob
