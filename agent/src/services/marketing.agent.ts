// agent/src/services/marketing.agent.ts
import { ChatOpenAI } from '@langchain/openai';
import { db } from '../database/db.client';
import { logger } from '../utils/logger';
import { agentConfig } from '../config/agent.config';

const ASSET_TYPES = ['email_sequence', 'social_post', 'ad_copy', 'landing_page'] as const;

export class MarketingAgent {
  private llm = new ChatOpenAI({
    apiKey: agentConfig.ai.apiKey,
    model: agentConfig.ai.model,
    temperature: 0.3,
    maxTokens: 1024,
    configuration: { baseURL: agentConfig.ai.baseUrl },
  });

  async run(productIds: string[], targetChannel: string = 'all') {
    const start = Date.now();
    const errors: string[] = [];
    const { rows: products } = await db.query(
      `SELECT id, name, description, category FROM scraped_products WHERE id = ANY($1::uuid[]) LIMIT $2`,
      [productIds, agentConfig.salesMarketing.maxProducts],
    );
    let assetsCreated = 0;

    for (const product of products) {
      const prompts: Record<string, string> = {
        email_sequence: `You are head of marketing at Sokogate/Ultimo Trading Company Limited.\nProduct: "${product.name}"\n${product.description}\n\nGenerate a cold-email sequence (subject + 3‑para body). Output plain text. Subject on its own line, then blank line, then body.`,
        social_post:    `Write a LinkedIn/Twitter post about "${product.name}" (<400 chars). End with 2‑3 hashtags.`,
        ad_copy:        `Write a Facebook/Google Ads ad for "${product.name}".\nHEADLINE: <headline>\nCOPY: <copy>`,
        landing_page:   `Write a landing-page hero blurb for "${product.name}".\nH1: <hero headline>\nBULLETS: <3 key benefits, one per line>\nCTA: <call-to-action>`,
      };

      for (const type of ASSET_TYPES) {
        if (targetChannel !== 'all' && targetChannel !== type) continue;
        try {
          const result = await this.llm.invoke([['human', prompts[type]]]);
          const content = (result as any).content?.toString().trim();
          if (!content) throw new Error('Empty LLM response');
          await db.query(
            `INSERT INTO marketing_assets (id, product_id, type, content, created_at)
             VALUES (gen_random_uuid()::text, $1::uuid, $2, $3, NOW())`,
            [product.id, type, content],
          );
          assetsCreated++;
        } catch (err: any) {
          errors.push(`${product.name}/${type}: ${err.message}`);
        }
      }
    }

    logger.info('[marketing-agent] run complete', { products: products.length, assetsCreated });
    return { productsProcessed: products.length, assetsCreated, errors, durationMs: Date.now() - start };
  }
}

export const marketingAgent = new MarketingAgent();
