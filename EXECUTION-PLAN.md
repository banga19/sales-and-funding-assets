# SOKOGATE SALES & FUNDING ASSETS — COMPREHENSIVE EXECUTION PLAN

**Project**: sales-and-funding-assets  
**Location**: `/home/apop/sales-and-funding-assets/`  
**Created**: May 11, 2026  
**Status**: Strategic documentation ready — requires operationalization  
**Environment**: WSL2 Ubuntu-24.04  

---

## EXECUTIVE SUMMARY

The `sales-and-funding-assets` project contains a complete business development playbook for Sokogate, comprising:

- **8 strategic documents** (pitch decks, prospect lists, templates, action plans)
- **4 CSV trackers** (investors, prospects, partnerships, metrics dashboard)
- **45+ qualified sales prospects** (Kenya construction companies)
- **25+ investor targets** (East Africa impact funds)
- **18+ partnership opportunities** (West Africa distributors)
- **30-day execution calendar** with daily checklists

**Current State**: Documentation Complete ✓ — Execution Phase Pending  
**Primary Objective**: Transform strategic assets into operational reality within 30 days  
**Secondary Objective**: Integrate with existing Sokogate AI codebase for workflow automation  
**Success Criteria**: 3+ pilots signed, 1+ term sheet, 1+ partnership agreement by June 11, 2026

---

## 1. DIRECTORY AUDIT & ASSET INVENTORY

### 1.1 File Structure Overview

```
sales-and-funding-assets/
├── Strategic Documentation (Markdown)
│   ├── 00-MASTER-SUMMARY.md                    (12 KB) — Overview + quick reference
│   ├── 01-KENYA-CONSTRUCTION-PROSPECTS.md      (15 KB) — 45 sales prospects, Tier 1-9
│   ├── 02-SERIES-A-INVESTORS-EAST-AFRICA.md    (17 KB) — 25 investors, Tier 1-6
│   ├── 03-INVESTOR-PITCH-DECK-OUTLINE.md       (19 KB) — 15-slide deck structure
│   ├── 04-WEST-AFRICA-DISTRIBUTION-PARTNERS.md (21 KB) — 18 partners, Tier 1-5
│   ├── 05-SALES-OUTREACH-TEMPLATES.md          (12 KB) — Email/phone templates
│   ├── 06-PITCH-DECK-FIRST-DRAFT.md            (35 KB) — Full slide content (Google Slides ready)
│   ├── 07-PARTNERSHIP-PROPOSAL-TEMPLATE.md     (16 KB) — Partnership agreements
│   ├── 08-30-DAY-ACTION-PLAN.md               (15 KB) — Weekly/daily execution calendar
│   └── EXECUTION-KIT.md                        (16 KB) — Usage guide + quick start
├── Operational Trackers (CSV)
│   ├── TRACKER-INVESTORS.csv                   (3.5 KB) — 25 investors with metadata
│   ├── TRACKER-PROSPECTS.csv                   (6.6 KB) — 45 prospects with contact data
│   ├── TRACKER-PARTNERSHIPS.csv                (2.5 KB) — 18 partners with pipeline
│   └── METRICS-DASHBOARD.csv                   (1.0 KB) — Weekly metrics template
└── Supporting Files
    └── WEEK1-LIVE-TRACKER.md                   (11 KB) — Daily task checklist

Total: 15 files, ~200 KB, 100% Markdown + CSV (no proprietary formats)
```

### 1.2 Asset Types & Technical Assessment

| Category | Count | Format | Status | Action Required |
|----------|-------|--------|--------|----------------|
| **Strategy Docs** | 9 | Markdown | Complete | Organize + link |
| **Prospect Lists** | 4 | CSV | Raw data | Import to CRM |
| **Email Templates** | 1 | Markdown | Ready | Personalize + automate |
| **Pitch Deck** | 2 | Markdown (→ Google Slides) | Needs build | Create slides |
| **Action Plans** | 2 | Markdown | Ready | Schedule + track |
| **Metrics Tracking** | 1 | CSV | Template | Automate reporting |

### 1.3 Dependencies & Ecosystem Context

**WSL2 Ubuntu-24.04 Environment**:
- OS: Ubuntu 24.04 LTS (WSL2)
- Shell: Bash (default)
- Git: 2.43.0 ✓
- Node.js: v20.20.2 (via nvm) ✓
- Python: 3.12.3 ✓
- Available package managers: npm, yarn (optional), pip

**Co-located Projects** (same user home):
- `/home/apop/sokogate-ai/` — Full-stack AI web/mobile app (React, Next.js, Expo)
- `/home/apop/sokogate-calc/` — Calculator app (Node.js backend)
- `/home/apop/sokobot-ai/` — Telegram/slack bot integration

**Integration Opportunities**:
- Embed sales/pitch deck data into sokogate-ai web dashboard
- Automate investor/prospect tracking via API
- Sync CSV trackers to database (PostgreSQL/Neon)
- Add lead capture forms to sokogate-ai frontend
- Create automated email sequences using Twilio/Resend

### 1.4 Gap Analysis

