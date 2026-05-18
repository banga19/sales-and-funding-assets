/**
 * AgentConfig – frontend copy of the relevant settings normally
 * sourced from agent/src/config/agent.config.ts on the backend.
 * Values here match the backend defaults so the UI stays in sync
 * without importing a backend-only module.
 */

export const agentConfig = {
  features: {
    agentsEnabled: true,
  },
  bulkSourcing: {
    defaultPages: 3,
    maxPages: 10,
    enrichWithAI: true,
  },
  salesMarketing: {
    defaultTargetChannel: 'all',
    maxProducts: 5,
  },
  contentCreation: {
    defaultType: 'blog',
    maxKeywords: 10,
  },
  funding: {
    investorProfiles: ['angel', 'vc', 'bank', 'government'] as const,
  },
};

// Made with Bob
