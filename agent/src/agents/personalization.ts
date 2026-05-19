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
      const prompt = `You are a strict intent-classification engine. Analyze this response from "${(contact as any).company || 'a contact'}" and output ONLY a single JSON object — no extra words, no markdown, no code fences.

Message:
"${messageContent}"

Return EXACTLY this JSON shape and nothing else:
{
  "type": "positive_interest" | "question" | "objection" | "not_interested" | "out_of_office" | "unclear",
  "sentiment": "positive" | "neutral" | "negative",
  "confidence": 0.0,
  "key_points": ["..."],
  "suggested_action": "one-sentence action",
  "requires_escalation": false
}`;

      const response = await this.openai.chat.completions.create({
        model: agentConfig.ai.model,
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
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
      const roleDescriptor = ((): string => {
        switch (contact.type) {
          case 'prospect': return `sales representative for Sokogate`;
          case 'investor': return `fundraising lead on behalf of the founder of Ultimo Trading Company Limited (sokogate.com)`;
          case 'funding':  return `capital-raising advisor for Ultimo Trading Company Limited, trading as sokogate.com`;
          default:          return `business development lead for Sokogate / Ultimo Trading Company Limited`;
        }
      })();

      const intentLabel = intent.type === 'question'
        ? 'question'
        : intent.type === 'objection'
          ? 'concern'
          : intent.type === 'positive_interest'
            ? 'interest'
            : intent.type;

      const prompt = `You are a ${roleDescriptor}. ${(contact as any).company || 'The contact'} sent this message:

"${incomingMessage}"

Intent detected: ${intent.type}
Sentiment: ${intent.sentiment||'neutral'}
${(intent as any).key_points?.length ? 'Key points raised: ' + (intent as any).key_points.join('; ') + '\n' : ''}

Write a short, helpful, and natural reply that:
1. Addresses ${intentLabel} directly and specifically — do NOT give a generic stock reply.
2. Maintains a professional but warm, approachable tone.
3. Moves the conversation toward one clear next step (call, meeting, demo, or relevant document).
4. Keep it concise — no more than 150 words.

Only respond with the email body text. Do not add a subject line.`;

      const response = await this.openai.chat.completions.create({
        model: agentConfig.ai.model,
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      });

      return response.choices[0]?.message?.content?.trim() || '';
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

────────────────────────────────────────────────────────
STRICT RULES — READ FIRST
────────────────────────────────────────────────────────
1. You MUST use the contact's actual name in the first sentence and naturally again within the opening paragraph.
2. You MUST reference the company by name and the contact by name at least once each — never use generic placeholders.
3. Output STRICTLY the subject separated from the body by a line containing exactly three dashes and nothing else:  ---
4. Never include code fences, markdown, or any preamble before the SUBJECT line.
────────────────────────────────────────────────────────

Contact Information:
- Company: ${context.company}
- Contact Name: ${(context as any).contact_name || contact.contact_name || 'N/A'}
- Type: ${context.contact_type}
- Tier: ${context.tier}
${context.pain_point ? `- Pain Point: ${context.pain_point}` : ''}
${context.engagement_angle ? `- Personalised Opening Angle: ${context.engagement_angle}` : ''}
${context.annual_spend ? `- Annual Spend: KES ${context.annual_spend.toLocaleString()}` : ''}
${(context as any).decision_maker ? `- Decision Maker: ${(context as any).decision_maker}` : ''}

${context.contact_type === 'prospect' ? `
Additional Context:
- Location: ${(context as any).location || 'N/A'}
- Annual Spend: KES ${context.annual_spend_kes ? context.annual_spend_kes.toLocaleString() : 'N/A'}
- Decision Maker Title: ${(context as any).decision_maker_title || 'N/A'}
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

Generate a personalised, human-sounding ${contact.type === 'prospect' ? 'sales' : contact.type === 'investor' ? 'investor pitch' : contact.type === 'funding' ? 'funding / trade-finance pitch' : 'partnership'} message that does all of the following:
• Greet ${(context as any).contact_name || 'them'} by name on the first line.
• Reference their company "${context.company}" by name.
• Name-drop the specific pain point or engagement angle where it naturally fits.
• Lead with specific data or a concrete benefit relevant to their industry.
• End with a clear, low-friction next action.

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
    const separatorIndex = text.indexOf('\n---\n');
    if (separatorIndex !== -1) {
      const subjectLine = text.slice(0, separatorIndex).replace(/^SUBJECT:\s*/i, '').trim();
      const body = text.slice(separatorIndex + 5).trim();
      if (subjectLine) return { subject: subjectLine, body };
      return { body };
    }
    const subjectMatch = text.match(/^SUBJECT:\s*(.+?)(?:\n|$)/i);
    if (subjectMatch) {
      return { subject: subjectMatch[1].trim(), body: text.replace(/^SUBJECT:.*\n/, '').trim() };
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
    const lowerMessage = message.toLowerCase();

    // Company name mentioned
    if (context.company && lowerMessage.includes(context.company.toLowerCase())) score += 20;

    // Specific pain point referenced
    if (context.pain_point && lowerMessage.includes(context.pain_point.toLowerCase())) score += 20;

    // Engagement angle referenced
    if (context.engagement_angle && lowerMessage.includes(context.engagement_angle.toLowerCase())) score += 20;

    // Concrete data / numbers present
    if (/\d+[%$ks]|\$\d+|KES\s+\d/.test(message)) score += 20;

    // Decision maker name or title present
    const dm = context.decision_maker || '';
    const dmt = context.decision_maker_title || '';
    if (dm && lowerMessage.includes(dm.toLowerCase())) score += 20;
    if (!dm && dmt && lowerMessage.includes(dmt.toLowerCase())) score += 10;

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
