import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  CORS_ORIGINS: z.string().default('http://localhost:3001,http://localhost:3000,http://localhost:3002'),
  SOKOGATE_BASE_URL: z.string().default('https://sokogate.com'),

  AGENT_ENABLED: z.coerce.boolean().default(true),
  AGENT_DRY_RUN: z.coerce.boolean().default(true),

  EMAIL_RATE_LIMIT: z.coerce.number().default(50),
  WHATSAPP_RATE_LIMIT: z.coerce.number().default(100),

  FEATURE_EMAIL: z.coerce.boolean().default(true),
  FEATURE_WHATSAPP: z.coerce.boolean().default(false),
  FEATURE_AUTO_FOLLOWUP: z.coerce.boolean().default(true),
  FEATURE_AUTO_SCHEDULING: z.coerce.boolean().default(true),
  FEATURE_SENTIMENT_ANALYSIS: z.coerce.boolean().default(true),
  FEATURE_OBJECTION_HANDLING: z.coerce.boolean().default(true),
  FEATURE_PRODUCT_SCRAPING: z.coerce.boolean().default(true),
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
    email: result.data.FEATURE_EMAIL,
    whatsapp: result.data.FEATURE_WHATSAPP,
    autoFollowup: result.data.FEATURE_AUTO_FOLLOWUP,
    autoScheduling: result.data.FEATURE_AUTO_SCHEDULING,
    sentimentAnalysis: result.data.FEATURE_SENTIMENT_ANALYSIS,
    objectionHandling: result.data.FEATURE_OBJECTION_HANDLING,
  },
  rateLimits: {
    email: { perDay: result.data.EMAIL_RATE_LIMIT },
    whatsapp: { perDay: result.data.WHATSAPP_RATE_LIMIT },
  },
};
