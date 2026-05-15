import { Channel, ContactType, Sentiment } from './contact.types';

// Intent Types
export type IntentType = 
  | 'positive_interest'
  | 'question'
  | 'objection'
  | 'not_interested'
  | 'out_of_office'
  | 'unclear';

export interface Intent {
  type: IntentType;
  sentiment: Sentiment;
  confidence: number;
  key_points: string[];
  suggested_action: string;
  requires_escalation: boolean;
}

// Message Generation Types
export interface MessageContext {
  company: string;
  tier: string;
  pain_point?: string;
  engagement_angle?: string;
  annual_spend?: number;
  decision_maker?: string;
  contact_type: ContactType;
  is_first_contact: boolean;
  days_since_last_contact?: number;
  previous_messages?: string[];
}

export interface GeneratedMessage {
  to: string;
  channel: Channel;
  subject?: string;
  body: string;
  template_used: string;
  generated_at: Date;
  personalization_score?: number;
}

// Template Types
export type TemplateType = 
  | 'sales-initial'
  | 'sales-followup-1'
  | 'sales-followup-2'
  | 'sales-final'
  | 'investor-initial'
  | 'investor-followup'
  | 'investor-meeting-request'
  | 'partner-initial'
  | 'partner-followup'
  | 'meeting-invitation'
  | 'meeting-reminder'
  | 'objection-response';

export interface MessageTemplate {
  id: string;
  name: string;
  type: TemplateType;
  contact_type: ContactType;
  subject_template?: string;
  body_template: string;
  variables: string[];
  channel: Channel;
  created_at: Date;
}

// Response Handling Types
export interface IncomingMessage {
  from: string;
  channel: Channel;
  subject?: string;
  body: string;
  received_at: Date;
  metadata?: Record<string, any>;
}

export interface MessageResponse {
  success: boolean;
  message_id?: string;
  error?: string;
  delivered_at?: Date;
}

// Made with Bob
