-- 003_add_contacts_table.sql
-- Maps precisely to contact.types.ts: Prospect | Investor | Partner | Funding
-- Run this once with:
--   psql $DATABASE_URL -f infra/docker/scraper/migrations/003_add_contacts_table.sql


CREATE TABLE IF NOT EXISTS contacts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type                VARCHAR(12) NOT NULL
                         CHECK (type IN ('prospect','investor','partner','funding')),
  company             TEXT  NOT NULL,
  contact_name        TEXT,
  email               TEXT,
  phone               TEXT,
  tier                VARCHAR(2) NOT NULL DEFAULT 'T3'
                         CHECK (tier IN ('T1','T2','T3','T4','T5','T6','T7','T8','T9')),
  status              TEXT NOT NULL DEFAULT 'Not Started'
                         CHECK (status IN (
                           'Not Started','Contacted','Responded','Negotiating',
                           'Closed Won','Closed Lost','Nurture',
                           'Term Sheet Sent','Due Diligence','Funding Confirmed'
                         )),
  notes               TEXT,
  -- Prospects
  location            TEXT,
  annual_spend_kes    NUMERIC(14,2),
  pain_point          TEXT,
  engagement_angle    TEXT,
  decision_maker_title TEXT,
  last_contact_date   DATE,
  -- Investors
  fund_name           TEXT,
  ticket_size_usd_min NUMERIC(14,2),
  ticket_size_usd_max NUMERIC(14,2),
  geographic_focus    TEXT,
  investment_thesis   TEXT,
  decision_timeline_weeks INTEGER,
  first_contact_date  DATE,
  meetings_count      INTEGER DEFAULT 0,
  -- Partners
  country             TEXT,
  capability          TEXT,
  interest_level      TEXT,
  revenue_model       TEXT,
  monthly_revenue_potential_usd NUMERIC(14,2),
  discovery_call_date DATE,
  proposal_sent_date  DATE,
  proposal_signed_date DATE,
  -- Funding
  institution_type    TEXT
    CHECK (institution_type IN (
      'trade_finance_bank','dfi','private_equity','family_office',
      'growth_equity','invoice_factoring','working_capital_fund',
      'trade_credit','other'
    )),
  product_pitched     TEXT
    CHECK (product_pitched IN (
      'invoice_factoring','revolving_credit','working_capital','loan',
      'growth_equity','trade_finance_lc','payables_financing'
    )),
  ticket_size_usd_requested   NUMERIC(14,2),
  tenor_months        INTEGER,
  tenor_years         INTEGER,
  interest_rate_requested  TEXT,
  collateral_available TEXT,
  audited_financials_available BOOLEAN DEFAULT FALSE,
  bank_relationships  TEXT,
  credit_rating       TEXT,
  urgency             TEXT
    CHECK (urgency IN ('immediate','this_quarter','this_year')),
  contact_person_title TEXT,
  -- audit
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scrape_schedule (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  frequency    TEXT NOT NULL CHECK (frequency IN ('hourly','daily','weekly','manual')),
  last_run_at  TIMESTAMPTZ,
  next_run_at  TIMESTAMPTZ,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_price_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES scraped_products(id) ON DELETE CASCADE,
  price       NUMERIC(12,2) NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'KES',
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_product_price_history_product ON product_price_history(product_id, observed_at DESC);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_contacts_updated_at') THEN
    EXECUTE 'CREATE TRIGGER update_contacts_updated_at BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_scrape_schedule_updated_at') THEN
    EXECUTE 'CREATE TRIGGER update_scrape_schedule_updated_at BEFORE UPDATE ON scrape_schedule FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()';
  END IF;
END $$;

COMMENT ON TABLE  contacts          IS 'Core CRM: one row per prospect / investor / partner / funding target';
COMMENT ON TABLE  scrape_schedule    IS 'Controls how often the automated product-scraping job runs';

