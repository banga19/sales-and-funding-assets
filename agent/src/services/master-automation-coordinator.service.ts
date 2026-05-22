import { db } from '../database/db.client';
import { logger } from '../utils/logger';
import { agentConfig } from '../config/agent.config';
import { csvProspectLoader } from './csv-prospect-loader.service';
import { sokogateScraper } from './sokogate-scraper.service';
import { socialMediaGenerator } from './social-media-generator.service';
import { emailService } from '../channels/email.service';
import { personalizationService } from '../agents/personalization';
import { langchainService } from '../services/langchain.service';
import { marketingAgent } from '../services/marketing.agent';
import { fundingPitchAgent } from '../services/funding.agent';
import { orchestrator } from '../agents/orchestrator';

interface AutomationWorkflowResult {
  workflowId: string;
  status: 'completed' | 'partial' | 'failed';
  stepsCompleted: string[];
  prospectsProcessed: number;
  productsScraped: number;
  socialContentGenerated: number;
  emailsSent: number;
  marketingAssetsCreated: number;
  fundingPitchesGenerated: number;
  errors: string[];
  startedAt: string;
  completedAt: string;
}

export class MasterAutomationCoordinatorService {
  private static instance: MasterAutomationCoordinatorService;
  private workflowId: string;

  private constructor() {
    this.workflowId = `workflow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  public static getInstance(): MasterAutomationCoordinatorService {
    if (!MasterAutomationCoordinatorService.instance) {
      MasterAutomationCoordinatorService.instance = new MasterAutomationCoordinatorService();
    }
    return MasterAutomationCoordinatorService.instance;
  }

  /**
   * Execute the complete sales and funding automation workflow
   */
  public async executeCompleteWorkflow(): Promise<AutomationWorkflowResult> {
    const startTime = new Date();
    logger.info('[MASTER-COORDINATOR] Starting complete automation workflow', {
      workflowId: this.workflowId
    });

    const result: AutomationWorkflowResult = {
      workflowId: this.workflowId,
      status: 'completed',
      stepsCompleted: [],
      prospectsProcessed: 0,
      productsScraped: 0,
      socialContentGenerated: 0,
      emailsSent: 0,
      marketingAssetsCreated: 0,
      fundingPitchesGenerated: 0,
      errors: [],
      startedAt: startTime.toISOString(),
      completedAt: ''
    };

    try {
      // Step 1: Load prospects from CSV files
      logger.info('[MASTER-COORDINATOR] Step 1: Loading prospects from CSV files');
      await this.loadAndProcessProspects(result);
      result.stepsCompleted.push('prospect-loading');

      // Step 2: Scrape products from sokogate.com
      logger.info('[MASTER-COORDINATOR] Step 2: Scraping products from sokogate.com');
      await this.scrapeAndProcessProducts(result);
      result.stepsCompleted.push('product-scraping');

      // Step 3: Generate social media content from scraped products
      logger.info('[MASTER-COORDINATOR] Step 3: Generating social media content');
      await this.generateSocialMediaContent(result);
      result.stepsCompleted.push('social-content-generation');

      // Step 4: Generate marketing assets for products
      logger.info('[MASTER-COORDINATOR] Step 4: Generating marketing assets');
      await this.generateMarketingAssets(result);
      result.stepsCompleted.push('marketing-asset-generation');

      // Step 5: Generate funding pitches for investors
      logger.info('[MASTER-COORDINATOR] Step 5: Generating funding pitches');
      await this.generateFundingPitches(result);
      result.stepsCompleted.push('funding-pitch-generation');

      // Step 6: Send personalized outreach emails
      logger.info('[MASTER-COORDINATOR] Step 6: Sending personalized outreach emails');
      await this.sendOutreachEmails(result);
      result.stepsCompleted.push('outreach-email-sending');

      // Step 7: Execute sales generation workflows
      logger.info('[MASTER-COORDINATOR] Step 7: Executing sales generation workflows');
      await this.executeSalesWorkflows(result);
      result.stepsCompleted.push('sales-workflow-execution');

      // Step 8: Execute funding generation workflows
      logger.info('[MASTER-COORDINATOR] Step 8: Executing funding generation workflows');
      await this.executeFundingWorkflows(result);
      result.stepsCompleted.push('funding-workflow-execution');

      result.status = result.errors.length === 0 ? 'completed' : 'partial';
      logger.info('[MASTER-COORDINATOR] Workflow completed', {
        workflowId: this.workflowId,
        status: result.status,
        stepsCompleted: result.stepsCompleted.length,
        errors: result.errors.length
      });

    } catch (error) {
      logger.error('[MASTER-COORDINATOR] Workflow failed', {
        workflowId: this.workflowId,
        error: error.message
      });
      result.status = 'failed';
      result.errors.push(`Workflow execution failed: ${error.message}`);
    } finally {
      const endTime = new Date();
      result.completedAt = endTime.toISOString();
    }

    return result;
  }

  /**
   * Load and process prospects from all CSV files
   */
  private async loadAndProcessProspects(result: AutomationWorkflowResult): Promise<void> {
    try {
      // Load prospects from CSV
      const prospects = csvProspectLoader.getProspects();
      const investors = csvProspectLoader.getInvestors();
      const partnerships = csvProspectLoader.getPartnerships();

      result.prospectsProcessed = prospects.length + investors.length + partnerships.length;

      logger.info('[MASTER-COORDINATOR] Loaded prospects from CSV', {
        prospects: prospects.length,
        investors: investors.length,
        partnerships: partnerships.length
      });

      // Store in database for processing
      for (const prospect of prospects) {
        await this.upsertContact(prospect);
      }

      for (const investor of investors) {
        await this.upsertContact(this.mapInvestorToContact(investor));
      }

      for (const partnership of partnerships) {
        await this.upsertContact(this.mapPartnershipToContact(partnership));
      }

    } catch (error) {
      logger.error('[MASTER-COORDINATOR] Failed to load prospects', { error: error.message });
      result.errors.push(`Prospect loading failed: ${error.message}`);
    }
  }

  /**
   * Scrape products from sokogate.com
   */
  private async scrapeAndProcessProducts(result: AutomationWorkflowResult): Promise<void> {
    try {
      // Scrape products
      const products = await sokogateScraper.scrapeProducts(
        agentConfig.sokogate.maxPages,
        agentConfig.sokogate.maxProductsPerRun
      );

      result.productsScraped = products.length;

      logger.info('[MASTER-COORDINATOR] Scraped products from sokogate.com', {
        count: products.length
      });

      // Store products in database
      for (const product of products) {
        await this.upsertProduct(product);
      }

    } catch (error) {
      logger.error('[MASTER-COORDINATOR] Failed to scrape products', { error: error.message });
      result.errors.push(`Product scraping failed: ${error.message}`);
    }
  }

  /**
   * Generate social media content from scraped products
   */
  private async generateSocialMediaContent(result: AutomationWorkflowResult): Promise<void> {
    try {
      // Get recently scraped products
      const { rows: products } = await db.query(
        'SELECT id FROM scraped_products WHERE is_active = TRUE ORDER BY created_at DESC LIMIT 20'
      );

      const productIds = products.map(p => p.id);

      // Generate social media content for each product
      for (const productId of productIds) {
        try {
          await socialMediaGenerator.generateSocialContent(productId, ['linkedin', 'twitter']);
          result.socialContentGenerated++;

          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          logger.warn('[MASTER-COORDINATOR] Failed to generate social content for product', {
            productId,
            error: error.message
          });
          result.errors.push(`Social content generation failed for product ${productId}: ${error.message}`);
        }
      }

    } catch (error) {
      logger.error('[MASTER-COORDINATOR] Failed to generate social media content', { error: error.message });
      result.errors.push(`Social media content generation failed: ${error.message}`);
    }
  }

  /**
   * Generate marketing assets for products
   */
  private async generateMarketingAssets(result: AutomationWorkflowResult): Promise<void> {
    try {
      // Get products without marketing assets
      const { rows: products } = await db.query(`
        SELECT p.id FROM scraped_products p
        LEFT JOIN marketing_assets m ON p.id = m.product_id
        WHERE p.is_active = TRUE AND m.id IS NULL
        LIMIT 10
      `);

      const productIds = products.map(p => p.id);

      // Generate marketing assets for each product
      for (const productId of productIds) {
        try {
          const resultAsset = await marketingAgent.run([productId], 'linkedin');
          if (resultAsset.assetsCreated > 0) {
            result.marketingAssetsCreated++;
          }

          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          logger.warn('[MASTER-COORDINATOR] Failed to generate marketing assets for product', {
            productId,
            error: error.message
          });
          result.errors.push(`Marketing asset generation failed for product ${productId}: ${error.message}`);
        }
      }

    } catch (error) {
      logger.error('[MASTER-COORDINATOR] Failed to generate marketing assets', { error: error.message });
      result.errors.push(`Marketing asset generation failed: ${error.message}`);
    }
  }

  /**
   * Generate funding pitches for investors
   */
  private async generateFundingPitches(result: AutomationWorkflowResult): Promise<void> {
    try {
      // Get investors that need funding pitches
      const investors = csvProspectLoader.getInvestors().slice(0, 5); // Limit to first 5

      for (const investor of investors) {
        try {
          // Generate funding pitch using LangChain
          const pitchResult = await langchainService.generatePersonalizedMessage({
            contactName: investor.contactName || 'Investor Team',
            company: investor.fundName,
            contactType: 'investor',
            tier: investor.tier,
            isFirstContact: true,
            fundName: investor.fundName,
            geographicFocus: investor.geographicFocus,
            ticketRangeUsd: investor.ticketSizeUsd,
            investmentThesis: investor.investmentThesis
          });

          if (pitchResult.subject && pitchResult.body) {
            result.fundingPitchesGenerated++;

            // Store funding pitch in database
            await this.storeFundingPitch(investor, pitchResult);
          }

          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 1500));
        } catch (error) {
          logger.warn('[MASTER-COORDINATOR] Failed to generate funding pitch for investor', {
            investorId: investor.id,
            error: error.message
          });
          result.errors.push(`Funding pitch generation failed for investor ${investor.id}: ${error.message}`);
        }
      }

    } catch (error) {
      logger.error('[MASTER-COORDINATOR] Failed to generate funding pitches', { error: error.message });
      result.errors.push(`Funding pitch generation failed: ${error.message}`);
    }
  }

  /**
   * Send personalized outreach emails to prospects
   */
  private async sendOutreachEmails(result: AutomationWorkflowResult): Promise<void> {
    try {
      // Get prospects that haven't been contacted recently
      const { rows: contacts } = await db.query(`
        SELECT c.* FROM contacts c
        LEFT JOIN email_logs el ON c.id = el.contact_id
        WHERE el.id IS NULL OR el.sent_at < NOW() - INTERVAL '7 days'
        LIMIT 20
      `);

      logger.info('[MASTER-COORDINATOR] Preparing to send outreach emails', {
        count: contacts.length
      });

      // Send emails to each contact
      for (const contact of contacts) {
        try {
          // Determine contact type based on notes or tier
          const contactType = this.determineContactType(contact);

          // Generate personalized message
          const personalized = await personalizationService.generateMessage(contact as any, {
            company: contact.company || 'Unknown Company',
            tier: contact.tier || 'T3',
            pain_point: contact.pain_point,
            engagement_angle: contact.engagement_angle,
            decision_maker: contact.decisionMaker || '',
            contact_type: this.mapStringToContactType(this.determineContactType(contact)),
            is_first_contact: !(contact.status && contact.status.toLowerCase() !== 'not started'),
            location: contact.location || '',
            annual_spend_kes: parseFloat(contact.annualSpendKes || '0'),
            fund_name: contact.fundName || '',
            geographic_focus: contact.geographicFocus || '',
            investment_thesis: contact.investmentThesis || '',
            country: contact.country || '',
            institution_type: 'other' as any, // Default value
            product_pitched: 'loan' as any, // Default value
            tenor_months: null,
            tenor_years: null
          });

          // Send email
          const emailResult = await emailService.send({
            to: contact.email,
            subject: personalized.subject,
            html: personalized.body.replace(/\n/g, '<br/>'),
            text: personalized.body
          });

          if (emailResult.success) {
            result.emailsSent++;

            // Log the email
            await this.logEmailSent(contact.id, emailResult.message_id || '', personalized.subject);
          } else {
            logger.warn('[MASTER-COORDINATOR] Failed to send email', {
              contactId: contact.id,
              error: emailResult.error
            });
            result.errors.push(`Email sending failed for contact ${contact.id}: ${emailResult.error}`);
          }

          // Rate limiting - respect email service limits
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          logger.error('[MASTER-COORDINATOR] Error sending email to contact', {
            contactId: contact.id,
            error: error.message
          });
          result.errors.push(`Email sending error for contact ${contact.id}: ${error.message}`);
        }
      }

    } catch (error) {
      logger.error('[MASTER-COORDINATOR] Failed to send outreach emails', { error: error.message });
      result.errors.push(`Outreach email sending failed: ${error.message}`);
    }
  }

  /**
   * Execute sales generation workflows
   */
  private async executeSalesWorkflows(result: AutomationWorkflowResult): Promise<void> {
    try {
      // Use the orchestrator to send personalized emails for sales outreach
      const { rows: salesContacts } = await db.query(
        'SELECT c.* FROM contacts c WHERE c.type = \'prospect\' AND (c.status = \'Not Started\' OR c.status IS NULL) LIMIT 10'
      );

      let emailsSent = 0;
      for (const contact of salesContacts) {
        try {
          const result = await orchestrator.sendQuickPersonalized(contact as any, false);
          if (result.ok) {
            emailsSent++;
          }
          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          logger.warn('[MASTER-COORDINATOR] Failed to send sales email', {
            contactId: contact.id,
            error: error.message
          });
          result.errors.push(`Sales email failed for contact ${contact.id}: ${error.message}`);
        }
      }

      if (emailsSent > 0) {
        logger.info('[MASTER-COORDINATOR] Sales outreach completed', {
          emailsSent
        });
        result.emailsSent += emailsSent;
      } else {
        result.errors.push('Sales workflow execution failed: No emails sent');
      }
    } catch (error) {
      logger.error('[MASTER-COORDINATOR] Failed to execute sales workflows', { error: error.message });
      result.errors.push(`Sales workflow execution failed: ${error.message}`);
    }
  }

  /**
   * Execute funding generation workflows
   */
  private async executeFundingWorkflows(result: AutomationWorkflowResult): Promise<void> {
    try {
      // Use the funding pitch agent to generate pitches for investors
      const investorProfiles: ('angel' | 'vc' | 'bank' | 'government')[] = ['angel', 'vc', 'bank'];
      let pitchesGenerated = 0;

      for (const profile of investorProfiles) {
        try {
          const companyDetails = {
            name: 'Ultimo Trading Company Limited',
            description: 'B2B construction materials marketplace',
            stage: 'Series A',
            traction: '10K+ customers, $600K+ ARR'
          };

          const fundingResult = await fundingPitchAgent.run(profile, companyDetails);

          if (fundingResult.prospectsCreated > 0) {
            pitchesGenerated += fundingResult.prospectsCreated;
          }

          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (error) {
          logger.warn('[MASTER-COORDINATOR] Failed to generate funding pitch for profile', {
            profile,
            error: error.message
          });
          result.errors.push(`Funding pitch generation failed for ${profile}: ${error.message}`);
        }
      }

      if (pitchesGenerated > 0) {
        logger.info('[MASTER-COORDINATOR] Funding workflow completed', {
          pitchesGenerated
        });
        result.fundingPitchesGenerated = pitchesGenerated;
      } else {
        result.errors.push('Funding workflow execution failed: No pitches generated');
      }
    } catch (error) {
      logger.error('[MASTER-COORDINATOR] Failed to execute funding workflows', { error: error.message });
      result.errors.push(`Funding workflow execution failed: ${error.message}`);
    }
  }

  // Helper methods for data mapping and storage
  private async upsertContact(contact: any): Promise<void> {
    try {
      await db.query(`
        INSERT INTO contacts (
          contact_name, email, phone, company, type, tier, status,
          pain_point, engagement_angle, location, annual_spent_kes, notes, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
        ON CONFLICT (email) DO UPDATE SET
          contact_name = EXCLUDED.contact_name,
          phone = EXCLUDED.phone,
          company = EXCLUDED.company,
          type = EXCLUDED.type,
          tier = EXCLUDED.tier,
          status = EXCLUDED.status,
          pain_point = EXCLUDED.pain_point,
          engagement_angle = EXCLUDED.engagement_angle,
          location = EXCLUDED.location,
          annual_spent_kes = EXCLUDED.annual_spent_kes,
          notes = EXCLUDED.notes,
          updated_at = NOW()
      `, [
        contact.contact_name || contact.prospect || contact.investor || '',
        contact.email || '',
        contact.phone || '',
        contact.company || '',
        contact.type || 'prospect',
        contact.tier || 'T3',
        contact.status || 'Not Started',
        contact.pain_point || '',
        contact.engagement_angle || '',
        contact.location || '',
        contact.annual_spend_kes || '0',
        contact.notes || ''
      ]);
    } catch (error) {
      logger.warn('[MASTER-COORDINATOR] Failed to upsert contact', { error: error.message });
    }
  }

  private mapInvestorToContact(investor: any): any {
    return {
      contact_name: investor.contactName || '',
      email: investor.email || '',
      phone: investor.phone || '',
      company: investor.fundName || investor.investor || '',
      type: 'investor',
      tier: investor.tier || 'T3',
      status: 'Not Started',
      pain_point: investor.investmentThesis || '',
      engagement_angle: `Seeking ${investor.ticketSizeUsd} investments in ${investor.geographicFocus}`,
      location: investor.geographicFocus || '',
      annual_spend_kes: '0',
      notes: investor.notes || ''
    };
  }

  private mapPartnershipToContact(partnership: any): any {
    return {
      contact_name: partnership.decisionMaker || '',
      email: partnership.email || '',
      phone: partnership.phone || '',
      company: partnership.company || partnership.prospect || '',
      type: 'partner',
      tier: partnership.tier || 'T3',
      status: 'Not Started',
      pain_point: partnership.painPoint || '',
      engagement_angle: partnership.engagementAngle || '',
      location: partnership.location || '',
      annual_spend_kes: partnership.annualSpendKes || '0',
      notes: partnership.notes || ''
    };
  }

  private async upsertProduct(product: any): Promise<void> {
    try {
      await db.query(`
        INSERT INTO scraped_products (
          id, name, description, price_current, moq, weight_grams,
          air_delivery_days, sea_delivery_days, supplier_name, category,
          images, specifications, in_stock, source_url, last_scraped_at,
          trending_score, b2b_suitable, origin_country, shipping_est,
          subcategory, source_id, is_active, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          price_current = EXCLUDED.price_current,
          moq = EXCLUDED.moq,
          weight_grams = EXCLUDED.weight_grams,
          air_delivery_days = EXCLUDED.air_delivery_days,
          sea_delivery_days = EXCLUDED.sea_delivery_days,
          supplier_name = EXCLUDED.supplier_name,
          category = EXCLUDED.category,
          images = EXCLUDED.images,
          specifications = EXCLUDED.specifications,
          in_stock = EXCLUDED.in_stock,
          source_url = EXCLUDED.source_url,
          last_scraped_at = EXCLUDED.last_scraped_at,
          trending_score = EXCLUDED.trending_score,
          b2b_suitable = EXCLUDED.b2b_suitable,
          origin_country = EXCLUDED.origin_country,
          shipping_est = EXCLUDED.shipping_est,
          subcategory = EXCLUDED.subcategory,
          source_id = EXCLUDED.source_id,
          updated_at = NOW()
      `, [
        product.id,
        product.name,
        product.description || '',
        product.priceCurrent ?? null,
        product.moq ?? null,
        product.weightGrams ?? null,
        product.airDeliveryDays ?? null,
        product.seaDeliveryDays ?? null,
        product.supplierName || null,
        product.category || 'General',
        JSON.stringify(product.images),
        JSON.stringify(product.specifications),
        product.inStock ?? true,
        product.sourceUrl || '',
        product.scrapedAt || new Date().toISOString(),
        product.trendingScore ?? null,
        product.b2bSuitable ?? null,
        product.originCountry || null,
        product.shippingEst || null,
        product.subcategory || null,
        product.sourceId || null,
        true
      ]);
    } catch (error) {
      logger.warn('[MASTER-COORDINATOR] Failed to upsert product', { error: error.message });
    }
  }

  private async storeFundingPitch(investor: any, pitch: { subject: string; body: string }): Promise<void> {
    try {
      await db.query(`
        INSERT INTO funding_pitches (
          investor_id, fund_name, pitch_subject, pitch_body, generated_at, status
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        investor.id || `inv-${Date.now()}`,
        investor.fundName || investor.investor || 'Unknown Fund',
        pitch.subject,
        pitch.body,
        new Date().toISOString(),
        'generated'
      ]);
    } catch (error) {
      logger.warn('[MASTER-COORDINATOR] Failed to store funding pitch', { error: error.message });
    }
  }