**What We Have**:
- ✅ Complete strategic playbook (8 documents)
- ✅ Detailed prospect lists (45+ companies, 25+ investors, 18+ partners)
- ✅ Templates for outreach (email, phone, partnership proposals)
- ✅ 30-day execution timeline with daily tasks
- ✅ Metrics framework (KPIs defined)

**What We Need to Operationalize**:
- ⚠️ CRM system (not defined — use Google Sheets? HubSpot? Custom?)
- ⚠️ Email automation tool (Lemlist/HubSpot mentioned, not installed)
- ⚠️ Pitch deck in presentable format (Google Slides required, not built)
- ⚠️ Contact information enrichment (emails/phones missing for many prospects)
- ⚠️ Scheduling system (Calendly link not created)
- ⚠️ Database integration (CSV → live system)
- ⚠️ Team coordination (who executes? Solo founder or team?)
- ⚠️ Legal document preparation (term sheets, partnership agreements)

---

## 2. TECHNICAL ARCHITECTURE & TOOLING RECOMMENDATIONS

### 2.1 Recommended Tool Stack (WSL2 Ubuntu-24.04 Compatible)

| Function | Recommendation | Rationale | Installation |
|----------|----------------|-----------|--------------|
| **CRM** | HubSpot Free Tier | Built-in email tracking, pipelines, automation, integrates with Gmail | Web-based (no install) |
| **Email Tracking** | HubSpot Sales Hub or Mailtrack.io | Open/click tracking, templates, sequencing | Browser extension |
| **Scheduling** | Calendly (Free) | Automatic meeting booking, timezone aware | Web-based |
| **Document Collaboration** | Google Workspace (Docs/Sheets/Slides) | Real-time editing, templates, sharing | Web-based |
| **Project Management** | Trello or Asana Free | Kanban boards, task assignment, due dates | Web-based |
| **Database** | PostgreSQL (via Neon or Supabase) | If building custom CRM, link to sokogate-ai backend | `sudo apt install postgresql` or cloud |
| **Automation** | Zapier / Make (Integromat) | Connect CSV → CRM, email triggers, webhook automation | Web-based |
| **Presentation** | Google Slides | Pitch deck builder, presenter view, sharing | Web-based |
| **File Storage** | Google Drive / Dropbox | Centralized asset repository | Web-based |

**No heavy local installations required** — majority are SaaS tools accessible via browser.

### 2.2 Integration Points with Existing Sokogate Codebases

**sokogate-ai** (`/home/apop/sokogate-ai/`) integration opportunities:

1. **Lead Capture Dashboard**
   - Build admin panel to view prospect/ investor/ partner pipelines
   - Sync CSV data to PostgreSQL (existing Neon DB likely configured)
   - Display metrics from METRICS-DASHBOOT.csv in real-time charts

2. **Automated Email Sending**
   - Use existing Twilio integration (in sokogate-ai) for email/ SMS follow-ups
   - Resend API already in dependencies — could automate outreach sequences

3. **Investor Portal**
   - Password-protected section for investor updates
   - Share pitch deck, metrics, portfolio company news
   - Automate investor reporting (monthly)

4. **Partner/Prospect Self-Service**
   - Public landing page for partnership inquiries
   - Forms that populate TRACKER-PROSPECTS.csv automatically

**sokogate-calc** (`/home/apop/sokogate-calc/`) integration:
- Could embed ROI calculator for prospects (show 15-20% savings)
- Generate PDF quotes directly from platform

### 2.3 Environment Setup Checklist

**WSL2-Specific Considerations**:
- [ ] Ensure Ubuntu 24.04 packages updated: `sudo apt update && sudo apt upgrade`
- [ ] Install build essentials: `sudo apt install build-essential`
- [ ] Install PostgreSQL client: `sudo apt install postgresql-client` (if connecting to DB)
- [ ] Configure git user/email if not set: `git config --global user.name "Your Name"`
- [ ] Set up SSH keys for GitHub (if pushing code): `ssh-keygen -t ed25519`
- [ ] Install browser (already available in WSL2 via Windows integration)

**Node.js Version Management** (already installed via nvm):
```bash
node --version  # v20.20.2 ✓
npm --version   # should be 10.x
```

**Python Environment** (if needed for data processing):
```bash
python3 --version  # 3.12.3 ✓
pip3 install pandas  # for CSV manipulation
```

---

## 3. PHASED ROADMAP — 5 SPRINTS (30 DAYS TO FIRST MILESTONE)

### **SPRINT 0: FOUNDATION & TOOLING (DAYS 1-3)**
**Objective**: Set up operational infrastructure before outreach begins  
**Duration**: 3 days  
**Owner**: Founder/Operator  
**Deliverables**:
- [ ] Google Workspace setup (Gmail, Sheets, Slides, Drive folders)
- [ ] HubSpot CRM free tier account created + pipeline configured
- [ ] Calendly booking link generated (15-min slots)
- [ ] Email templates folder organized (5 templates personalized)
- [ ] Drive folder structure created:
  ```
  Sokogate-Sales-Funding/
  ├── 00-Strategic-Docs/ (original markdown files)
  ├── 01-Pitch-Deck/ (Google Slides + exports)
  ├── 02-CRM-Exports/ (CSV backups from HubSpot)
  ├── 03-Outreach-Templates/ (customized emails)
  ├── 04-Tracking/ (live metrics dashboard)
  └── 05-Legal/ (term sheets, agreements)
  ```
