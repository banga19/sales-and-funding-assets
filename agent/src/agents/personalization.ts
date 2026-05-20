/**
 * personalization.ts
 *
 * PersonalizationService — LangChain-powered message generation and intent
 * analysis for Sokogate / Ultimo Trading Company Limited.
 *
 * Every LLM call flows through langchainService which uses ChatOpenAI
 * from @langchain/openai with the NVIDIA Nemotron model (LangChain v1.x).
 *
 * Retained functionality (parity with original):
 *  · generateMessage()  — subject + body for a contact
 *  · analyzeIntent()    — positive_interest / question / objection / unclear
 *  · generateResponse() — reply to an inbound message
 *  · healthCheck()      — NVIDIA API ping
 */

import { agentConfig } from '../config/agent.config';
import { logger, loggers } from '../utils/logger';
import { Contact, ContactType } from '../types/contact.types';
import { GeneratedMessage, MessageContext, Intent } from '../types/message.types';
import { readFileSync } from 'fs';
import { join } from 'path';
import { langchainService } from '../services/langchain.service';
import type { AIMessage } from '@langchain/core/messages';

/* ═══════════════════════════════════════════════════════════════════════════
 * PersonalizationService — all LLM calls via LangChain chains
 * ═══════════════════════════════════════════════════════════════════════════ */

class PersonalizationService {
  private promptCache: Map<string, string> = new Map();
  private static instance: PersonalizationService;

  private constructor() {}

  public static getInstance(): PersonalizationService {
    if (!PersonalizationService.instance) {
      PersonalizationService.instance = new PersonalizationService();
    }
    return PersonalizationService.instance;
  }

  /** Generate a personalised subject + body for a contact. */
  public async generateMessage(
    contact: Contact,
    context: MessageContext,
  ): Promise<GeneratedMessage> {
    try {
      const generated = await langchainService.generatePersonalizedMessage({
        contactName:  contact.contact_name || 'there',
        company:      contact.company || 'your team',
        contactType:  contact.type,
        tier:         contact.tier,
        isFirstContact: context.is_first_contact,
        painPoint:    context.pain_point,
        engagementAngle: context.engagement_angle,
        fundName:     context.fund_name,
        geographicFocus: context.geographic_focus,
        ticketRangeUsd: context.ticket_size_usd_min && context.ticket_size_usd_max
          ? `USD ${context.ticket_size_usd_min.toLocaleString()} – ${context.ticket_size_usd_max.toLocaleString()}`
          : undefined,
        investmentThesis: context.investment_thesis,
        country:      context.country,
        revenueModel: context.revenue_model,
        institutionType: context.institution_type,
        productPitched: context.product_pitched,
        ticketUsd:    context.ticket_size_usd_requested
          ? `USD ${context.ticket_size_usd_requested.toLocaleString()}`
          : undefined,
        tenor:        context.tenor_months
          ? `${context.tenor_months} months`
          : context.tenor_years
            ? `${context.tenor_years} years`
            : undefined,
        location:     context.location,
        annualSpend:  context.annual_spend_kes
          ? `KES ${context.annual_spend_kes.toLocaleString()}`
          : undefined,

        // ── LangChain conversation memory context ──────────────────────────────
        // Injected by orchestrator. ts / quick-send. service. ts via
        // buildContextWithMemory() from conversation-memory.service.ts
        previous_messages: context.previous_messages,
        conversation_summary: context.conversation_summary,
      });

      logger.info('Message generated via LangChain', {
        contactId:   contact.id,
        contactType: contact.type,
        template:    generated.templateUsed,
      });

      return {
        to:         contact.email || '',
        channel:    'email',
        subject:    generated.subject,
        body:       generated.body,
        template_used: generated.templateUsed,
        generated_at:  new Date(),
        personalization_score: this.calculatePersonalizationScore(generated.body, context),
      };
    } catch (error: any) {
      loggers.apiError('nvidia', error);
      throw new Error(`Failed to generate message: ${error.message}`);
    }
  }

  /** Analyse the intent of an inbound message. */
  public async analyzeIntent(
    messageContent: string,
    contact: Contact,
  ): Promise<Intent> {
    try {
      const result = await langchainService.classifyIntent({
        messageContent,
        companyName: (contact as any).company || 'a contact',
      });

      logger.info('Intent analyzed via LangChain', {
        contactId: contact.id,
        intent:    result.type,
        sentiment: result.sentiment,
        confidence: result.confidence,
      });

      return {
        type:              result.type,
        sentiment:         result.sentiment,
        confidence:        result.confidence,
        key_points:        result.key_points,
        suggested_action:  result.suggested_action,
        requires_escalation: result.confidence < 0.3,
      };
    } catch (error: any) {
      loggers.apiError('nvidia', error);

      return {
        type:              'unclear',
        sentiment:         'neutral',
        confidence:        0,
        key_points:        [],
        suggested_action:  'escalate_to_human',
        requires_escalation: true,
      };
    }
  }

