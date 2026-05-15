# SOKOGATE AI DASHBOARD — SALES & FUNDING USAGE GUIDE

**Audience**: Founder/Operator executing the 30-day sales & funding plan  
**Dashboard URL**: `https://sokogate-ai.ultimotradingltd.co.ke/`  
**Last Updated**: May 11, 2026  

---

## 1. GETTING STARTED

### 1.1 Login
1. Navigate to `https://sokogate-ai.ultimotradingltd.co.ke/`
2. Sign in with your credentials (NextAuth — email/password or OAuth)
3. After login, you'll land on the home page. Click **"Dashboard"** in the left sidebar.

### 1.2 Dashboard Overview
The dashboard has **6 main tabs** accessible via buttons in the header:

| Tab | Icon | Purpose | Data Table |
|-----|------|---------|------------|
| **Leads** | Users | Chat-generated leads from website visitors | `leads` |
| **Analytics** | BarChart | Lead analytics + charts | `lead_analytics_daily` view |
| **Prospects** | Users | B2B sales prospects (45 construction companies) | `sales_prospects` |
| **Investors** | Building | Fundraising targets (25 investors) | `investors` |
| **Partners** | Handshake | West Africa distribution partners (18) | `partnerships` |
| **Metrics** | BarChart2 | Weekly KPI tracker against 30-day plan | `weekly_metrics` |

**Default view**: Leads tab shows all inbound chat leads from your AI agent.

---

## 2. IMPORTING YOUR SALES & FUNDING DATA

### 2.1 One-Click CSV Import

Your dashboard includes built-in import endpoints that read directly from the `sales-and-funding-assets` folder.

**Steps**:
1. Go to **Prospects** tab
2. Click **"Import CSV"** button (top right of the table section)
3. Wait for success message (green banner): "Imported 45 prospects"
4. Data appears instantly in the table below

**Repeat for**:
- **Investors** tab → Import (loads `TRACKER-INVESTORS.csv` → 25 records)
- **Partners** tab → Import (loads `TRACKER-PARTNERSHIPS.csv` → 18 records)

**What gets imported**:
All columns from the CSV files are mapped automatically:
- Prospects: company, contact_name, email, phone, whatsapp, tier, location, annual_spend_kes, pain_point, engagement_angle, decision_maker_title, status, notes
- Investors: investor_name, fund_name, tier, ticket_size_usd_min/max, geographic_focus, investment_thesis, contact_name, email, phone, decision_timeline_weeks, first_contact_date, status, notes
- Partnerships: company_name, country, tier, contact_name, title, email, phone, capability, interest_level, status, revenue_model, monthly_revenue_potential_usd, notes

### 2.2 Manual Entry (if needed)

Click **"Create Prospect"** / **"Create Investor"** / **"Create Partnership"** buttons to add records manually.

Required fields (marked with *):
- **Prospect**: Company *, Contact Name
- **Investor**: Investor Name *, Fund Name
- **Partner**: Company Name *, Country *

### 2.3 Export to CSV

On any tab, click **"Export CSV"** to download the current view (respecting filters/search) as a CSV file. Use this for backups or offline analysis.

---

## 3. DAILY WORKFLOW — USING THE DASHBOARD

### 3.1 Morning Routine (15 min)

1. **Open dashboard** → check **Leads** tab for new inbound inquiries from your AI agent
2. Review **Prospects** tab → see which ones need follow-up today (filter by status = "Contacted" or "Responded")
3. Check **Investors** tab → any status = "Meeting Scheduled"? Prepare for call
4. Look at **Partners** tab → any status = "Discovery Call"? Prepare agenda
5. Update **Metrics** tab → input yesterday's actual numbers (emails sent, responses, calls made)

### 3.2 During Outreach Sessions

**When sending emails**:
- After each batch of emails, go to the **Prospects** tab
- Find each prospect you emailed
- Click the row to open detail modal
- Update: `status` → "Contacted", `last_contact_date` → today
- Add note: "Sent intro email via Gmail — interested in pilot"
- Click outside modal — auto-saves via PATCH request

**When you get a response**:
- Change `status` → "Responded"
- Add note: "Responded positively — scheduling call"
- Set `next_action_date` → date for follow-up

**When scheduling a call**:
- For prospect: status → "Negotiating"
- For investor: status → "Meeting Scheduled"
- For partner: status → "Discovery Call"
- Log call notes in `notes` field after the call

### 3.3 Weekly Review (Fridays, 30 min)

1. Go to **Metrics** tab → update all Week X metrics (Actual values)
2. Check status dropdown (Pending/In Progress/Completed/Missed)
3. Export each command center (Prospects, Investors, Partners) to CSV backup
4. Commit CSV exports to git: `git add . && git commit -m "Week X metrics update"`

---

## 4. UNDERSTANDING TABS & FIELDS

### 4.1 Prospects Tab

**Status workflow**:
```
Not Started → Contacted → Responded → Negotiating → Closed Won / Closed Lost
```

