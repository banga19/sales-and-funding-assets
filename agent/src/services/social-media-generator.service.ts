import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { BaseMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { db } from '../database/db.client';
import { logger } from '../utils/logger';
import { agentConfig } from '../config/agent.config';
import { langchainService, parseJsonFromLLM } from './langchain.service';
import { sokogateScraper } from './sokogate-scraper.service';

interface SocialMediaPost {
  id: string;
  productId: string;
  platform: 'linkedin' | 'twitter' | 'facebook';
  content: string;
  hashtags: string[];
  imagePrompt: string | null;
  createdAt: string;
}

interface SocialMediaCampaign {
  id: string;
  productId: string;
  posts: SocialMediaPost[];
  theme: string;
  targetAudience: string;
  createdAt: string;
}

export class SocialMediaGeneratorService {
  private static instance: SocialMediaGeneratorService;

  private constructor() {}

  public static getInstance(): SocialMediaGeneratorService {
    if (!SocialMediaGeneratorService.instance) {
      SocialMediaGeneratorService.instance = new SocialMediaGeneratorService();
    }
    return SocialMediaGeneratorService.instance;
  }

  /**
   * Generate social media content for a product
   */
  public async generateSocialContent(
    productId: string,
    platforms: ('linkedin' | 'twitter' | 'facebook')[] = ['linkedin', 'twitter']
  ): Promise<SocialMediaCampaign> {
    try {
      logger.info('[SOCIAL-GEN] Generating social content', { productId, platforms });

      // Fetch product details
      const productRows = await db.query(
        'SELECT id, name, description, price_current, category, images FROM scraped_products WHERE id = $1 AND is_active = TRUE',
        [productId]
      );

      if (productRows.rows.length === 0) {
        throw new Error(`Product not found: ${productId}`);
      }

      const product = productRows.rows[0];

      // Generate content for each platform
      const posts: SocialMediaPost[] = [];

      for (const platform of platforms) {
        const post = await this.generatePlatformPost(product, platform);
        if (post) {
          posts.push(post);
        }
      }

      // Create campaign
      const campaign: SocialMediaCampaign = {
        id: `camp-${productId}-${Date.now()}`,
        productId: product.id,
        posts,
        theme: `${product.name} - Construction Solutions Campaign`,
        targetAudience: 'B2B procurement managers, contractors, and developers in East and West Africa',
        createdAt: new Date().toISOString()
      };

      // Save to database
      await this.saveCampaign(campaign);

      logger.info('[SOCIAL-GEN] Social content generated', {
        productId: product.id,
        postsGenerated: posts.length
      });

      return campaign;
    } catch (error) {
      logger.error('[SOCIAL-GEN] Failed to generate social content', {
        productId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Generate social media post for specific platform
   */
  private async generatePlatformPost(
    product: any,
    platform: 'linkedin' | 'twitter' | 'facebook'
  ): Promise<SocialMediaPost | null> {
    try {
      let promptTemplate: ChatPromptTemplate;
      let systemMessage: string;

      switch (platform) {
        case 'linkedin':
          systemMessage = `You are a professional LinkedIn content creator for Sokogate/Ultimo Trading Company Limited,
          a B2B e-commerce platform for construction and industrial materials in East and West Africa.
          Create engaging, professional LinkedIn posts that drive engagement and leads.`;
          break;
        case 'twitter':
          systemMessage = `You are a Twitter/X content specialist for Sokogate/Ultimo Trading Company Limited.
          Create concise, engaging tweets (under 280 characters) that highlight product benefits
          and include relevant hashtags for the construction industry.`;
          break;
        case 'facebook':
          systemMessage = `You are a Facebook content creator for Sokogate/Ultimo Trading Company Limited.
          Create engaging Facebook posts suitable for business audiences in the construction sector.
          Focus on community building and educational content.`;
          break;
        default:
          throw new Error(`Unsupported platform: ${platform}`);
      }

      const humanMessage = `
      Product Name: ${product.name}
      Category: ${product.category}
      Description: ${product.description || 'No description available'}
      Price: ${product.price_current ? `KES ${product.price_current}` : 'Price on request'}

      Create a ${platform} post that:
      1. Highlights the key benefits and applications of this product
      2. Includes a clear call-to-action to visit sokogate.com
      3. Uses appropriate tone for ${platform} audience
      4. Includes relevant hashtags for construction/B2B audience
      5. Is optimized for engagement and lead generation

      Return the result as JSON with:
      - content: The post text
      - hashtags: Array of relevant hashtags
      - imagePrompt: Optional prompt for generating an accompanying image
      `;

      const chatPrompt = ChatPromptTemplate.fromMessages([
        ['system', systemMessage],
        ['human', humanMessage]
      ]);

      // Using the existing langchain service pattern
      // For now, we'll use a simpler approach without structured output
      // TODO: Implement proper structured output when LangChain service is updated
      const prompt = chatPrompt.format({});
      logger.warn('[SOCIAL-GEN] Using fallback approach - structured output not yet implemented');

      // Return a basic post for now
      const post: SocialMediaPost = {
        id: `${platform}-${product.id}-${Date.now()}`,
        productId: product.id,
        platform,
        content: `Check out ${product.name} - perfect for ${product.category} projects! Visit sokogate.com to learn more. #Construction #BuildingMaterials #Sokogate`,
        hashtags: ['#Construction', '#BuildingMaterials', '#Sokogate'],
        imagePrompt: null,
        createdAt: new Date().toISOString()
      };

      return post;
    } catch (error) {
      logger.warn('[SOCIAL-GEN] Error generating platform post', {
        productId: product.id,
        platform,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Save social media campaign to database
   */
  private async saveCampaign(campaign: SocialMediaCampaign): Promise<void> {
    try {
      // We'll store this in a new table or extend existing marketing_assets table
      // For now, we'll log it and implement proper storage later
      logger.info('[SOCIAL-GEN] Campaign ready for storage', {
        campaignId: campaign.id,
        postsCount: campaign.posts.length
      });

      // TODO: Implement actual database persistence
      // This would involve creating a social_media_campaigns table
    } catch (error) {
      logger.error('[SOCIAL-GEN] Failed to save campaign', {
        campaignId: campaign.id,
        error: error.message
      });
      // Don't throw here as we want to return the campaign even if storage fails
    }
  }

  /**
   * Generate social media content for multiple products
   */
  public async generateBatchSocialContent(
    productIds: string[],
    platforms: ('linkedin' | 'twitter' | 'facebook')[] = ['linkedin']
  ): Promise<SocialMediaCampaign[]> {
    const campaigns: SocialMediaCampaign[] = [];

    for (const productId of productIds) {
      try {
        const campaign = await this.generateSocialContent(productId, platforms);
        campaigns.push(campaign);

        // Add delay between requests to be respectful to LLM service
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        logger.error('[SOCIAL-GEN-BATCH] Failed for product', {
          productId,
          error: error.message
        });
        // Continue with other products
      }
    }

    return campaigns;
  }

  /**
   * Get trending products for social media campaigns
   */
  public async getTrendingProducts(limit: number = 10): Promise<any[]> {
    try {
      const { rows } = await db.query(
        'SELECT id, name, description, price_current, category, trending_score FROM scraped_products WHERE is_active = TRUE ORDER BY trending_score DESC LIMIT $1',
        [limit]
      );
      return rows;
    } catch (error) {
      logger.error('[SOCIAL-GEN] Failed to get trending products', { error: error.message });
      return [];
    }
  }
}

export const socialMediaGenerator = SocialMediaGeneratorService.getInstance();
export default socialMediaGenerator;