  /** Generate a reply to an inbound message. */
  public async generateResponse(
    incomingMessage: string,
    contact: Contact,
    intent: Intent,
  ): Promise<string> {
    try {
      return await langchainService.generateReply({
        incomingMessage,
        companyName:  (contact as any).company || 'Unknown',
        intentType:   intent.type,
        intentSentiment: intent.sentiment,
        contactType:  contact.type,
      });
    } catch (error: any) {
      loggers.apiError('nvidia', error);
      throw new Error(`Failed to generate response: ${error.message}`);
    }
  }

  /** Build prompt template from file (kept for backward compat; LLM now in LangChain). */
  private loadPromptTemplate(templateType: string): string {
    if (this.promptCache.has(templateType)) {
      return this.promptCache.get(templateType)!;
    }

    try {
      const promptPath = join(__dirname, '../../prompts', `${templateType}.txt`);
      const prompt = readFileSync(promptPath, 'utf-8');
      this.promptCache.set(templateType, prompt);
      return prompt;
    } catch {
      logger.warn(`Prompt template not found: ${templateType}, using default`);
      return this.getDefaultPrompt(templateType);
    }
  }

  private getDefaultPrompt(templateType: string): string {
    const defaults: Record<string, string> = {
      'sales-initial':        'You are a sales representative for Sokogate, a B2B bulk sourcing platform. Write a professional, personalised email introducing our service and highlighting 15-20% cost savings.',
      'sales-followup-1':     'Write a friendly first follow-up. Keep it brief.',
      'sales-followup-2':     'Write a second follow-up — the final nudge. Mention closing the loop.',
      'sales-final':          'Write a post-meeting recap with 2-3 next steps.',
      'investor-initial':     'You are writing as founder of Ultimo Trading Company Limited. Series-A pitch: problem, traction, TAM, $1.5M ask.',
      'investor-followup':    'Write a brief investor follow-up. Share one new metric.',
      'investor-meeting-request': 'Request a 30-minute intro call with an impact investor.',
      'funding-initial':      'You are the founder of Ultimo Trading. Pitch trade-finance — revenue, audited financials, facility requested.',
      'funding-followup':     'Write a trade-finance follow-up. Be direct — confirm the next step.',
      'funding-term-sheet':   'Write a term-sheet response — confirm receipt and propose a date.',
      'partner-initial':      'Write a strategic partnership outreach for Sokogate. Offer distribution / supplier / logistics partnership.',
      'partner-followup':     'Write a partnership follow-up. Reference the call and propose a next action item.',
    };
    return defaults[templateType] || 'Write a professional business email.';
  }

  /** Parse LLM response into subject and body. */
  private parseGeneratedMessage(text: string): { subject?: string; body: string } {
    const stripped = text.replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '').trim();
    const sepIdx = stripped.indexOf('\n---\n');

    if (sepIdx !== -1) {
      const subjectLine = stripped.slice(0, sepIdx).replace(/^SUBJECT\s*:?\s*/i, '').trim();
      const body = stripped.slice(sepIdx + 5).trim();
      if (subjectLine) return { subject: subjectLine, body };
      return { body };
    }

    const subjectMatch = stripped.match(/^SUBJECT\s*:?\s*(.+?)(?:\n|$)/i);
    if (subjectMatch) {
      return {
        subject: subjectMatch[1].trim(),
        body:    stripped.replace(/^SUBJECT.*?\n/, '').trim(),
      };
    }
    return { body: stripped };
  }

  /** Get template type for a contact. */
  private getTemplateType(contactType: ContactType, context: MessageContext): string {
    const { is_first_contact } = context;
    return is_first_contact ? `${contactType}-initial` : `${contactType}-followup`;
  }

  /** Calculate 0-100 personalization score from generated body. */
  private calculatePersonalizationScore(message: string, context: MessageContext): number {
    let score = 0;
    const lower = message.toLowerCase();

    if (context.company && lower.includes(context.company.toLowerCase()))       score += 20;
    if (context.pain_point && lower.includes(context.pain_point.toLowerCase()))  score += 20;
    if (context.engagement_angle && lower.includes(context.engagement_angle.toLowerCase())) score += 20;
    if (/\d+[%$ks]|\$\d+|KES\s+\d/.test(message))                              score += 20;

    const dm  = (context as any).decision_maker || '';
    const dmt = (context as any).decision_maker_title || '';
    if (dm  && lower.includes(dm.toLowerCase()))  score += 20;
    if (!dm && dmt && lower.includes(dmt.toLowerCase())) score += 10;

    return Math.min(100, score);
  }

  /** NVIDIA API ping via LangChain. */
  public async healthCheck(): Promise<boolean> {
    try {
      const response = await langchainService.healthCheck();
      return response;
    } catch {
      return false;
    }
  }
}

const personalizationService = PersonalizationService.getInstance();
export default personalizationService;
export { PersonalizationService, personalizationService };
