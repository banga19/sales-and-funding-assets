import dotenv from 'dotenv';

dotenv.config();

export const agentConfig = {
  // Agent Settings
  enabled: process.env.AGENT_ENABLED === 'true',
  dryRun: process.env.AGENT_DRY_RUN === 'true',
  port: parseInt(process.env.AGENT_PORT || '3002', 10),
  
  // Scheduling
  dailyOutreachTime: process.env.AGENT_DAILY_OUTREACH_TIME || '09:00',
  followupCheckInterval: process.env.AGENT_FOLLOWUP_CHECK_INTERVAL || '6h',
  metricsSyncInterval: process.env.AGENT_METRICS_SYNC_INTERVAL || '1h',
  
  // Rate Limiting
  rateLimits: {
    email: {
      perDay: parseInt(process.env.EMAIL_RATE_LIMIT_PER_DAY || '50', 10),
      perHour: parseInt(process.env.EMAIL_RATE_LIMIT_PER_HOUR || '10', 10),
    },
    whatsapp: {
      perDay: parseInt(process.env.WHATSAPP_RATE_LIMIT_PER_DAY || '100', 10),
      perHour: parseInt(process.env.WHATSAPP_RATE_LIMIT_PER_HOUR || '20', 10),
    },
  },
  
  // Feature Flags
  features: {
    whatsapp: process.env.ENABLE_WHATSAPP === 'true',
    email: process.env.ENABLE_EMAIL === 'true',
    autoFollowup: process.env.ENABLE_AUTO_FOLLOWUP === 'true',
    autoScheduling: process.env.ENABLE_AUTO_SCHEDULING === 'true',
    sentimentAnalysis: process.env.ENABLE_SENTIMENT_ANALYSIS === 'true',
    objectionHandling: process.env.ENABLE_OBJECTION_HANDLING === 'true',
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
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
    maxTokens: parseInt(process.env.ANTHROPIC_MAX_TOKENS || '1024', 10),
  },
  
  // Email Configuration
  email: {
    resend: {
      apiKey: process.env.RESEND_API_KEY || '',
      from: {
        email: process.env.RESEND_FROM_EMAIL || 'sales@sokogate.com',
        name: process.env.RESEND_FROM_NAME || 'Sokogate Sales Team',
      },
    },
    sendgrid: {
      apiKey: process.env.SENDGRID_API_KEY || '',
      from: process.env.SENDGRID_FROM_EMAIL || 'sales@sokogate.com',
    },
  },
  
  // WhatsApp Configuration
  whatsapp: {
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v18.0',
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
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    password: process.env.REDIS_PASSWORD || '',
    db: parseInt(process.env.REDIS_DB || '0', 10),
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
    errors.push('ANTHROPIC_API_KEY is required');
  }
  
  if (agentConfig.features.email && !agentConfig.email.resend.apiKey) {
    errors.push('RESEND_API_KEY is required when email is enabled');
  }
  
  if (agentConfig.features.whatsapp && !agentConfig.whatsapp.accessToken) {
    errors.push('WHATSAPP_ACCESS_TOKEN is required when WhatsApp is enabled');
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