**Tier definitions** (from your strategy):
- **T1**: Top priority — Britam, Tropical Heat, ACON, Tamarind, Kilimani
- **T2–T4**: High potential — follow after T1
- **T5–T9**: Lower priority — nurture or batch outreach

**Key fields**:
- `annual_spend_kes`: Annual procurement budget (used for sizing opportunity)
- `pain_point`: Their stated challenge (from your research)
- `engagement_angle`: How you'll pitch them (from 05-SALES-OUTREACH-TEMPLATES.md)
- `decision_maker_title`: Job title of contact (for personalization)

**Search & filter**:
- Search box: searches company, contact name, email
- Status filter: "All", "Not Started", "Contacted", "Responded", "Negotiating", "Closed Won", "Closed Lost"

**Actions**:
- Click row → full detail modal with WhatsApp/email quick links
- Edit inline via dropdowns + notes
- Export CSV for offline analysis

### 4.2 Investors Tab

**Status workflow**:
```
Not Started → Contacted → Meeting Scheduled → Pitched → Due Diligence → Term Sheet → Closed
```

**Key fields**:
- `ticket_size_usd_min/max`: Check size fit (you're raising ~$1.5M)
- `decision_timeline_weeks`: How fast they move (prioritize <12 weeks)
- `geographic_focus`: East Africa focus preferred
- `investment_thesis`: Align with your business (B2B, marketplace, Africa)

**Priority order** (from 02-SERIES-A-INVESTORS-EAST-AFRICA.md):
- **T1**: Catalyst Fund, Mulistar, Impact Ventures, Acacia, Verod
- Target first meetings with T1 (use warm intros where possible)

### 4.3 Partners Tab

**Status workflow**:
```
Not Contacted → Contacted → Interested → Negotiating → Agreement Signed → Pilot Active → Live
```

**Key fields**:
- `country`: Ghana, Senegal, Nigeria, Côte d'Ivoire, Togo (priority order from 04-WEST-AFRICA-DISTRIBUTION-PARTNERS.md)
- `capability`: What they bring (logistics, warehousing, retail network)
- `monthly_revenue_potential_usd`: Projection — helps prioritize

### 4.4 Metrics Tab

Matches the `METRICS-DASHBOARD.csv` structure. Columns:

| Column | Description | 30-Day Target |
|--------|-------------|---------------|
| `week_number` | Week 1–5 | Week 1 = May 11–17 |
| `metric_name` | e.g., "Sales emails sent", "Discovery calls completed" | See 08-30-DAY-ACTION-PLAN.md |
| `target_value` | Planned number for that week | e.g., 20 emails in Week 1 |
| `actual_value` | What you actually achieved | Update every Friday |
| `status` | Pending / In Progress / Completed / Missed / Overachieved | Manual update |
| `notes` | Why missed/overachieved? Learning capture | Optional |

**Updating metrics**:
1. Click any metric row
2. Update `actual_value` field
3. Change `status` dropdown accordingly
4. Add brief `notes` if notable ("2 emails bounced, corrected addresses")
5. Click outside — auto-saves

---

## 5. EMAIL + CALENDLY WORKFLOW

### 5.1 Sending Outreach Emails

**Process**:
1. Open **Prospects** tab → filter: `status` = "Not Started"
2. Select first prospect (e.g., Britam)
3. Click row → copy email address from modal
4. Open Gmail → create new message
5. Select appropriate template from **05-SALES-OUTREACH-TEMPLATES.md**
6. Personalize with:
   - Company name (2–3 times)
   - Contact's name
   - Specific pain point from `pain_point` field
   - Relevant engagement angle
7. Insert Calendly link: `https://calendly.com/yourname/sokogate-intro`
8. Send
9. Immediately update prospect in dashboard:
   - `status` = "Contacted"
   - `last_contact_date` = today
   - `notes` = "Sent [template name] — awaiting response"

**Batch**:
- Send 5–10 emails per session
- Update all at once in dashboard immediately after

### 5.2 Follow-Up Cadence

Automated via your manual discipline (or Resend later):
- **Day 1**: Initial email
- **Day 5**: First follow-up (use "Day 5 Follow-Up" template)
- **Day 12**: Second follow-up (use "Day 12 Check-In" template)
- **Day 19**: Final attempt (use "Final Attempt" template)

After each follow-up, log activity in dashboard `notes`.

### 5.3 Discovery Calls

1. Prospect books via Calendly → appears on your Google Calendar
2. 5 min before call: open prospect record in dashboard
3. During call: take notes in a separate doc
4. After call: update dashboard
   - Set `status` = "Responded" or "Negotiating"
   - Add call notes to `notes`
   - Set `next_action_date` = next step date
   - Update `engagement_angle` if refined

---

## 6. PITCH DECK & INVESTOR MEETINGS

### 6.1 Pitch Deck Location

**File**: `/home/apop/sales-and-funding-assets/06-PITCH-DECK-FIRST-DRAFT.md`  
**Google Slides**: Create from this content (see Appendix A)

**During investor meetings**:
- Have Google Slides open in presenter mode
- After meeting: send thank-you email + deck link
- Log meeting in **Investors** tab:
  - `status` = "Pitched" or "Due Diligence"
  - `meetings_count` += 1 (manual edit via SQL or future UI enhancement)
  - `notes` = "Meeting summary + next steps"

### 6.2 Due Diligence Package

Prepare separate folder in Google Drive:
- `Sokogate-Due-Diligence/`
  - `cap-table.pdf`
  - `financials.xlsx`
  - `team-bios.pdf`
  - `product-docs.pdf`
  - `customer-testimonials.pdf`

Share link with interested investors after meeting 2 or 3. Update investor record:
- `status` = "Due Diligence"
- `notes` = "DD package sent on [date]"

---

## 7. PILOT CLOSURE & PARTNERSHIP AGREEMENTS

### 7.1 Pilot Agreement Process

1. **Proposal**: Send pilot agreement PDF via email (use template from `07-PARTNERSHIP-PROPOSAL-TEMPLATE.md`)
2. **Update CRM**: Prospect `status` = "Negotiating"
3. **Once signed**: `status` = "Closed Won"
4. **Onboarding**: Schedule kickoff call, create pilot retailer list (50+)
5. **First orders**: Track in notes, update `payment_status` when paid
6. **Testimonials**: Collect after 2 weeks, add to `notes`

**Pilot targets**:
- Britam or Tropical Heat → KES 500K+ monthly spend
- ACON or Tamarind → second pilot
- Pearl Construction or Flamingo → third pilot (backup)

### 7.2 Partnership Agreement Process

1. **Discovery call**: Log `first_contact_date`, `discovery_call_date` in partner record
2. **Proposal sent**: Set `proposal_sent_date`, `status` = "Proposal Sent"
3. **Negotiation**: `status` = "Negotiation"
4. **Signed**: `status` = "Agreement Signed", `proposal_signed_date` = today
5. **Pilot**: `status` = "Pilot Active", `pilot_start_date` = date
6. **Live**: After pilot success, `status` = "Live"

**Priority partners**:
1. Meridian Trust (Ghana)
2. Traders' Warehouse (Senegal)
3. Jospong (Ghana)
4. DHL (multinational)
5. GNPC (Ghana)

---

## 8. TROUBLESHOOTING & FAQ

**Q: Import button not working?**
A: Check browser console. Ensure `TRACKER-*.csv` files exist at `/home/apop/sales-and-funding-assets/`. The API endpoint reads them directly — no upload needed.

**Q: Data not appearing after import?**
A: Refresh the page. React Query cache invalidates automatically, but a hard refresh ensures fresh data.

**Q: Can I edit imported records?**
A: Yes — click any row, edit fields in the modal, click outside to save. Changes persist to PostgreSQL.

**Q: How do I reset/clear all data to re-import?**
A: Run SQL: `DELETE FROM sales_prospects; DELETE FROM investors; DELETE FROM partnerships;` Then re-import via buttons.

**Q: Where is the data stored?**
A: Neon PostgreSQL database. Connection string in `sokogate-ai/apps/web/.env` as `DATABASE_URL`.

**Q: Can I add custom fields?**
A: Yes — edit the SQL schema in `003_add_sales_tables.sql` and restart API (or add column via ALTER). Update dashboard forms as needed.

**Q: How do I sync to Google Sheets automatically?**
A: Not yet built. Option 1: Export CSV weekly manually. Option 2: Build script using Node.js to fetch `/api/prospects` and write to Sheets API (Phase 2).

**Q: What if I accidentally delete a record?**
A: Currently no soft-delete. Restore from CSV backup or database backup if enabled. Consider enabling point-in-time recovery on Neon.

---

## 9. KEYBOARD SHORTCUTS (Browser)

None built-in yet. Consider adding:
- `/` to focus search
- `n` to create new record
- `e` to export current view

---

## 10. SUPPORT & NEXT STEPS

**If dashboard is inaccessible**:
1. Check server status: Is `sokogate-ai` app running? (`systemctl status` or PM2 list)
2. Verify URL: `https://sokogate-ai.ultimotradingltd.co.ke/` (or your custom domain)
3. Clear browser cache / try incognito
4. Reset password via `/account/signin` → "Forgot password"

**If import fails**:
Check server logs for error. Common issues:
- Database not migrated (run `003_add_sales_tables.sql`)
- CSV file missing at expected path
- Column mismatch between CSV and `map*Row` function

**After 30-day sprint**:
- Review metrics dashboard for lessons learned
- Archive completed quarter's data
- Reset for next fundraising round or scale phase

---

**Document Version**: 1.0  
**Last Updated**: May 11, 2026  
**Next Review**: End of Week 1 (May 17, 2026)
