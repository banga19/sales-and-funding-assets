import dotenv from 'dotenv';
import path from 'path';

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

export const agentConfig = {
  // Agent Settings
  enabled: process.env.AGENT_ENABLED === 'true',
  dryRun: process.env.AGENT_DRY_RUN === 'true',
  port: parseInt(process.env.AGENT_PORT || '3002', 10),
  
  // Scheduling
  dailyOutreachTime: process.env.AGENT_DAILY_OUTREACH_TIME || '09:00',
  followupCheckInterval: process.env.AGENT_FOLLOWUP_CHECK_INTERVAL || '6h',
  metricsSyncInterval: process.env.AGENT_METRICS_SYNC_INTERVAL || '1h',

  // Daily outreach quotas for each pipeline (set to 0 to disable)
  outreachTargets: {
    sales:       parseInt(process.env.DAILY_SALES_OUTREACH_TARGET || '20', 10),
    investor:    parseInt(process.env.DAILY_INVESTOR_OUTREACH_TARGET || '8', 10),
    funding:     parseInt(process.env.DAILY_FUNDING_OUTREACH_TARGET || '10', 10),
    partnership: parseInt(process.env.DAILY_PARTNERSHIP_OUTREACH_TARGET || '5', 10),
  },
  
  // Rate Limiting
  rateLimits: {
    email: {
      perDay:   parseInt(process.env.EMAIL_RATE_LIMIT_PER_DAY   || '1000', 10),
      perHour:  parseInt(process.env.EMAIL_RATE_LIMIT_PER_HOUR  || '100',  10),
    },
  },
  
   // Feature Flags
   features: {
      // ── Core agent features (enabled by default, set to 'false' to disable) ──────────
      email:               process.env.ENABLE_EMAIL !== 'false',
      autoFollowup:        process.env.ENABLE_AUTO_FOLLOWUP !== 'false',
      autoScheduling:      process.env.ENABLE_AUTO_SCHEDULING !== 'false',
      sentimentAnalysis:   process.env.ENABLE_SENTIMENT_ANALYSIS !== 'false',
      objectionHandling:   process.env.ENABLE_OBJECTION_HANDLING !== 'false',
      salesOutreach:       process.env.ENABLE_SALES_OUTREACH !== 'false',
      investorOutreach:    process.env.ENABLE_INVESTOR_OUTREACH !== 'false',
      fundingOutreach:     process.env.ENABLE_FUNDING_OUTREACH !== 'false',
      partnershipOutreach: process.env.ENABLE_PARTNERSHIP_OUTREACH !== 'false',
      productSourcing:     process.env.ENABLE_PRODUCT_SOURCING !== 'false',

      // ── Dashboard / UI flags ─────────────────────────────────────────────────────────
      agentsEnabled:       process.env.ENABLE_AGENT_PANEL !== 'false',
      fundingDigest:       process.env.ENABLE_FUNDING_DIGEST !== 'false',

      // ── LangChain integration flags (on by default) ──────────────────────────────────
      semanticSearch:      process.env.ENABLE_SEMANTIC_SEARCH !== 'false',
      memorySummaries:     process.env.ENABLE_MEMORY_SUMMARIES !== 'false',
      bulkSourcing:        process.env.ENABLE_SOURCING_AGENT !== 'false',
      marketingAgent:      process.env.ENABLE_MARKETING_AGENT !== 'false',
      contentAgent:        process.env.ENABLE_CONTENT_AGENT !== 'false',
      fundingPitch:        process.env.ENABLE_FUNDING_PITCH_AGENT !== 'false',
      searchTool:          !!(process.env.SEARCH_API_KEY && process.env.SEARCH_API_KEY.length > 0),
    },

   // ── Master Switch Configuration ─────────────────────────────────────────────
   masterSwitch: {
      sequential:        process.env.MASTER_SWITCH_SEQUENTIAL === 'true',
   },

   // ── Agent System: Bulk Sourcing, Sales & Marketing, Content, Funding ──────────
   bulkSourcing: {
     defaultPages:  parseInt(process.env.BULK_SOURCE_DEFAULT_PAGES  || '3',  10),
     maxPages:      parseInt(process.env.BULK_SOURCE_MAX_PAGES      || '10', 10),
     enrichWithAI:  process.env.BULK_SOURCE_ENRICH_AI === 'true',
   },
   salesMarketing: {
     defaultTargetChannel: (process.env.SALES_MARKETING_DEFAULT_CHANNEL || 'all') as 'email' | 'social' | 'ads' | 'all',
     maxProducts:          parseInt(process.env.SALES_MARKETING_MAX_PRODUCTS || '5', 10),
   },
   contentCreation: {
     defaultType:  (process.env.CONTENT_CREATION_DEFAULT_TYPE || 'blog')    as 'blog' | 'product_guide' | 'company_profile',
     maxKeywords:  parseInt(process.env.CONTENT_CREATION_MAX_KEYWORDS   || '10', 10),
   },
   funding: {
     investorProfiles: ['angel', 'vc', 'bank', 'government'] as const,
   },
  
  // Escalation Settings
  escalation: {
    email: process.env.ESCALATION_EMAIL || 'founder@sokogate.com',
    webhook: process.env.ESCALATION_WEBHOOK,
    thresholds: {
      negativeSentiment: parseInt(process.env.ESCALATION_THRESHOLD_NEGATIVE_SENTIMENT || '3', 10),
      complexQuestion: process.env.ESCALATION_THRESHOLD_COMPLEX_QUESTION === 'true',
    },
  },
  
  // AI Configuration
  ai: {
    apiKey: process.env.NVIDIA_API_KEY || '',
    model: process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-super-120b-a12b',
    baseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
    maxTokens: parseInt(process.env.NVIDIA_MAX_TOKENS || '1024', 10),
  },
  
  // Email Configuration
  email: {
    apiKey: process.env.SMTP_PASS || process.env.EMAIL_API_KEY || '',
    from: {
      email: process.env.EMAIL_FROM || process.env.SMTP_FROM || 'sales@sokogate.com',
      name: process.env.EMAIL_FROM_NAME || 'Sokogate Sales Team',
    },
  },
  
  // Calendly Configuration
  calendly: {
    apiKey: process.env.CALENDLY_API_KEY || '',
    webhookSigningKey: process.env.CALENDLY_WEBHOOK_SIGNING_KEY || '',
    eventTypeUuid: process.env.CALENDLY_EVENT_TYPE_UUID || '',
    userUri: process.env.CALENDLY_USER_URI || '',
  },
  
  // Database Configuration
  database: {
    url: process.env.DATABASE_URL || '',
    pool: {
      min: parseInt(process.env.DATABASE_POOL_MIN || '2', 10),
      max: parseInt(process.env.DATABASE_POOL_MAX || '10', 10),
    },
  },
  
  // Redis Configuration
  redis: {
    url:         process.env.REDIS_URL          || 'redis://localhost:6379',
    host:        process.env.REDIS_HOST         || 'localhost',
    port:        parseInt(process.env.REDIS_PORT || '6379', 10),
    password:    process.env.REDIS_PASSWORD     || '',
    db:          parseInt(process.env.REDIS_DB  || '0', 10),
  },
  
  // Queue Configuration
  queue: {
    concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5', 10),
    maxRetries: parseInt(process.env.QUEUE_MAX_RETRIES || '3', 10),
    retryDelay: parseInt(process.env.QUEUE_RETRY_DELAY || '60000', 10),
  },
  
  // Monitoring Configuration
  monitoring: {
    sentry: {
      dsn: process.env.SENTRY_DSN || '',
      environment: process.env.SENTRY_ENVIRONMENT || 'development',
    },
    logLevel: process.env.LOG_LEVEL || 'info',
  },

  // ── Sokogate Product Sourcing ──────────────────────────────────────────────────
  sokogate: {
    baseUrl:             process.env.SOKOGATE_BASE_URL || 'https://sokogate.com',
    maxPages:            parseInt(process.env.SCRAPER_MAX_PAGES    || '10', 10),
    maxProductsPerRun:   parseInt(process.env.SCRAPER_MAX_PRODUCTS || '50', 10),
    requestDelayMs:      parseInt(process.env.SCRAPER_REQUEST_DELAY_MS || '800', 10),
    scrapeTimeoutMs:     parseInt(process.env.SCRAPER_TIMEOUT_MS   || '120000', 10),
    autoSourceEnabled:   process.env.ENABLE_AUTO_PRODUCT_SOURCING === 'true',
    autoSourceIntervalH: parseInt(process.env.AUTO_SOURCE_INTERVAL_HOURS || '24', 10),
  },
};

// Validation
export function validateConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!agentConfig.ai.apiKey) {
    errors.push('NVIDIA_API_KEY is required');
  }
  
  if (agentConfig.features.email && !agentConfig.email.apiKey && process.env.EMAIL_DEV_MODE !== 'true') {
    errors.push('EMAIL_API_KEY or SMTP_PASS is required when email is enabled and not in dev mode');
  }
  
  if (!agentConfig.database.url) {
    errors.push('DATABASE_URL is required');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export default agentConfig;

// Made with Bob