- [ ] CRM data entry: Import all 45 prospects + 25 investors + 18 partners into HubSpot
- [ ] Tracking spreadsheet: Set up live METRICS-DASHBOARD in Google Sheets (daily updates)
- [ ] Git commit: Initialize repo with README explaining structure

**Dependencies**:
- Internet access for SaaS tools
- Gmail account for outreach
- Google account for Drive/Slides

**Success Criteria**:
- All 88 contacts (45+25+18) loaded into HubSpot with proper labels
- Email templates ready to send (first batch of 10 personalized)
- Metrics dashboard live with Week 1 targets

---

### **SPRINT 1: SALES OUTREACH LAUNCH (DAYS 4-10)**
**Objective**: Send first 20 outreach emails (sales + partnerships), schedule discovery calls  
**Duration**: 7 days (overlaps with Sprint 0)  
**Owner**: Sales Lead (Founder)  
**Deliverables**:
- [ ] Day 4-5: Send 10 personalized emails to Tier 1 construction prospects (Britam, Tropical Heat, ACON, Tamarind, Kilimani + 5 more)
- [ ] Day 6-7: Send 5 partnership intro emails (Meridian Trust, Traders' Warehouse, Jospong, DHL, GNPC)
- [ ] Day 8-9: Send 5 investor cold emails (Catalyst Fund, Mulistar, Impact Ventures, Acacia, Verod)
- [ ] Day 10: Follow-up sequence triggered for non-responders (Day 5 follow-up template)
- [ ] LinkedIn outreach: 15 connection requests with personalized notes
- [ ] Discovery calls scheduled: Target 5-7 calls for Week 2
- [ ] CRM updated: Every prospect status changed to "Contacted"

**KPI Targets**:
- Emails sent: 20+
- Response rate: ≥20% (4+ responses)
- Calls scheduled: 5+
- LinkedIn connections: 15+

**Risk Mitigation**:
- If low response (<10%), A/B test subject lines + email copy
- If emails bounce, use Hunter.io to find correct addresses
- If no calls booked, increase follow-up cadence (Day 1, 5, 12, 19)

---

### **SPRINT 2: PITCH DECK BUILD & FIRST INVESTOR MEETINGS (DAYS 11-17)**
**Objective**: Complete investor-ready pitch deck + conduct first 3 investor meetings  
**Duration**: 7 days  
**Owner**: Founder + Pitch Coach (if available)  
**Deliverables**:
- [ ] Google Slides pitch deck built (15 slides, per 06-PITCH-DECK-FIRST-DRAFT.md)
- [ ] Visual design: Apply Sokogate branding (colors, fonts, logo)
- [ ] Content customization: Replace [PLACEHOLDER] with actual data
- [ ] Add visuals: Charts, customer testimonials, product screenshots
- [ ] Practice delivery: 5+ full run-throughs (record yourself)
- [ ] Investor #1 meeting: Warm intro from advisor (Catalyst Fund priority)
- [ ] Investor #2 meeting: Cold email follow-up (Impact Ventures)
- [ ] Investor #3 meeting: Second warm intro (Mulistar)
- [ ] After each meeting: Send thank-you + full deck link
- [ ] Compile due diligence package start (cap table, financials, team bios)

**KPI Targets**:
- Pitch deck complete: 100%
- Investor meetings conducted: 3
- Follow-ups sent: 3
- Next meetings scheduled: 2+

**Quality Gates**:
- Deck reviewed by at least 1 advisor before first meeting
- All speaker notes polished
- Backup slides prepared (FAQ, detailed financials)
- Practice video recorded + self-critique completed

---

### **SPRINT 3: PILOT CLOSURE & PARTNERSHIP NEGOTIATION (DAYS 18-24)**
**Objective**: Close 2-3 sales pilots + advance 1 partnership to agreement  
**Duration**: 7 days  
**Owner**: Sales + BD Lead  
**Deliverables**:
- [ ] Pilot #1 signed: Britam Group or Tropical Heat (target KES 500K+ monthly spend)
- [ ] Pilot #2 signed: ACON Limited or Tamarind
- [ ] Pilot #3 verbally agreed: Pearl Construction or Flamingo Builders
- [ ] Partnership discovery call #1: Meridian Trust (Ghana)
- [ ] Partnership discovery call #2: Traders' Warehouse (Senegal)
- [ ] Send customized partnership proposal to top-choice partner
- [ ] Create pilot retailer list (50+ for Pilot #1)
- [ ] Prepare cost analysis template (1-page ROI for each prospect)
- [ ] Document: Customer testimonials from early adopters (if any)

**KPI Targets**:
- Pilots signed: 2-3
- Partnership proposals sent: 1
- Partnership calls completed: 2
- Total retailers in pipeline: 150+

**Risk Mitigation**:
- If prospects hesitate, offer risk-free pilot (first order refund guarantee)
- If partnership negotiations stall, pivot to secondary partner (Jospong or DHL)
- Use social proof: Share existing customer testimonials

---

### **SPRINT 4: SCALE & FUNDING MOMENTUM (DAYS 25-30)**
**Objective**: Demonstrate traction + secure term sheet  
**Duration**: 6 days  
**Owner**: Founder + CFO  
**Deliverables**:
- [ ] First orders fulfilled from Pilot #1 (10+ retailers)
- [ ] Capture testimonials + calculate actual savings (prove value)
- [ ] Case study 1-pager created (for social proof)
- [ ] Investor meeting #4: Full pitch + pilot results
- [ ] Due diligence package sent to interested investors (2+)
- [ ] Term sheet received from lead investor (Target: Catalyst Fund or Mulistar)
- [ ] Partnership agreement signed (Target: Meridian Trust)
- [ ] Metrics dashboard updated: Show 50+ active retailers, USD 10K+ MRR (pilot)
- [ ] Week 5 planning: Expand to 300 retailers, close funding

**KPI Targets**:
- Active retailers: 50+
- Pilot revenue MRR: USD 10K+
- Term sheets received: 1
- Partnership signed: 1
- Investor meetings: 4+

**Success Definition (30-Day Milestone)**:
✅ Minimum: 3 pilots signed + 1 term sheet + 1 partnership proposal  
✅ Stretch: 5 pilots + 2 term sheets + 1 partnership signed + 200+ retailers

---

## 4. DEPENDENCIES & ENVIRONMENT REQUIREMENTS

### 4.1 WSL2 Ubuntu-24.04 Specific Setup

**System Packages** (if building custom tools):
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install development tools (if needed)
sudo apt install -y build-essential git curl wget jq

# Install PostgreSQL (if local DB needed)
sudo apt install -y postgresql postgresql-contrib

# Install Python data tools (for CSV processing)
sudo apt install -y python3-pip
pip3 install pandas numpy openpyxl

# Install Node.js global tools (if needed)
npm install -g typescript ts-node nodemon
```

**Environment Variables** (create `~/.env.sokogate`):
```bash
# Google API credentials (if automating slides)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# HubSpot API (if integrating CRM)
HUBSPOT_API_KEY=...

# Database (if syncing to Postgres)
DATABASE_URL=postgresql://...

# Email/Communication
SENDGRID_API_KEY=...  # or Resend API key
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...

# Calendly
CALENDLY_API_KEY=...
```

**Network Considerations**:
- WSL2 shares Windows network — no special firewall rules typically
- Ensure Windows host allows outbound connections to SaaS tools (HubSpot, Google, Calendly)
- If behind corporate VPN, configure split-tunneling for WSL2

### 4.2 Service Dependencies

| Service | Purpose | Free Tier? | Account Needed |
|---------|---------|-----------|----------------|
| HubSpot CRM | Contact management + email tracking | Yes (free) | hubspot.com |
| Google Workspace | Slides, Sheets, Drive | Yes (personal) | gmail.com |
| Calendly | Scheduling | Yes (free) | calendly.com |
| Mailtrack/Lemlist | Email open tracking | Freemium | mailtrack.io |
| Zapier | Automation (CSV → CRM) | Yes (100 tasks/month) | zapier.com |
| Stripe/Payment | Pilot order processing | Yes | stripe.com |
| Twilio | SMS/voice follow-ups | Yes (trial credits) | twilio.com |
| Resend | Email sending API | Yes (free tier) | resend.com |

**Estimated Setup Time**: 2-4 hours (mostly signups + configuration)

### 4.3 Integration Dependencies

**sokogate-ai Backend Integration** (optional, Phase 2):
- Database: Neon PostgreSQL connection string already in sokogate-ai
- API routes: Could add `/api/prospects`, `/api/investors`, `/api/metrics`
- Authentication: Use existing NextAuth for admin dashboard

**Automation Scripts** (Python/Node.js):
- `scripts/csv-to-hubspot.js` — Import CSV to HubSpot API
- `scripts/daily-metrics.js` — Pull HubSpot data → update METRICS-DASHBOARD.csv
- `scripts/email-sender.js` — Send personalized bulk emails (via Resend API)
- `scripts/pitch-deck-generator.js` — Auto-generate customized slides

---

## 5. SPRINT BREAKDOWN — TASKS, OWNERS, TIMELINES

### **Sprint 0: Foundation & Tooling (Days 1-3)**

| Day | Task | Owner | Estimated Time | Output |
|-----|------|-------|---------------|--------|
| D1 | Create Google Workspace folder structure | Founder | 30 min | Organized Drive |
| D1 | Sign up for HubSpot CRM Free | Founder | 15 min | HubSpot account |
| D1 | Configure HubSpot pipelines (Sales, Investors, Partnerships) | Founder | 45 min | 3 pipelines |
| D1 | Create Calendly booking link (15-min slots) | Founder | 10 min | calendly.com/yourlink |
| D1 | Install Mailtrack browser extension | Founder | 5 min | Email tracking enabled |
| D1 | Create email templates in Gmail (drafts) | Founder | 30 min | 5 template drafts |
| D1 | Import CSV to HubSpot (via CSV import tool) | Founder | 45 min | 88 contacts loaded |
| D1 | Tag contacts by tier (T1, T2, T3) and type (prospect, investor, partner) | Founder | 30 min | Segmented lists |
| D2 | Build Google Sheets metrics dashboard | Founder | 1 hr | Live metrics tracker |
| D2 | Create Google Slides pitch deck skeleton | Founder | 1 hr | 15 blank slides |
| D2 | Copy content from 06-PITCH-DECK-FIRST-DRAFT.md into slides | Founder | 45 min | All text populated |
| D2 | Add branding (colors, fonts, logo) to slides | Founder | 30 min | Visual design |
| D2 | Record practice pitch (video) | Founder | 30 min | Self-review |
| D3 | Research missing contact info (Hunter.io, LinkedIn) | Founder | 1 hr | 20+ enriched records |
| D3 | Write personalized email intros for top 10 prospects | Founder | 45 min | 10 unique emails |
| D3 | Set up Zapier automation: CSV → HubSpot (optional) | Founder | 30 min | Auto-sync |
| D3 | Commit code to git repo | Founder | 15 min | Versioned assets |

**Total Sprint 0 Time**: ~8-9 hours  
**Go/No-Go Criteria**: All 88 contacts in CRM, email templates ready, pitch deck 90% done

---

### **Sprint 1: Sales Outreach Launch (Days 4-10)**

| Day | Task | Owner | Estimated Time | Output |
|-----|------|-------|---------------|--------|
| D4 | Send Batch 1: 5 Tier 1 sales emails | Founder | 30 min | Emails sent |
| D4 | Send LinkedIn connections (5 prospects) | Founder | 15 min | Requests sent |
| D5 | Send Batch 2: 5 Tier 2 sales emails | Founder | 30 min | Emails sent |
| D5 | Follow up on any responses received | Founder | 20 min | Responses logged |
| D6 | Send 3 partnership intro emails | Founder | 20 min | Emails sent |
| D6 | Research additional prospect contact info | Founder | 45 min | Enriched data |
| D7 | Send Batch 3: 5 Tier 3 sales emails | Founder | 30 min | Emails sent |
| D7 | Send 2 investor cold emails | Founder | 15 min | Emails sent |
| D8 | Follow-up sequence: Day 5 follow-ups for non-responders | Founder | 30 min | Follow-ups sent |
| D8 | Update HubSpot: Log all activities, change statuses | Founder | 20 min | CRM current |
| D9 | Discovery call #1 (if scheduled) | Founder | 30 min | Call notes |
| D9 | Discovery call #2 (if scheduled) | Founder | 30 min | Call notes |
| D10 | Discovery call #3 (if scheduled) | Founder | 30 min | Call notes |
| D10 | Weekly review: Count responses, adjust messaging | Founder | 45 min | Week 1 report |

**Total Sprint 1 Time**: ~6-7 hours  
**KPI Check** (EOD D10):
- [ ] 20+ emails sent
- [ ] 5+ calls scheduled
- [ ] 3+ email responses
- [ ] CRM fully updated

---

### **Sprint 2: Pitch Deck & Investor Meetings (Days 11-17)**

| Day | Task | Owner | Estimated Time | Output |
|-----|------|-------|---------------|--------|
| D11 | Finalize Google Slides pitch deck visuals | Founder | 1 hr | Deck complete |
| D11 | Practice pitch delivery (record + review) | Founder | 45 min | 2 practice runs |
| D12 | Request warm intros to 3 Tier 1 investors (email advisors) | Founder | 20 min | 3 intro requests |
| D12 | Send investor email #1 (Catalyst Fund) | Founder | 15 min | Email sent |
| D12 | Send investor email #2 (Mulistar) | Founder | 15 min | Email sent |
| D13 | Send investor email #3 (Impact Ventures) | Founder | 15 min | Email sent |
| D13 | Follow up on investor emails | Founder | 20 min | Follow-ups |
| D14 | Prepare due diligence package (outline) | Founder | 1 hr | Doc structure |
| D14 | First investor meeting (if scheduled) | Founder | 30 min | Meeting held |
| D15 | Send thank-you + deck link to investor #1 | Founder | 15 min | Follow-up sent |
| D15 | Refine pitch based on feedback | Founder | 30 min | Deck updated |
| D16 | Second investor meeting | Founder | 30 min | Meeting held |
| D17 | Third investor meeting | Founder | 30 min | Meeting held |
| D17 | Compile investor feedback + next steps | Founder | 30 min | Investor tracker updated |

**Total Sprint 2 Time**: ~6-8 hours  
**KPI Check** (EOD D17):
- [ ] Pitch deck finalized
- [ ] 3 investor meetings conducted
- [ ] 2+ meetings scheduled for next week
- [ ] Due diligence package started

---

### **Sprint 3: Pilot Closure & Partnerships (Days 18-24)**

| Day | Task | Owner | Estimated Time | Output |
|-----|------|-------|---------------|--------|
| D18 | Pilot #1 proposal email sent (with terms) | Founder | 30 min | Proposal sent |
| D18 | Follow-up call with hot prospect | Founder | 30 min | Verbal agreement |
| D19 | Pilot #2 proposal email sent | Founder | 30 min | Proposal sent |
| D19 | Create pilot retailer list (50+ names) | Founder | 45 min | Target list |
| D20 | Pilot #1 signed (PDF via email) | Founder | 30 min | Signed agreement |
| D20 | Onboarding call with Pilot #1 customer | Founder | 30 min | Kickoff |
| D21 | Partnership discovery call #1 (Meridian Trust) | Founder | 45 min | Call notes |
| D21 | Send partnership proposal (customized) | Founder | 30 min | Proposal sent |
| D22 | Partnership discovery call #2 (Traders' Warehouse) | Founder | 45 min | Call notes |
| D23 | Follow-up negotiation with partner | Founder | 30 min | Revised terms |
| D24 | Send final partnership agreement for signature | Founder | 30 min | Agreement sent |
| D24 | Prepare pilot launch checklist (logistics, pricing, onboarding) | Founder | 45 min | Launch plan |

**Total Sprint 3 Time**: ~6-7 hours  
**KPI Check** (EOD D24):
- [ ] 2-3 pilots signed
- [ ] 1 partnership proposal sent
- [ ] 50+ retailer targets identified
- [ ] Pilot operations ready

---

### **Sprint 4: Scale & Funding Momentum (Days 25-30)**

| Day | Task | Owner | Estimated Time | Output |
|-----|------|-------|---------------|--------|
| D25 | Fulfill first orders from Pilot #1 | Founder | 2 hrs | 5-10 retailers served |
| D26 | Collect first customer feedback + testimonials | Founder | 1 hr | 3+ quotes |
| D27 | Create case study 1-pager | Founder | 1 hr | PDF case study |
| D28 | Investor meeting #4 (with pilot data) | Founder | 30 min | Meeting + data |
| D29 | Send due diligence package to 2 interested investors | Founder | 1 hr | Package sent |
| D30 | Term sheet negotiation call (if applicable) | Founder | 45 min | Term sheet draft |
| D30 | Weekly metrics review + Week 5 planning | Founder | 45 min | Plan drafted |
| D30 | Update all trackers (CSV files + HubSpot) | Founder | 30 min | Data current |

**Total Sprint 4 Time**: ~7-8 hours  
**KPI Check** (EOD D30):
- [ ] 50+ active retailers in pilots
- [ ] USD 10K+ pilot MRR (if revenue started)
- [ ] 1 term sheet received (minimum)
- [ ] 1 partnership signed
- [ ] 4 investor meetings completed

---

## 6. RISK MANAGEMENT & CONTINGENCY PLANS

### 6.1 Identified Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Low email response rate** (<10%) | Medium | High | A/B test subject lines, increase volume to 30+/week, leverage warm intros |
| **Investor meetings fall through** | Medium | High | Build pipeline of 10+ investors, engage angel networks as backup, bootstrap from pilot revenue |
| **Pilot customers delay signature** | Medium | Medium | Offer time-limited incentives (first month 50% off), simplify agreement |
| **Partnership negotiations stall** | Medium | Medium | Approach backup partners from Tier 2 list, adjust revenue share terms |
| **CRM/data fragmentation** | Low | Medium | Daily discipline: log every interaction before end of day |
| **Tooling setup delays** | Low | Low | Use manual Google Sheets as fallback if HubSpot setup delayed |
| **Founder bandwidth constraints** | High | High | Block 2-3 hours/day exclusively for sales/fundraising, no meetings on focus days |

### 6.2 Escalation Triggers

- **No responses after 50 emails** → Review subject lines + value proposition, consult advisor
- **No calls booked after 2 weeks** → Increase touchpoints, try cold calling, request warm intros
- **No pilots after 3 weeks** → Offer deeper discount/free pilot, revisit pricing
- **No investor meetings after 1 week** → Pivot to angel networks, consider pitch deck rewrite
- **CRM not updated for 3+ days** → Set calendar reminder, make it non-negotiable daily habit

---

## 7. SUCCESS METRICS & TRACKING

### 7.1 Weekly KPI Dashboard (Update Every Friday)

**Metrics to Track Daily** (in Google Sheets METRICS-DASHBOARD.csv):

```
WEEK | DATE | METRIC | TARGET | ACTUAL | STATUS
-----|------|--------|--------|--------|--------
1    | May 11 | Sales emails sent | 10 | ... | ⬜/✅
1    | May 11 | Partnership emails sent | 2 | ... | ⬜/✅
1    | May 11 | Investor emails sent | 5 | ... | ⬜/✅
1    | May 11 | Responses received | 3 | ... | ⬜/✅
1    | May 11 | Calls scheduled | 3 | ... | ⬜/✅
2    | May 18 | Discovery calls completed | 6 | ... | ⬜/✅
2    | May 18 | Pilots verbally agreed | 2 | ... | ⬜/✅
2    | May 18 | Investor meetings | 3 | ... | ⬜/✅
3    | May 25 | Pilots signed | 3 | ... | ⬜/✅
3    | May 25 | Retailers acquired | 50 | ... | ⬜/✅
4    | Jun 1  | Total retailers | 300 | ... | ⬜/✅
4    | Jun 1  | Term sheet received | 1 | ... | ⬜/✅
4    | Jun 1  | Partnership signed | 1 | ... | ⬜/✅
5    | Jun 8  | Total funding raised | 1.5M | ... | ⬜/✅
```

### 7.2 Success Gates (Milestone Reviews)

**Gate 1 — End of Week 1 (D10)**:
- ✅ 20+ outreach emails sent
- ✅ 5+ discovery calls scheduled
- ✅ CRM 100% populated + updated

**Gate 2 — End of Week 2 (D17)**:
- ✅ 6+ discovery calls completed
- ✅ 2+ pilots verbally agreed
- ✅ 3 investor meetings conducted
- ✅ Pitch deck finalized

**Gate 3 — End of Week 3 (D24)**:
- ✅ 3 pilots signed + launched
- ✅ 50+ retailers onboarded
- ✅ 1 partnership proposal sent
- ✅ First orders fulfilled

**Gate 4 — End of Week 4 (D30)**:
- ✅ 300+ retailers across pilots
- ✅ USD 20K+ pilot MRR (if billing started)
- ✅ 1 term sheet signed
- ✅ 1 partnership signed
- ✅ 4+ investor meetings completed

**Gate 5 — End of Week 5 (D35)**:
- ✅ USD 1.5M funding closed (or at least committed)
- ✅ 5+ pilots active (500+ retailers)
- ✅ 2+ partnerships signed

---

## 8. AUTOMATION OPPORTUNITIES (PHASE 2)

Once manual execution is underway (post-Day 30), consider automating:

1. **Email Sequencing** — Use Resend API + Node.js cron job to send follow-ups automatically
2. **Metrics Sync** — Sync HubSpot → Google Sheets daily via Zapier or custom script
3. **Lead Capture** — Web form → HubSpot → Slack notification
4. **Pitch Deck Personalization** — Script to auto-populate slides with prospect name/company
5. **Investor Update Emails** — Monthly automated email with metrics snapshot
6. **SMS Follow-ups** — Use Twilio to send SMS after email if no open in 48h

**Suggested Implementation Language**: Node.js (in `/home/apop/sokogate-ai/apps/web/` or standalone `/home/apop/sales-and-funding-tools/`)

**Sample Automation Structure**:
```
sales-automation/
├── package.json
├── .env
├── scripts/
│   ├── import-csv-to-hubspot.js
│   ├── daily-metrics-report.js
│   ├── send-bulk-emails.js
│   └── generate-pitch-deck.js
├── lib/
│   ├── hubspot-client.js
│   ├── google-sheets.js
│   └── email-templates.js
└── README.md
```

**Installation**: `npm install @hubspot/api-client googleapis resend dotenv`

---

## 9. VERSION CONTROL & COLLABORATION

### 9.1 Git Repository Setup

**Initialize Git Repository** (if not already):
```bash
cd /home/apop/sales-and-funding-assets
git init
git add .
git commit -m "Initial commit: Complete sales & funding playbook"
git branch -M main
git remote add origin git@github.com:yourusername/sokogate-sales-funding.git
git push -u origin main
```

**Branch Strategy**:
- `main` — stable, production-ready documents
- `dev` — ongoing edits (active working branch)
- `feature/email-templates` — isolated template changes
- `hotfix/typos` — urgent corrections

**Commit Cadence**: At least once per sprint, preferably daily if changes made

### 9.2 Backup & Sync Strategy

- **Primary**: GitHub remote repository (private)
- **Secondary**: Google Drive backup (manual export weekly)
- **Tertiary**: Local WSL2 filesystem (already in `/home/apop/`)

**Automated Backup** (optional cron job):
```bash
# Daily backup at 2am
0 2 * * * cd /home/apop/sales-and-funding-assets && git add . && git commit -m "Auto-backup $(date)" && git push
```

---

## 10. HANDOFF & NEXT STEPS

### 10.1 Immediate Actions (Today — D1)

1. [ ] Review this execution plan in full
2. [ ] Create Google Workspace account + folder structure
3. [ ] Set up HubSpot CRM (free tier)
4. [ ] Create Calendly link
5. [ ] Install email tracking extension
6. [ ] Import all CSV data to HubSpot
7. [ ] Tag all 88 contacts properly
8. [ ] Build pitch deck in Google Slides (copy from 06-PITCH-DECK-FIRST-DRAFT.md)
9. [ ] Practice pitch 3x (record yourself)
10. [ ] Commit all organized files to git

### 10.2 Week 1 Actions (D2-D7)

- [ ] Research top 10 prospects (LinkedIn, company news)
- [ ] Personalize 10 sales emails + send
- [ ] Send 3 partnership intro emails
- [ ] Send 2 investor cold emails
- [ ] Send 5 LinkedIn connection requests
- [ ] Update CRM with all activities
- [ ] Follow up on any responses
- [ ] Schedule discovery calls for Week 2

### 10.3 Week 2 Actions (D8-D14)

- [ ] Conduct 5-7 discovery calls
- [ ] Propose pilots to 2-3 hot prospects
- [ ] Request warm intros to 3 investors
- [ ] Conduct first investor meeting
- [ ] Send partnership follow-ups
- [ ] Finalize pitch deck visuals
- [ ] Update metrics dashboard

### 10.4 Week 3+ Actions (D15-D30)

- [ ] Close 2-3 pilots (signed agreements)
- [ ] Conduct 4+ investor meetings
- [ ] Send due diligence package
- [ ] Advance partnership to signed agreement
- [ ] Fulfill first pilot orders
- [ ] Capture testimonials
- [ ] Create case study
- [ ] Negotiate term sheet
- [ ] Plan Week 5-6 expansion

---

## 11. EXPECTED OUTCOMES & ROI

**Time Investment**: ~40-50 hours over 30 days (2-3 hrs/day)

**Expected Outcomes** (based on plan execution):
- **Sales**: 3-5 pilots signed → 200-500 retailers → USD 20K-50K pilot MRR
- **Funding**: 1 term sheet → USD 1.5M Series A → 18-24 month runway
- **Partnerships**: 1-2 agreements → West Africa market entry
- **Traction**: Proven demand + unit economics → stronger Series A position

**Long-term Value**:
- Systematic, repeatable sales + fundraising process
- CRM database of 88+ qualified contacts
- Pitch deck reusable for future rounds
- Metrics framework for investor reporting
- Playbook for team scaling

---

## 12. APPENDICES

### Appendix A: Tool Quick-Start Guides

**HubSpot CRM Free Setup**:
1. Sign up at hubspot.com
2. Create 3 pipelines: Sales, Investors, Partnerships
3. Import CSV: Contacts → Import → File (CSV) → Map fields
4. Create properties: Tier, Status, Last Contacted, Next Action
5. Set up email tracking: Install HubSpot Sales Chrome extension

**Google Slides Pitch Deck**:
1. Go to slides.google.com → Create new presentation
2. Title: "Sokogate Series A Pitch Deck — May 2026"
3. Duplicate 15 slides per structure in 03-INVESTOR-PITCH-DECK-OUTLINE.md
4. Copy content from 06-PITCH-DECK-FIRST-DRAFT.md (fully written)
5. Insert: Logo, charts, customer photos, product screenshots
6. Share with advisors: Get "Commenter" access for feedback
7. Present: Use Presenter Mode with speaker notes

**Calendly Integration**:
1. Sign up at calendly.com
2. Create event type: "Sokogate Intro Call" — 15 min
3. Set availability: Weekdays 9am-5pm EAT
4. Connect Google Calendar
5. Copy booking link: `https://calendly.com/yourname/sokogate-intro`
6. Add to email signature + outreach templates

### Appendix B: Email Template Customization Checklist

For each prospect email:
- [ ] Company name inserted 2-3 times
- [ ] Decision-maker name personalized
- [ ] Specific pain point mentioned (from research)
- [ ] Relevant engagement angle selected
- [ ] Custom subject line (not generic)
- [ ] Call-to-action clear (15-min call, not "let's keep in touch")
- [ ] Calendly link included
- [ ] Signature complete with contact info

### Appendix C: Weekly Review Agenda (Friday 4pm)

1. **Metrics Review** (10 min):
   - Count emails sent, responses, calls completed
   - Update METRICS-DASHBOARD.csv
   - Compare to targets

2. **Pipeline Review** (15 min):
   - HubSpot: what moved this week?
   - Prospects advancing to next stage?
   - Deals stuck? Why?

3. **Feedback Loop** (10 min):
   - What messaging worked best?
   - What objections came up?
   - How to refine next week?

4. **Next Week Planning** (15 min):
   - Set top 3 priorities
   - Schedule outreach batches
   - Block calendar for focus time

5. **Celebration** (5 min):
   - Acknowledge wins (no matter how small)
   - Document learning
   - Reset for next week

---

## 13. CONCLUSION

The `sales-and-funding-assets` project contains a world-class business development strategy. The documentation is **complete and ready**. The gap between strategy and execution is purely operational: tooling, CRM, email automation, and disciplined execution.

**Your 30-Day Path**:
1. **Days 1-3**: Set up tools (HubSpot, Google Workspace, Calendly)
2. **Days 4-10**: Launch outreach (20 emails, 5 calls, start pipeline)
3. **Days 11-17**: Build deck + conduct investor meetings
4. **Days 18-24**: Close pilots + advance partnerships
5. **Days 25-30**: Demonstrate traction + secure term sheet

The plan is **ambitious but achievable** with consistent 2-3 hours/day focus. The assets are in place; now execution determines outcome.

**Start Sprint 0 today.**

---

**Document Version**: 1.0  
**Last Updated**: May 11, 2026  
**Next Review**: End of Week 1 (May 17, 2026)
