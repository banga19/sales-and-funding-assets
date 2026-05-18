// Contact Types
export type ContactType = 'prospect' | 'investor' | 'partner' | 'funding';

export type ContactTier = 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7' | 'T8' | 'T9';

export type ContactStatus =
  | 'Not Started'
  | 'Contacted'
  | 'Responded'
  | 'Negotiating'
  | 'Closed Won'
  | 'Closed Lost'
  | 'Nurture'
  | 'Term Sheet Sent'
  | 'Due Diligence'
  | 'Funding Confirmed';

export interface BaseContact {
  id: string;
  type: ContactType;
  company: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  tier: ContactTier;
  status: ContactStatus;
  notes?: string;
  created_at: Date;
  updated_at: Date;
}

export interface Prospect extends BaseContact {
  type: 'prospect';
  location?: string;
  annual_spend_kes?: number;
  pain_point?: string;
  engagement_angle?: string;
  decision_maker_title?: string;
  last_contact_date?: Date;
}

export interface Investor extends BaseContact {
  type: 'investor';
  fund_name?: string;
  ticket_size_usd_min?: number;
  ticket_size_usd_max?: number;
  geographic_focus?: string;
  investment_thesis?: string;
  decision_timeline_weeks?: number;
  first_contact_date?: Date;
  meetings_count?: number;
}

export interface Partner extends BaseContact {
  type: 'partner';
  country?: string;
  title?: string;
  capability?: string;
  interest_level?: string;
  revenue_model?: string;
  monthly_revenue_potential_usd?: number;
  first_contact_date?: Date;
  discovery_call_date?: Date;
  proposal_sent_date?: Date;
  proposal_signed_date?: Date;
}

/**
 * Funding contact — targets for trade-finance / working-capital / growth-equity
 * pitched by Ultimo Trading Company Limited (parent co. of sokogate.com).
 *
 * Used to separate equity-investor outreach (investor type) from
 * debt / structured-finance / working-capital outreach (funding type).
 */
export interface Funding extends BaseContact {
  type: 'funding';
  institution_type?:               // 'trade_finance_bank' | 'dfi' | 'private_equity' | 'family_office'
    'trade_finance_bank'
    | 'dfi'
    | 'private_equity'
    | 'family_office'
    | 'growth_equity'
    | 'invoice_factoring'
    | 'working_capital_fund'
    | 'trade_credit'
    | 'other';
  product_pitched?:                // 'invoice_factoring' | 'revolving_credit' | 'working_capital' | 'loan' | 'growth_equity'
    'invoice_factoring'
    | 'revolving_credit'
    | 'working_capital'
    | 'loan'
    | 'growth_equity'
    | 'trade_finance_lc'
    | 'payables_financing';
  ticket_size_usd_requested?: number;
  ticket_size_usd_min?: number;
  ticket_size_usd_max?: number;
  tenor_months?: number;
  tenor_years?: number;
  interest_rate_requested?: string; // e.g. '12% p.a.' or 'SOFR + 300bps'
  collateral_available?: string;     // receivables / inventory / personal guarantee
  audited_financials_available?: boolean;
  bank_relationships?: string;
  credit_rating?: string;
  urgency?: string;                  // 'immediate' | 'this_quarter' | 'this_year'
  contact_person_title?: string;     // head of trade finance, portfolio manager, etc.
}

export type Contact = Prospect | Investor | Partner | Funding;

export type ContactWithConversation = Contact & {
  conversation?: Conversation;
  last_message?: Message;
};

// Conversation Types
export type ConversationStage =
  | 'not_started'
  | 'contacted'
  | 'responded'
  | 'negotiating'
  | 'closed';

export type Sentiment = 'positive' | 'neutral' | 'negative' | 'unknown';

export interface Conversation {
  id: string;
  contact_id: string;
  contact_type: ContactType;
  current_stage: ConversationStage;
  last_message_date?: Date;
  last_message_channel?: Channel;
  response_count: number;
  sentiment: Sentiment;
  next_action?: string;
  next_action_date?: Date;
  escalation_required: boolean;
  escalation_reason?: string;
  created_at: Date;
  updated_at: Date;
}

// Message Types
export type Channel = 'email' | 'sms';

export type Direction = 'outbound' | 'inbound';

export interface Message {
  id: string;
  conversation_id: string;
  contact_id: string;
  contact_type: ContactType;
  channel: Channel;
  direction: Direction;
  subject?: string;
  content: string;
  template_used?: string;
  intent_detected?: string;
  sentiment?: Sentiment;
  sent_at: Date;
  delivered_at?: Date;
  opened_at?: Date;
  clicked_at?: Date;
  replied_at?: Date;
  error_message?: string;
  metadata?: Record<string, any>;
}

// Scheduled Action Types
export type ActionStatus = 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled';

export interface ScheduledAction {
  id: string;
  conversation_id: string;
  contact_id: string;
  contact_type: ContactType;
  action_type: string;
  scheduled_for: Date;
  executed_at?: Date;
  status: ActionStatus;
  retry_count: number;
  max_retries: number;
  error_message?: string;
  metadata?: Record<string, any>;
  created_at: Date;
}

// Agent Metrics Types
export interface AgentMetric {
  id: string;
  date: Date;
  metric_name: string;
  metric_value: number;
  contact_type?: ContactType;
  tier?: ContactTier;
  channel?: Channel;
  metadata?: Record<string, any>;
  recorded_at: Date;
}

// Made with Bob
