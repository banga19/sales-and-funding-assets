import OpenAI from 'openai';
import { agentConfig } from '../config/agent.config';
import { logger, loggers } from '../utils/logger';
import { Contact, ContactType } from '../types/contact.types';
import { GeneratedMessage, MessageContext, Intent } from '../types/message.types';
import { readFileSync } from 'fs';
import { join } from 'path';

class PersonalizationService {
  private openai: OpenAI;
  private static instance: PersonalizationService;
  private promptCache: Map<string, string> = new Map();

  private constructor() {
    this.openai = new OpenAI({
      apiKey: agentConfig.ai.apiKey,
      baseURL: agentConfig.ai.baseUrl,
    });
  }

  public static getInstance(): PersonalizationService {
    if (!PersonalizationService.instance) {
      PersonalizationService.instance = new PersonalizationService();
    }
    return PersonalizationService.instance;
  }

  /**
   * Generate a personalized message for a contact
   */
  public async generateMessage(
    contact: Contact,
    context: MessageContext
  ): Promise<GeneratedMessage> {
    try {
      const prompt = this.buildPrompt(contact, context);
      
      const response = await this.openai.chat.completions.create({
        model: agentConfig.ai.model,
        max_tokens: agentConfig.ai.maxTokens,
        messages: [{
          role: 'user',
          content: prompt,
        }],
      });

      const content = response.choices[0]?.message?.content || '';

      // Parse the generated message
      const parsed = this.parseGeneratedMessage(content);

      logger.info('Message generated', {
        contactId: contact.id,
        contactType: contact.type,
        template: context.is_first_contact ? 'initial' : 'followup',
      });

      return {
        to: contact.email || '',
        channel: contact.email ? 'email' : 'email',
        subject: parsed.subject,
        body: parsed.body,
        template_used: this.getTemplateType(contact.type, context),
        generated_at: new Date(),
        personalization_score: this.calculatePersonalizationScore(parsed.body, context),
      };
} catch (error: any) {
       loggers.apiError('nvidia', error);
      throw new Error(`Failed to generate message: ${error.message}`);
    }
  }

  /**
   * Analyze intent from incoming message
   */
  public async analyzeIntent(
    messageContent: string,
    contact: Contact
  ): Promise<Intent> {
    try {
      const prompt = `Analyze this response from ${contact.company}:

"${messageContent}"

Determine:
1. Intent type: positive_interest, question, objection, not_interested, out_of_office, or unclear
2. Sentiment: positive, neutral, or negative
3. Key points mentioned
4. Suggested next action
5. Whether this requires human escalation

Respond in JSON format:
{
  "type": "intent_type",
  "sentiment": "sentiment",
  "confidence": 0.0-1.0,
  "key_points": ["point1", "point2"],
  "suggested_action": "action description",
  "requires_escalation": true/false
}`;

      const response = await this.openai.chat.completions.create({
        model: agentConfig.ai.model,
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: prompt,
        }],
      });

      const analysisText = response.choices[0]?.message?.content || '{}';
      
      // Extract JSON from response
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

      logger.info('Intent analyzed', {
        contactId: contact.id,
        intent: analysis.type,
        sentiment: analysis.sentiment,
        confidence: analysis.confidence,
      });

      return {
        type: analysis.type || 'unclear',
        sentiment: analysis.sentiment || 'neutral',
        confidence: analysis.confidence || 0.5,
        key_points: analysis.key_points || [],
        suggested_action: analysis.suggested_action || 'follow_up',
        requires_escalation: analysis.requires_escalation || false,
      };
} catch (error: any) {
       loggers.apiError('nvidia', error);
      
      // Return default intent on error
      return {
        type: 'unclear',
        sentiment: 'neutral',
        confidence: 0,
        key_points: [],
        suggested_action: 'escalate_to_human',
        requires_escalation: true,
      };
    }
  }