  private async logEmailSent(contactId: string, messageId: string, subject: string): Promise<void> {
    try {
      await db.query(`
        INSERT INTO email_logs (
          contact_id, message_id, subject, sent_at, status
        ) VALUES ($1, $2, $3, $4, $5)
      `, [
        contactId,
        messageId,
        subject,
        new Date().toISOString(),
        'sent'
      ]);
    } catch (error) {
      logger.warn('[MASTER-COORDINATOR] Failed to log email sent', { error: error.message });
    }
  }

  private determineContactType(contact: any): string {
    if (contact.type) return contact.type;

    // Infer type from notes or other fields
    const notes = (contact.notes || '').toLowerCase();
    if (notes.includes('invest') || notes.includes('fund') || notes.includes('capital')) {
      return 'investor';
    }
    if (notes.includes('partner') || notes.includes('partnership')) {
      return 'partner';
    }
    return 'prospect';
  }

  private mapStringToContactType(typeStr: string): any {
    switch (typeStr.toLowerCase()) {
      case 'investor': return 'investor';
      case 'partner': return 'partner';
      case 'prospect': return 'prospect';
      case 'funding': return 'funding';
      default: return 'prospect';
    }
  }
}

export const masterAutomationCoordinator = MasterAutomationCoordinatorService.getInstance();
export default masterAutomationCoordinator;