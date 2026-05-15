# Sokogate AI Dashboard - Import & Setup Guide

**Dashboard URL**: `https://sokogate-ai.ultimotradingltd.co.ke/`

**Objective**: Import all 88 contacts (45 prospects + 25 investors + 18 partners) into dashboard for tracking

---

## STEP 1: ACCESS THE DASHBOARD

### Login (2 min)
1. Go to: `https://sokogate-ai.ultimotradingltd.co.ke/`
2. Login with your credentials (ask admin if unsure)
3. You should land on Dashboard home page

### Verify You See 6 Tabs
- **Leads** (AI chat inquiries)
- **Analytics** (metrics overview)
- **Prospects** (sales pipeline)
- **Investors** (funding pipeline)
- **Partners** (partnership pipeline)
- **Metrics** (KPI tracking)

---

## STEP 2: IMPORT PROSPECTS CSV (45 Contacts)

### Navigate to Prospects Tab
1. Click **Prospects** tab in dashboard header
2. You should see an **"Import CSV"** button (top right of table)

### Import File
1. Click **"Import CSV"** button
2. File dialog opens
3. Navigate to: `/home/apop/sales-and-funding-assets/TRACKER-PROSPECTS.csv`
4. Select file
5. Click **"Open"** or **"Import"**

### Verify Import
- Dashboard should show: **45 prospects loaded**
- Columns visible: Prospect | Company | Tier | Location | Decision Maker | Annual Spend | Pain Point | Engagement Angle | Status
- Default status for all: "Not Started"

### What You Can Do Now
- Click any prospect row → view full details
- Click row → "Edit" → update status (e.g., "Emailed", "Called", "Interested")
- Use search box to find prospect by company name
- Filter by Tier (T1, T2, T3, etc.)
- Sort by Annual Spend (to prioritize Tier 1)

---

## STEP 3: IMPORT INVESTORS CSV (25 Contacts)

### Navigate to Investors Tab
1. Click **Investors** tab in dashboard header
2. You should see an **"Import CSV"** button

### Import File
1. Click **"Import CSV"** button
2. Navigate to: `/home/apop/sales-and-funding-assets/TRACKER-INVESTORS.csv`
3. Select file → **Open**

### Verify Import
- Dashboard should show: **25 investors loaded**
- Columns: Investor Name | Fund Name | Investment Stage | Thesis | Contact Info | Tier | Decision Timeline | Status
- Default status: "Not Started"

### Usage
- Use to track outreach to each investor
- Update status after email/call (e.g., "Emailed", "Call Scheduled", "Pitch Delivered")
- Filter by Investment Stage (Seed, Series A, Series B) based on your fundraising stage
- Track decision timelines (6 weeks, 12 weeks, 24 weeks)

---

## STEP 4: IMPORT PARTNERS CSV (18 Contacts)

### Navigate to Partners Tab
1. Click **Partners** tab in dashboard header
2. Click **"Import CSV"** button

### Import File
1. Navigate to: `/home/apop/sales-and-funding-assets/TRACKER-PARTNERSHIPS.csv`
2. Select file → **Open**

### Verify Import
- Dashboard should show: **18 partners loaded**
- Columns: Partner Name | Company | Location | Contact | Capability | Tier | Value Prop | Status
- Default status: "Not Started"

### Usage
- Track partnership outreach/negotiations
- Update status after initial contact (e.g., "Emailed", "Meeting Scheduled", "In Discussion")
- Filter by geography (Ghana, Senegal, Tanzania) for market-entry strategy
- Note deal terms in notes field for each partner

---

## STEP 5: SETUP METRICS (WEEKLY KPI TRACKING)

### Navigate to Metrics Tab
1. Click **Metrics** tab in dashboard header
2. You should see weekly KPI tracker

### Key Metrics to Track (Update Weekly - Friday EOD)
- **Sales Emails Sent**: Count of outreach emails this week
- **Calls Scheduled**: Number of discovery calls booked
- **Calls Completed**: Number of calls held
- **Meetings Won**: Number of prospects/investors/partners that agreed to pilot/investment/partnership
- **Pilot Customers**: Number of active pilots
- **Revenue**: If tracking MRR/ARR

### CSV Alternative
If Metrics tab is not available, use: `/home/apop/sales-and-funding-assets/METRICS-DASHBOARD.csv`

**Columns**:
- Week | Sales Emails Sent | Calls Scheduled | Calls Completed | Meetings Won | Pilot Customers | Revenue | Notes

**Update Process**:
1. Every Friday 4pm: Update metrics
2. Count emails sent this week (from "Sokogate Outreach" folder)
3. Count calls booked (from calendar or Calendly)
4. Save to CSV
5. (Optional) Re-import to dashboard if dashboard reads from this CSV

---

## STEP 6: DAILY WORKFLOW (15 MINUTES)

### Every Morning (When You Start)
1. **Leads Tab**: Check for any new AI chat inquiries (if applicable)
2. **Prospects Tab**: 
   - Filter Status = "Not Started" 
   - Sort by Tier (T1 first)
   - Identify today's outreach targets
3. **Investors Tab**: Same as Prospects
4. **Partners Tab**: Same as Prospects

### After Each Action (Email/Call/Meeting)
1. Find the contact in relevant tab
2. Click row → **"Edit"**
3. Update **Status** field:
   - "Emailed" (after sending outreach)
   - "Email Open" (if using tracking)
   - "Call Scheduled" (after booking call)
   - "Call Completed" (after call)
   - "Interested" (if positive response)
   - "Not Interested" (if they declined)
   - "Pilot Signed" (if deal closed)
