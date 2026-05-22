import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  CORS_ORIGINS: z.string().default('http://localhost:3001,http://localhost:3000,http://localhost:3002'),

  // ── Database ────────────────────────────────────────────────────────────────
  DATABASE_URL:             z.string().default('postgresql://sokogate:sokogate-dev-change-me@localhost:5433/sokogate'),
  DB_POOL_MIN:              z.coerce.number().default(2),
  DB_POOL_MAX:              z.coerce.number().default(10),

  // ── Redis / BullMQ ─────────────────────────────────────────────────────────
  REDIS_URL:                z.string().default('redis://localhost:6379'),
  REDIS_PASSWORD:           z.string().default(''),
  REDIS_DB:                 z.coerce.number().default(0),
  SCRAPER_SCRAPE_QUEUE:     z.string().default('sokogate-scrape'),
  SCRAPER_JOB_MAX_RETRIES:  z.coerce.number().default(3),
  SCRAPER_JOB_RETRY_DELAY_MS: z.coerce.number().default(60000),

  // ── Scrape scheduling ──────────────────────────────────────────────────────
  SCRAPER_SCHEDULE_TZ:      z.string().default('UTC'),
  SCRAPER_SCHEDULE_CRON:    z.string().default('0 6 * * *'),  // 06:00 UTC daily

  // ── Scraper configuration ──────────────────────────────────────────────────
  SCRAPER_MAX_PAGES_PER_RUN:    z.coerce.number().default(10),
  SCRAPER_MAX_PRODUCTS_PER_RUN: z.coerce.number().default(50),
  SCRAPER_REQUEST_DELAY_MS:     z.coerce.number().default(800),
  SCRAPER_MAX_CONCURRENCY:      z.coerce.number().default(3),
  SCRAPER_HEADFUL:              z.coerce.boolean().default(false),
  SCRAPER_PROXY_LIST:           z.string().default(''),      // comma-separated proxy URLs
  SCRAPER_PROXY_ENABLED:        z.coerce.boolean().default(false),

  // ── Sokogate target ────────────────────────────────────────────────────────
  SOKOGATE_BASE_URL:         z.string().default('https://sokogate.com'),

  // ── Agent feature flags ────────────────────────────────────────────────────
  AGENT_ENABLED:             z.coerce.boolean().default(true),
  AGENT_DRY_RUN:             z.coerce.boolean().default(true),
  EMAIL_RATE_LIMIT:          z.coerce.number().default(1000),
  FEATURE_EMAIL:             z.coerce.boolean().default(true),
  FEATURE_AUTO_FOLLOWUP:     z.coerce.boolean().default(true),
  FEATURE_AUTO_SCHEDULING:   z.coerce.boolean().default(true),
  FEATURE_SENTIMENT_ANALYSIS: z.coerce.boolean().default(true),
  FEATURE_OBJECTION_HANDLING: z.coerce.boolean().default(true),
  FEATURE_PRODUCT_SCRAPING:  z.coerce.boolean().default(true),
  FEATURE_PLAYWRIGHT_SCRAPER: z.coerce.boolean().default(true),
  FEATURE_AUTONOMOUS_AGENTS:   z.coerce.boolean().default(true),
  FEATURE_BULK_SOURCING:       z.coerce.boolean().default(true),
  FEATURE_MARKETING:           z.coerce.boolean().default(true),
  FEATURE_CONTENT:             z.coerce.boolean().default(true),
  FEATURE_FUNDING_PITCH:       z.coerce.boolean().default(true),

  // ── Logging ──────────────────────────────────────────────────────────────────
  LOG_LEVEL: z.string().default('info'),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error('Invalid environment variables:', result.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  ...result.data,
  cors: {
    origins: result.data.CORS_ORIGINS.split(',').map((s) => s.trim()),
  },
  features: {
    email:              result.data.FEATURE_EMAIL,
    autoFollowup:       result.data.FEATURE_AUTO_FOLLOWUP,
    autoScheduling:     result.data.FEATURE_AUTO_SCHEDULING,
    sentimentAnalysis:  result.data.FEATURE_SENTIMENT_ANALYSIS,
    objectionHandling:  result.data.FEATURE_OBJECTION_HANDLING,
    productScraping:    result.data.FEATURE_PRODUCT_SCRAPING,
    playwrightScraper:  result.data.FEATURE_PLAYWRIGHT_SCRAPER,
    autonomousAgents:   result.data.FEATURE_AUTONOMOUS_AGENTS,
    bulkSourcing:       result.data.FEATURE_BULK_SOURCING,
    marketing:          result.data.FEATURE_MARKETING,
    content:            result.data.FEATURE_CONTENT,
    fundingPitch:       result.data.FEATURE_FUNDING_PITCH,
  },
  rateLimits: {
    email:    { perDay: result.data.EMAIL_RATE_LIMIT },
  },
  scraper: {
    baseUrl:       result.data.SOKOGATE_BASE_URL,
    maxPages:      result.data.SCRAPER_MAX_PAGES_PER_RUN,
    maxProducts:   result.data.SCRAPER_MAX_PRODUCTS_PER_RUN,
    requestDelayMs: result.data.SCRAPER_REQUEST_DELAY_MS,
    maxConcurrency:result.data.SCRAPER_MAX_CONCURRENCY,
    headful:       result.data.SCRAPER_HEADFUL,
    proxyList:     result.data.SCRAPER_PROXY_LIST ? result.data.SCRAPER_PROXY_LIST.split(',').map((p) => p.trim()) : [],
    proxyEnabled:  result.data.SCRAPER_PROXY_ENABLED,
    schedule: {
      tz:   result.data.SCRAPER_SCHEDULE_TZ,
      cron: result.data.SCRAPER_SCHEDULE_CRON,
    },
  },
  database: {
    url:   result.data.DATABASE_URL,
    pool:  { min: result.data.DB_POOL_MIN, max: result.data.DB_POOL_MAX },
  },
  redis: {
    url:         result.data.REDIS_URL,
    password:    result.data.REDIS_PASSWORD,
    db:          result.data.REDIS_DB,
    scrapeQueue: result.data.SCRAPER_SCRAPE_QUEUE,
  },
  sched: {
    tz:   result.data.SCRAPER_SCHEDULE_TZ,
    cron: result.data.SCRAPER_SCHEDULE_CRON,
  },
};

// Re-export for convenience
export const defaultBaseUrl = config.scraper.baseUrl;
