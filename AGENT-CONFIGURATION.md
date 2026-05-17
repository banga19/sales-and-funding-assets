# Agent Configuration Guide — Sales, Investor, Funding & Product Agent

This document describes the four autonomous pipelines built into the Sokogate / Ultimo
Trading Company Limited AI agent (`agent/` directory).

---

## Pipeline Overview

| Pipeline          | Contact Type  | Primary Goal                              | Channel  |
|-------------------|---------------|-------------------------------------------|----------|
| **Sales**         | `prospect`    | B2B bulk-sourcing sign-ups / pilots       | Email    |
| **Investor**      | `investor`    | Series-A equity fundraising               | Email    |
| **Funding**       | `funding`     | Trade-finance / working-capital for Ultimo| Email    |
| **Partnership**   | `partner`     | Distribution, 3PL, supplier, retailer     | Email    |

All four pipelines share:
- Claude AI (Anthropic) for message generation and intent analysis
- Resend for email delivery
- Supabase / PostgreSQL for CRM storage
- A shared contact, conversation, message, and scheduled-actions DB schema

---

## Contact Type Definitions

| Field         | Department Manager | Address              | Registered Office |
|---------------|--------------------|----------------------|-------------------|
| Ultimo Trading Company Limited | 340 Natalya Besymyannyj Prospekt | 303040 Kaliningrad | Russia               |
| Sokogate.com  | Sokogate – Ultimate Trading Ltd               | All documents are legally binding and overseen by Ultimo Trading Company Limited |

**Strategy note:**  
"Sokogate is a product brand of Ultimo Trading Company Limited. All funding,
partnerships, and regulatory considerations are handled at the parent-company level."
This ensures:
- Investor / banker communications go to the full legal entity
- Trade finance / credit lines are underwritten against Ultimo Trading balance sheet
- Email outreach from founder@sokogate.com confirms Ultimo Trading affiliation

---

## Prompt Templates (`agent/prompts/`)

| File                  | Role                   | Description                                       |
|-----------------------|------------------------|---------------------------------------------------|
| `sales-initial.txt`   | Sales — first contact   | Cold prospecting for procurement savings            |
| `sales-followup-1.txt`| Sales — first nudge     | First follow-up with a new data point              |
| `sales-followup-2.txt`| Sales — last nudge      | Second follow-up; final message in series           |
| `sales-final.txt`     | Sales — post-meeting    | Recap, deliverable, next steps                     |
| `investor-initial.txt`| Investor — equity       | Series-A pitch (Sokogate / Ultimo Trading team)    |
| `investor-followup.txt`| Investor — follow-up   | Post-pitch nudge, updates                          |
| `funding-initial.txt` | Funding — debt/trade    | Trade-finance / working-capital pitch (Ultimo parent)|
| `funding-followup.txt`| Funding — follow-up    | Finance desk follow-up                             |
| `partner-initial.txt` | Partnership — BD        | Distribution / logistics / 3PL partnership pitch   |
| `partner-followup.txt`| Partnership — follow-up| Post-call BD nudge                                 |

---

## TypeScript Types

### `Contact` union

```ts
type Contact = Prospect | Investor | Partner | Funding;
```

### `ContactType` enum

```ts
type ContactType = 'prospect' | 'investor' | 'partner' | 'funding';
```

### `Funding` — new interface

```ts
interface Funding extends BaseContact {
  type: 'funding';
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
```

### `TemplateType` enum

```ts
type TemplateType =
  // Sales
  | 'sales-initial' | 'sales-followup-1' | 'sales-followup-2' | 'sales-final'
  // Investor (equity)
  | 'investor-initial' | 'investor-followup' | 'investor-meeting-request'
  // Funding (Ultimo Trading — structured finance)
  | 'funding-initial' | 'funding-followup' | 'funding-term-sheet'
  // Partnership
  | 'partner-initial' | 'partner-followup'
  // Meeting / response
  | 'meeting-invitation' | 'meeting-reminder' | 'meeting-followup' | 'objection-response';
```

---

## Agent Feature Flags

Add to `agent/.env`:

| Flag                          | Default | Description                              |
|-------------------------------|---------|------------------------------------------|
| `ENABLE_SALES_OUTREACH`       | `true`  | Prospect / construction batch outreach    |
| `ENABLE_INVESTOR_OUTREACH`    | `true`  | Equity Series-A batch outreach            |
| `ENABLE_FUNDING_OUTREACH`     | `true`  | Utimo trade-finance / working-capital batch |
| `ENABLE_PARTNERSHIP_OUTREACH` | `true`  | Partnership / distribution batch outreach |
| `ENABLE_PRODUCT_SOURCING`     | `true`  | Autonomous sokogate.com scraping          |
| `ENABLE_FUNDING_DIGEST`       | `true`  | Funding pipeline digest endpoint           |

