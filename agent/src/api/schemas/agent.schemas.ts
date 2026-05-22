/**
 * agent.schemas.ts
 *
 * Zod validation schemas for all agent API endpoints.
 */

import { z } from 'zod';

// ── Bulk Sourcing ──────────────────────────────────────────────────────────────

export const BulkSourcingSchema = z.object({
  pages: z.number().int().min(1).max(20).optional(),
  enrichWithAI: z.boolean().optional(),
  maxEnrich: z.number().int().min(1).max(100).optional(),
});

// ── Sales & Marketing ──────────────────────────────────────────────────────────

export const SalesMarketingSchema = z.object({
  productIds: z.array(z.string()).min(1).max(50),
  targetChannel: z.enum(['email', 'social', 'ads', 'all']).optional(),
});

// ── Content Creation ───────────────────────────────────────────────────────────

export const ContentCreationSchema = z.object({
  type: z.enum(['blog', 'product_guide', 'company_profile']),
  keywords: z.array(z.string().min(1).max(100)).optional().default([]),
  productIds: z.array(z.string()).optional(),
});

// ── Funding ────────────────────────────────────────────────────────────────────

export const FundingSchema = z.object({
  investorProfile: z.enum(['angel', 'vc', 'bank', 'government']),
  companyDetails: z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    industry: z.string().max(100).optional(),
    revenue: z.string().max(100).optional(),
  }).optional(),
});

// ── Agent Queue ────────────────────────────────────────────────────────────────

export const AgentQueueSchema = z.object({
  agentName: z.enum(['bulk-sourcing', 'sales-marketing', 'content-creation', 'funding']),
  params: z.record(z.unknown()).optional(),
  triggeredBy: z.string().max(100).optional(),
});

// ── Batch Send ─────────────────────────────────────────────────────────────────

export const BatchSendSchema = z.object({
  filePath: z.string().min(1).max(500),
  dryRun: z.boolean().optional(),
  batchSize: z.number().int().min(1).max(100).optional(),
});

// ── Outreach Batch ─────────────────────────────────────────────────────────────

export const OutreachBatchSchema = z.object({
  contactType: z.enum(['prospect', 'investor', 'partner', 'funding']).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

// ── Email Test ─────────────────────────────────────────────────────────────────

export const EmailTestSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(10000),
});

// Made with Bob
