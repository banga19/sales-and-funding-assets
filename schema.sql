-- Schema for Sokogate Agent System

CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT,
    parent_id TEXT,
    FOREIGN KEY (parent_id) REFERENCES categories(id)
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Contacts Table — CRM prospects, investors, and partners
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(12) NOT NULL,
  company TEXT NOT NULL DEFAULT ''::text,
  contact_name TEXT,
  email TEXT UNIQUE,
  phone TEXT,
  whatsapp TEXT,
  tier VARCHAR(2) NOT NULL DEFAULT 'T3',
  status TEXT NOT NULL DEFAULT 'Not Started',
  notes TEXT,
  location TEXT,
  annual_spend_kes NUMERIC(14,2),
  pain_point TEXT,
  engagement_angle TEXT,
  decision_maker_title TEXT,
  last_contact_date DATE,
  fund_name TEXT,
  ticket_size_usd_min NUMERIC(14,2),
  ticket_size_usd_max NUMERIC(14,2),
  geographic_focus TEXT,
  investment_thesis TEXT,
  decision_timeline_weeks INT,
  first_contact_date DATE,
  meetings_count INT NOT NULL DEFAULT 0,
  country TEXT,
  capability TEXT,
  interest_level TEXT,
  revenue_model TEXT,
  monthly_revenue_potential_usd NUMERIC(14,2),
  discovery_call_date DATE,
  proposal_sent_date DATE,
  proposal_signed_date DATE,
  institution_type TEXT,
  product_pitched TEXT,
  ticket_size_usd_requested NUMERIC(14,2),
  tenor_months INT,
  tenor_years INT,
  interest_rate_requested TEXT,
  collateral_available TEXT,
  audited_financials_available BOOLEAN NOT NULL DEFAULT false,
  bank_relationships TEXT,
  credit_rating TEXT,
  urgency TEXT,
  contact_person_title TEXT,
  emails_sent INT NOT NULL DEFAULT 0,
  outreach_status VARCHAR(50) NOT NULL DEFAULT 'none',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Additive columns that may already exist (safe re-runs)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS emails_sent INT NOT NULL DEFAULT 0;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS outreach_status VARCHAR(50) NOT NULL DEFAULT 'none';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_contacts_tier       ON contacts(tier);
CREATE INDEX IF NOT EXISTS idx_contacts_status     ON contacts(status);
CREATE INDEX IF NOT EXISTS idx_contacts_type       ON contacts(type);
CREATE INDEX IF NOT EXISTS idx_contacts_created_at ON contacts(created_at);

CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT,
    contact_info TEXT,
    location TEXT,
    rating REAL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT,
    description TEXT,
    price REAL,
    currency TEXT,
    supplier_id TEXT,
    category_id TEXT,
    url TEXT,
    image_url TEXT,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
    FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS market_leads (
    id TEXT PRIMARY KEY,
    company_name TEXT,
    contact_person TEXT,
    email TEXT,
    phone TEXT,
    product_interest TEXT,
    status TEXT DEFAULT 'new',
    notes TEXT,
    enriched_data JSONB,
    tier TEXT DEFAULT 'T1',
    type TEXT DEFAULT 'prospect',
    source TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS marketing_campaigns (
    id TEXT PRIMARY KEY,
    title TEXT,
    channel TEXT,
    content TEXT,
    status TEXT DEFAULT 'draft',
    launched_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS funding_leads (
    id TEXT PRIMARY KEY,
    investor_name TEXT,
    type TEXT,
    amount_range TEXT,
    status TEXT DEFAULT 'identified',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Feature Flags Table — durable runtime toggle state
-- Overrides the ENV default for the named feature key.
-- Each row: (key, value:bool, updated_at)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS feature_flags (
    key            TEXT PRIMARY KEY,
    value          BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_feature_flags_updated ON feature_flags(updated_at DESC);