/**
   * Generate response to incoming message
   */
  public async generateResponse(
    incomingMessage: string,
    contact: Contact,
    intent: Intent
  ): Promise<string> {
    try {
      const roleDescriptor = contact.type === 'prospect'
        ? `sales representative for Sokogate`
        : contact.type === 'investor'
          ? `fundraising lead on behalf of the founder of Ultimo Trading Company Limited (sokogate.com)`
          : contact.type === 'funding'
            ? `capital-raising advisor for Ultimo Trading Company Limited, trading as sokogate.com`
            : `business development lead for Sokogate / Ultimo Trading Company Limited`;

      const prompt = `You are a ${roleDescriptor}. A ${contact.type} named ${contact.company} sent this message:

"${incomingMessage}"

Intent detected: ${intent.type}
Sentiment: ${intent.sentiment}

Generate an appropriate response that:
1. Addresses their ${intent.type === 'question' ? 'question' : intent.type === 'objection' ? 'concern' : intent.type === 'positive_interest' ? 'interest' : 'message'} directly
2. Maintains a professional but friendly tone
3. Moves the conversation toward a clear next step (call, meeting, shared document)
4. Keep it concise (under 150 words)`;

      const response = await this.openai.chat.completions.create({
        model: agentConfig.ai.model,
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: prompt,
        }],
      });

      return response.choices[0]?.message?.content || '';
} catch (error: any) {
       loggers.apiError('nvidia', error);
      throw new Error(`Failed to generate response: ${error.message}`);
    }
  }

  /**
   * Build prompt for message generation
   */
  private buildPrompt(contact: Contact, context: MessageContext): string {
    const templateType = this.getTemplateType(contact.type, context);
    const basePrompt = this.loadPromptTemplate(templateType);

    return `${basePrompt}

Contact Information:
- Company: ${context.company}
- Type: ${context.contact_type}
- Tier: ${context.tier}
${context.pain_point ? `- Pain Point: ${context.pain_point}` : ''}
${context.engagement_angle ? `- Engagement Angle: ${context.engagement_angle}` : ''}
${context.annual_spend ? `- Annual Spend: KES ${context.annual_spend.toLocaleString()}` : ''}
${context.decision_maker ? `- Decision Maker: ${context.decision_maker}` : ''}

${context.contact_type === 'prospect' ? `
Additional Context:
- Location: ${context.location || 'N/A'}
- Annual Spend: KES ${context.annual_spend_kes ? context.annual_spend_kes.toLocaleString() : 'N/A'}
- Decision Maker Title: ${context.decision_maker_title || 'N/A'}
` : ''}

${context.contact_type === 'investor' ? `
Investor Context:
- Fund Name: ${context.fund_name || 'N/A'}
- Geographic Focus: ${context.geographic_focus || 'N/A'}
- Ticket Range: USD ${(context.ticket_size_usd_min ?? 0).toLocaleString()} – ${(context.ticket_size_usd_max ?? 0).toLocaleString()}
- Investment Thesis: ${context.investment_thesis || 'N/A'}
- Decision Timeline: ${context.decision_timeline_weeks ? context.decision_timeline_weeks + ' weeks' : 'N/A'}
` : ''}

${context.contact_type === 'partner' ? `
Partner Context:
- Country / Market: ${context.country || 'N/A'}
- Capability / Interest: ${context.capability || 'N/A'}
- Revenue Model: ${context.revenue_model || 'N/A'}
- Monthly Revenue Potential: USD ${context.monthly_revenue_potential_usd ? context.monthly_revenue_potential_usd.toLocaleString() : 'N/A'}
` : ''}

${context.contact_type === 'funding' ? `
Funding / Trade-Finance Context:
- Institution Type: ${context.institution_type || 'N/A'}
- Product Being Pitched: ${context.product_pitched || 'N/A'}
- Ticket Size Requested: USD ${(context.ticket_size_usd_requested ?? 0).toLocaleString()}
- Tenor: ${context.tenor_months ? context.tenor_months + ' months' : (context.tenor_years ? context.tenor_years + ' years' : 'N/A')}
- Interest Rate Requested: ${context.interest_rate_requested || 'Market rate'}
- Collateral Available: ${context.collateral_available || 'N/A'}
- Audited Financials: ${context.audited_financials_available ? 'Yes' : 'N/A'}
- Existing Bank Relationships: ${context.bank_relationships || 'N/A'}
- Credit Rating: ${context.credit_rating || 'N/A'}
- Urgency: ${context.urgency || 'N/A'}
- Contact Person Title: ${context.contact_person_title || 'N/A'}
` : ''}

Success Context:
- First Contact: ${context.is_first_contact ? 'Yes' : 'No'}
${context.days_since_last_contact ? `- Days Since Last Contact: ${context.days_since_last_contact}` : ''}
${context.previous_messages?.length ? `- Previous Messages: ${context.previous_messages.length}` : ''}

Generate a personalized ${contact.type === 'prospect' ? 'sales' : contact.type === 'investor' ? 'investor pitch' : contact.type === 'funding' ? 'funding / trade-finance pitch' : 'partnership'} message.

Format your response as:
SUBJECT: [email subject line]
---
[message body]`;
  }

  /**
   * Load prompt template from file
   */
  private loadPromptTemplate(templateType: string): string {
    // Check cache first
    if (this.promptCache.has(templateType)) {
      return this.promptCache.get(templateType)!;
    }

    try {
      const promptPath = join(__dirname, '../../prompts', `${templateType}.txt`);
      const prompt = readFileSync(promptPath, 'utf-8');
      this.promptCache.set(templateType, prompt);
      return prompt;
    } catch (error) {
      logger.warn(`Prompt template not found: ${templateType}, using default`);
      return this.getDefaultPrompt(templateType);
    }
  }

  /**
   * Get default prompt if file not found
   */
  private getDefaultPrompt(templateType: string): string {
    const defaults: Record<string, string> = {
      // Sales
      'sales-initial':        'You are a sales representative for Sokogate, a B2B bulk sourcing platform. Write a professional, personalized email introducing our service and highlighting 15-20% cost savings.',
      'sales-followup-1':     'Write a friendly first follow-up email after initial outreach. Keep it brief, reference something specific, and offer a new data point.',
      'sales-followup-2':     'Write a second follow-up — the final nudge in this sequence. Mention closing the loop, be direct and concise.',
      'sales-final':          'Write a post-meeting recap email for a construction / retail prospect. Include 2-3 next steps and any deliverables.',
      // Investor (equity)
      'investor-initial':     'You are writing as founder of Ultimo Trading Company Limited (sokogate.com). Write a professional Series-A pitch email: problem, traction (10K customers, $600K revenue, 90% repeat), TAM, $1.5M ask.',
      'investor-followup':    'Write a brief investor follow-up. Reference the last message, share one new metric, state the next step.',
      'investor-meeting-request': 'Write an email requesting a 30-minute intro call with an impact investor. Briefly restate value proposition and confirm availability.',
      // Funding (debt / structured finance for Ultimo Trading Co.)
      'funding-initial':      'You are the founder of Ultimo Trading Company Limited. Write a pitch email to a trade-finance provider / bank / structured-credit fund. State the company, revenue ($600K+), audited financials, and the specific facility requested (USD <amount>, tenor).',
      'funding-followup':     'Write a trade-finance / working-capital follow-up. Be direct and specific — attach any requested financials or confirm next step.',
      'funding-term-sheet':   'Write a term-sheet response email — confirming receipt, stating which clauses require discussion, and proposing a date to negotiate.',
      // Partnership
      'partner-initial':      'Write a strategic partnership outreach for Sokogate / Ultimo Trading. Offer a distribution / supplier / logistics / 3PL partnership. Mention revenue models and ask for a scoping call.',
      'partner-followup':     'Write a partnership follow-up. Reference the call that happened and propose the next action item.',
    };

    return defaults[templateType] || 'Write a professional business email.';
  }

  /**
   * Parse generated message into subject and body
   */
  private parseGeneratedMessage(text: string): { subject?: string; body: string } {
    const parts = text.split('---');
    
    if (parts.length >= 2) {
      const subjectLine = parts[0].replace('SUBJECT:', '').trim();
      const body = parts[1].trim();
      return { subject: subjectLine, body };
    }
    
    return { body: text.trim() };
  }

  /**
   * Get template type based on contact and context
   */
  private getTemplateType(contactType: ContactType, context: MessageContext): string {
    const { is_first_contact, days_since_last_contact, contact_type: cType } = context;

    if (is_first_contact) {
      return `${cType}-initial`;
    }

    if (days_since_last_contact !== undefined) {
      if (days_since_last_contact >= 1 && days_since_last_contact < 7) {
        const fu1 = `${cType}-followup-1`;
        if (this.promptCache.has(fu1)) return fu1;
      } else if (days_since_last_contact >= 7) {
        const fu2 = `${cType}-followup-2`;
        if (this.promptCache.has(fu2)) return fu2;
      }
    }

    return `${cType}-initial`;
  }

  /**
   * Calculate personalization score
   */
  private calculatePersonalizationScore(message: string, context: MessageContext): number {
    let score = 0;
    
    // Check for company name
    if (message.includes(context.company)) score += 20;
    
    // Check for pain point
    if (context.pain_point && message.toLowerCase().includes(context.pain_point.toLowerCase())) {
      score += 20;
    }
    
    // Check for engagement angle
    if (context.engagement_angle && message.toLowerCase().includes(context.engagement_angle.toLowerCase())) {
      score += 20;
    }
    
    // Check for specific numbers/data
    if (/\d+%|\$\d+|KES\s*\d+/.test(message)) score += 20;
    
    // Check for decision maker
    if (context.decision_maker && message.includes(context.decision_maker)) {
      score += 20;
    }
    
    return Math.min(100, score);
  }

  /**
   * Health check
   */
  public async healthCheck(): Promise<boolean> {
    try {
      const response = await this.openai.chat.completions.create({
        model: agentConfig.ai.model,
        max_tokens: 10,
        messages: [{
          role: 'user',
          content: 'Hello',
        }],
      });
      return response.choices.length > 0;
    } catch (error) {
      logger.error('NVIDIA AI health check failed', { error });
      return false;
    }
  }
}

// Export singleton instance
export const personalizationService = PersonalizationService.getInstance();
export default personalizationService;

// Made with Bob
