import Anthropic from '@anthropic-ai/sdk';
import { agentConfig } from '../config/agent.config';
import { logger, loggers } from '../utils/logger';
import { Contact, ContactType } from '../types/contact.types';
import { GeneratedMessage, MessageContext, Intent } from '../types/message.types';
import { readFileSync } from 'fs';
import { join } from 'path';

class PersonalizationService {
  private claude: Anthropic;
  private static instance: PersonalizationService;
  private promptCache: Map<string, string> = new Map();

  private constructor() {
    this.claude = new Anthropic({
      apiKey: agentConfig.ai.apiKey,
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
      
      const response = await this.claude.messages.create({
        model: agentConfig.ai.model,
        max_tokens: agentConfig.ai.maxTokens,
        messages: [{
          role: 'user',
          content: prompt,
        }],
      });

      const content = response.content[0];
      const messageText = content.type === 'text' ? content.text : '';

      // Parse the generated message
      const parsed = this.parseGeneratedMessage(messageText);

      logger.info('Message generated', {
        contactId: contact.id,
        contactType: contact.type,
        template: context.is_first_contact ? 'initial' : 'followup',
      });

      return {
        to: contact.email || contact.whatsapp || '',
        channel: contact.email ? 'email' : 'whatsapp',
        subject: parsed.subject,
        body: parsed.body,
        template_used: this.getTemplateType(contact.type, context),
        generated_at: new Date(),
        personalization_score: this.calculatePersonalizationScore(parsed.body, context),
      };
    } catch (error: any) {
      loggers.apiError('claude', error);
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

      const response = await this.claude.messages.create({
        model: agentConfig.ai.model,
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: prompt,
        }],
      });

      const content = response.content[0];
      const analysisText = content.type === 'text' ? content.text : '{}';
      
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
      loggers.apiError('claude', error);
      
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
      const prompt = `You are a sales representative for Sokogate. A ${contact.type} named ${contact.company} sent this message:

"${incomingMessage}"

Intent detected: ${intent.type}
Sentiment: ${intent.sentiment}

Generate an appropriate response that:
1. Addresses their ${intent.type === 'question' ? 'question' : intent.type === 'objection' ? 'concern' : 'message'}
2. Maintains a professional but friendly tone
3. Moves the conversation forward
4. ${intent.type === 'positive_interest' ? 'Suggests scheduling a meeting' : 'Provides value'}

Keep the response concise (under 150 words).`;

      const response = await this.claude.messages.create({
        model: agentConfig.ai.model,
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: prompt,
        }],
      });

      const content = response.content[0];
      return content.type === 'text' ? content.text : '';
    } catch (error: any) {
      loggers.apiError('claude', error);
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

Context:
- First Contact: ${context.is_first_contact ? 'Yes' : 'No'}
${context.days_since_last_contact ? `- Days Since Last Contact: ${context.days_since_last_contact}` : ''}
${context.previous_messages?.length ? `- Previous Messages: ${context.previous_messages.length}` : ''}

Generate a personalized ${contact.type === 'prospect' ? 'sales' : contact.type === 'investor' ? 'investor pitch' : 'partnership'} message.

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
      'sales-initial': 'You are a sales representative for Sokogate, a B2B bulk sourcing platform. Write a professional, personalized email introducing our service and highlighting cost savings (15-20%).',
      'sales-followup-1': 'Write a friendly follow-up email checking if they received your previous message. Keep it brief and add value.',
      'sales-followup-2': 'Write a follow-up email with a case study or specific cost analysis to demonstrate value.',
      'investor-initial': 'Write a professional email to an investor introducing Sokogate and requesting a meeting to discuss Series A funding.',
      'partner-initial': 'Write a professional email proposing a strategic partnership opportunity.',
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
    if (context.is_first_contact) {
      return `${contactType}-initial`;
    }
    
    if (context.days_since_last_contact) {
      if (context.days_since_last_contact >= 5 && context.days_since_last_contact < 12) {
        return `${contactType}-followup-1`;
      } else if (context.days_since_last_contact >= 12) {
        return `${contactType}-followup-2`;
      }
    }
    
    return `${contactType}-initial`;
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
      const response = await this.claude.messages.create({
        model: agentConfig.ai.model,
        max_tokens: 10,
        messages: [{
          role: 'user',
          content: 'Hello',
        }],
      });
      return response.content.length > 0;
    } catch (error) {
      logger.error('Claude AI health check failed', { error });
      return false;
    }
  }
}

// Export singleton instance
export const personalizationService = PersonalizationService.getInstance();
export default personalizationService;

// Made with Bob