---

## Daily Outreach Targets

Set in `agent/.env`:

```
DAILY_SALES_OUTREACH_TARGET=20
DAILY_INVESTOR_OUTREACH_TARGET=8
DAILY_FUNDING_OUTREACH_TARGET=10
DAILY_PARTNERSHIP_OUTREACH_TARGET=5
```

All targets are wired into `agent/src/config/agent.config.ts` → `outreachTargets`.

---

## Orchestrator API

The orchestrator (`agent/src/agents/orchestrator.ts`) exposes four batch methods
and one funding digest:

| Method                        | Route                                   | Description                         |
|-------------------------------|-----------------------------------------|-------------------------------------|
| `runSalesOutreach(limit)`     | `POST /api/agent/sales/trigger`          | Prospect / construction batch       |
| `runInvestorOutreach(limit)`  | `POST /api/agent/investor/trigger`        | Equity investor batch               |
| `runFundingOutreach(limit)`   | `POST /api/agent/funding/trigger`         | Ultimo Trading trade-finance batch  |
| `runPartnershipOutreach(limit)`| `POST /api/agent/partnership/trigger`     | Partnership / BD batch              |
| `getFundingPipelineSummary()` | `GET  /api/agent/funding/digest?days=N`   | Funding pipeline stats              |

All are also individually FDA-available via `GET /api/agent/funding/digest`.

---

## Product Sourcing — Sokogate.com Scraper

| Item                        | Detail                     |
|-----------------------------|---------------------------|
| Scrape engine               | Axios + Cheerio           |
| Schedules                   | Daily via `startAutoSource(hours: 24)` |
| Auto-schedule flag          | `ENABLE_AUTO_PRODUCT_SOURCING` |
| Scraping interval env var   | `AUTO_SOURCE_INTERVAL_HOURS` (default 24h) |
| Product DB target table     | `scraped_products` (PostgreSQL) |
| Scrape run audit table      | `scrape_runs` |
| HTTP trigger endpoint       | `POST /api/products/scrape` |
| Status endpoint             | `GET  /api/products/scrape/status` |
| Product listing endpoint    | `GET  /api/products` |

---

## Ultimo Trading Company — Funding Entity Note

All funding-related outreach (initial, follow-up, term sheet) is pitched on behalf
of **Ultimo Trading Company Limited** — the parent and legal owner of **sokogate.com**.

- **Legal name**: Ultimo Trading Company Limited
- **Operating asset**: Sokogate B2B sourcing platform
- **Registered office**: [insert jurisdiction]
- **Registration No.**: [insert]
- **Audited financials**: FY2025 [firm]

When writing funding templates:
1. Lead with Ultimo Trading Company Limited as the company
2. Reference sokogate.com as the growth engine / operating asset
3. Cite audited-income-statement figures (never unaudited projections)
4. Reference balance-sheet capacity (inventory, receivables, LCs)

---

## Quick-Start Commands

```bash
# 1. Copy env and fill in keys
cp agent/.env.example agent/.env

# 2. Install deps
cd agent && npm install

# 3. Database setup (run migrations)
npm run migrate

# 4. Build
npm run build

# 5. Dry-run all four pipelines (no emails sent)
AGENT_DRY_RUN=true npm start

# 6. Production
npm start
```

---

## Environment Variable Reference

| Variable                           | Pipeline                    |
|-------------------------------------|-----------------------------|
| `ANTHROPIC_API_KEY`                 | All (Claude AI)             |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | Email delivery         |
| `DATABASE_URL`                      | All (CRM DB)                |
| `REDIS_URL`                         | Rate limiting / queues      |
| `ESCALATION_EMAIL`                  | All (human override)        |

---

## Troubleshooting

### Pipeline sends too many or too few contacts
Check `outreachTargets` in `agentConfig` or verify `status` field in
`contacts` table — contacts in `Closed Won` / `Closed Lost` / `Nurture`
are excluded automatically.

### Funding template ignores institution type
Ensure `institution_type` and `product_pitched` are set in the `contacts`
row for that `Funding` record — these fields are injected into the
context block for Claude AI.

### No products appear in `/api/products`
Run a manual scrape: `POST /api/products/scrape`. Check `scraped_products`
has rows: `SELECT COUNT(*) FROM scraped_products;`.

---

**Config version**: 2.0  
**Last updated**: May 2026  
**Maintainer**: Sokogate Technical Team
