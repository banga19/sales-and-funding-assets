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
  previous_messages?: { role: 'user' | 'assistant'; content: string; intent?: string }[];
  conversation_summary?: string;

  // ── Prospect / Sales ────────────────────────────────────────────────────────
  location?: string;
  annual_spend_kes?: number;
  decision_maker_title?: string;

  // ── Investor ────────────────────────────────────────────────────────────────
  fund_name?: string;
  ticket_size_usd_min?: number;
  ticket_size_usd_max?: number;
  geographic_focus?: string;
  investment_thesis?: string;
  decision_timeline_weeks?: number;
  meetings_count?: number;

  // ── Partner ─────────────────────────────────────────────────────────────────
  country?: string;
  capability?: string;
  interest_level?: string;
  revenue_model?: string;
  monthly_revenue_potential_usd?: number;

  // ── Funding (Ultimo Trading — trade finance / working capital) ───────────────
  institution_type?: 'trade_finance_bank' | 'dfi' | 'private_equity' | 'family_office'
    | 'growth_equity' | 'invoice_factoring' | 'working_capital_fund' | 'trade_credit' | 'other';
  product_pitched?: 'invoice_factoring' | 'revolving_credit' | 'working_capital'
    | 'loan' | 'growth_equity' | 'trade_finance_lc' | 'payables_financing';
  ticket_size_usd_requested?: number;
  tenor_months?: number;
  tenor_years?: number;
  interest_rate_requested?: string;
  collateral_available?: string;
  audited_financials_available?: boolean;
  bank_relationships?: string;
  credit_rating?: string;
  urgency?: string;
  contact_person_title?: string;
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

// Template Types — covers all four agent roles
export type TemplateType =
  // ── SALES PROSPECT ─────────────────────────────────────────────────────────
  | 'sales-initial'
  | 'sales-followup-1'
  | 'sales-followup-2'
  | 'sales-final'
  // ── INVESTOR (equity / Series A) ───────────────────────────────────────────
  | 'investor-initial'
  | 'investor-followup'
  | 'investor-meeting-request'
  // ── FUNDING (debt / structured finance for Ultimo Trading Co.) ─────────────
  | 'funding-initial'
  | 'funding-followup'
  | 'funding-term-sheet'
  // ── PARTNERSHIP ────────────────────────────────────────────────────────────
  | 'partner-initial'
  | 'partner-followup'
  // ── MEETING & RESPONSE ─────────────────────────────────────────────────────
  | 'meeting-invitation'
  | 'meeting-reminder'
  | 'meeting-followup'
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
  previewUrl?: string;
}

// Funding Pipeline Types
export interface FundingPipelineSummary {
  total_pipeline_usd: number;
  by_institution_type: Record<string, number>;
  by_product_pitched: Record<string, number>;
  by_stage: Record<string, number>;
  next_actions_due_within_7d: number;
}

export interface FundingDigest {
  generated_at: string;
  period_days: number;
  contacts_at_stage: {
    contacted_awaiting_reply:     FundingContact[];
    responded_engaged:            FundingContact[];
    term_sheet_sent:              FundingContact[];
    due_diligence:                FundingContact[];
    funding_confirmed:            FundingContact[];
    closed_lost:                  FundingContact[];
  };
  summary: FundingPipelineSummary;
}

export interface FundingContact {
  id: string;
  institution_name: string;
  contact_name: string;
  contact_email: string;
  institution_type: string;
  product_pitched: string;
  ticket_size_usd_requested: number | null;
  tenor_months: number | null;
  status: string;
  last_contact_date: string | null;
  next_action: string | null;
  notes: string | null;
}

// Made with Bob