4. Add **Notes** (optional): "Mentioned budget constraints", "Needs CEO approval", etc.
5. Click **"Save"**
6. Contact now shows updated status in dashboard

### Friday EOD (30 min)
1. Go to **Metrics** tab
2. Update KPIs for the week
3. Review **Prospects** tab:
   - Count total "Emailed"
   - Count total "Call Scheduled"
   - Count total "Interested" or "Pilot Signed"
4. Document in notes: "Week 1 complete: 10 emails sent, 3 calls scheduled, 1 interested"

---

## STEP 7: EXPORTING DATA (If Needed)

### Export Any Tab to CSV
1. Go to relevant tab (Prospects/Investors/Partners/Metrics)
2. Look for **"Export to CSV"** button (bottom right or top right)
3. Click → CSV downloads automatically

### Use Case
- Weekly reporting to advisor/co-founder
- Backup (save export to Google Drive)
- Analysis (open in Excel/Sheets for pivot tables)

---

## TROUBLESHOOTING

### "Import CSV button not visible"
**Solution**: 
- Refresh page (Ctrl+R)
- Make sure you're in the right tab (Prospects/Investors/Partners)
- If still missing, contact admin

### "Import fails - file not recognized"
**Solution**:
- Verify CSV file exists in `/home/apop/sales-and-funding-assets/`
- Make sure file is actually .csv (not .xlsx or .txt)
- Try re-exporting from original source if available

### "Only some rows imported"
**Solution**:
- Check for duplicate entries in CSV (dashboard may skip duplicates)
- Verify column headers match (PROSPECT, COMPANY, TIER, LOCATION, etc.)
- Contact admin if issue persists

### "I can't edit a prospect after import"
**Solution**:
- Click on prospect row
- Look for **"Edit"** button (may be in side panel or top right)
- If no edit button, click the **pencil icon** next to prospect name
- Make changes → **Save**

### "Status field isn't updating"
**Solution**:
- Make sure you click **"Save"** after changing status (easy to forget)
- Refresh page to see updated status reflected
- If still not working, try re-importing CSV

---

## DASHBOARD FEATURES WALKTHROUGH

### Feature: Search
- Type company name or decision maker name in search box
- Filters all visible rows in real-time

### Feature: Filter by Tier
- Click **Tier** column header → sort ascending/descending
- Or use filter dropdown (if available)
- Useful for prioritizing T1 (highest annual spend) first

### Feature: Filter by Status
- Use Status dropdown filter
- View only "Emailed" prospects to check who hasn't responded
- View only "Interested" prospects to track hot leads

### Feature: Add Notes
- Click prospect → Edit
- Scroll to **Notes** field
- Add context: "CEO mentioned budget cut", "Interested in pilot", "Wrong contact, escalate to Procurement Director"
- Save

### Feature: Track Call Dates
- Click prospect → Edit
- Find **Last Contact Date** or **Call Date** field
- Update after call/email
- Useful for follow-up scheduling

### Feature: Bulk Actions (If Available)
- Select multiple prospects
- Bulk update status (e.g., all T2 → "Emailed")
- Saves time on mass outreach

---

## INTEGRATION WITH OTHER TOOLS

### Email Tracking
- After sending email (Gmail), update Prospects status to "Emailed"
- When email opens (tracked via Lemlist), update status to "Email Open"
- When prospect responds, mark "Interested" or relevant status

### Calendar Integration
- After prospect agrees to call, add to calendar
- Go back to Prospects → Edit → **Call Date** = [date/time of call]
- Dashboard can show upcoming calls (if implemented)

### Google Sheets Sync (Optional)
- If your team prefers Google Sheets tracking
- Export from dashboard to CSV weekly
- Manually upload to shared Google Sheet for team visibility
- Alternative: Create separate Sheet that syncs with dashboard (requires admin setup)

---

## NEXT STEPS AFTER IMPORT

**By End of Day Wednesday (May 12)**:
- [ ] All 3 CSVs imported (45 + 25 + 18 = 88 contacts)
- [ ] Verified each tab shows correct count
- [ ] Tested editing a prospect (change status, add note, save)
- [ ] Tested search functionality
- [ ] Tested export (download one prospect list as CSV)

**By Friday (May 14)**:
- [ ] Updated Prospects tab status for all Week 1 outreach
- [ ] Updated Investors tab with any initial research/outreach
- [ ] Updated Metrics with weekly KPIs
- [ ] Exported report for sharing with advisor/co-founder

---

## DASHBOARD URL REFERENCE

| Page | URL |
|---|---|
| Dashboard Home | `https://sokogate-ai.ultimotradingltd.co.ke/` |
| Prospects Tab | `https://sokogate-ai.ultimotradingltd.co.ke/dashboard?tab=prospects` |
| Investors Tab | `https://sokogate-ai.ultimotradingltd.co.ke/dashboard?tab=investors` |
| Partners Tab | `https://sokogate-ai.ultimotradingltd.co.ke/dashboard?tab=partners` |
| Metrics Tab | `https://sokogate-ai.ultimotradingltd.co.ke/dashboard?tab=metrics` |

**Bookmark these for quick access!**

---

## SUPPORT

- **Dashboard crashes?** Try refreshing page first
- **Lost data after refresh?** Contact admin (data should be persistent)
- **Can't find a contact after import?** Use search box to verify they're in system
- **Want custom fields?** Contact admin (e.g., "Decision Timeline", "Budget Approval", etc.)
