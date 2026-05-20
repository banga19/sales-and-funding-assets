# Google Sheets CRM Template — Sokogate Sales Pipeline
# Create a new Google Sheet → paste column headers → copy formulas below each block

## SHEET 1: DAILY OUTREACH LOG

| A | B | C | D | E | F | G | H | I | J |
|---|---|---|---|---|---|---|---|---|---|
| Date | Prospect | Company | Type | Email Template | Subject | Sent? | Opened? | Replied? | Status |
| 5/13 | Britam Group | T1 | Sales | Template 1 - T1 Contractor | Reduce Costs 15-20% | ✅ | ✅ | — | Awaiting |
| 5/13 | Tropical Heat | T1 | Sales | Template 1 | Direct Access West African | ✅ | — | — | Awaiting |
| 5/13 | ACON | T1 | Sales | Template 1 - Multi-Loc | Guaranteed Supply | ✅ | ✅ | ✅ | Negotiating |
| 5/14 | Tamarind | T1 | Sales | Template 1 - Bulk Source | One-stop Sourcing | ✅ | — | — | Awaiting |
| 5/14 | Meridian Trust | T1 | Partner | Partnership Batch | Strategic Partnership | ✅ | ✅ | — | Discovery Call |
| 5/15 | Jospong | T1 | Partner | Partnership Batch | Logistics Partnership | ✅ | — | — | Awaiting |

**Formulas** (paste in row 2 through row 200):
```
Row 2 formula:
=IF(A2<>"", DATEVALUE(A2), "")
```

**Status values to choose from**: Awaiting | Email Opened | Replied | Discovery Call | Negotiating | Pilot Signed | Closed Lost

---

## SHEET 2: WEEKLY SUMMARY

| A | B | C | D | E | F | G |
|---|---|---|---|---|---|---|
| Week | Week Ending | Sales Emails Sent | Partnership Emails | Investor Emails | LinkedIn Connections | Follow-Ups Sent |
| 1 | May 17 | 10 | 2 | 0 | 5 | 4 |
| 2 | May 24 | (live) | (live) | (live) | (live) | (live) |
| 3 | May 31 |  |  |  |  |  |
| 4 | Jun 7 |  |  |  |  |  |
| 5 | Jun 14 |  |  |  |  |  |

**Target row** (row 7):
```
Week | Date | Target Sales Emails | Target Responses | Target Calls Scheduled | Revenue Target (USD K) | Actual Status
1    | May17 | 10                   | 3                | 3                      | 5                      | On Track
```

---

## SHEET 3: PROSPECT PIPELINE MATRIX

This is your master prospect tracker. Copy exactly from TRACKER-PROSPECTS.csv + add Status + Notes columns.

| A | B | C | D | E | F | G | H | I | J | K | L | M |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Company | Tier | Location | Decision Maker | Email | Phone | Annual Spend (KES) | Pain Point | Engagement Angle | Raw Status | Calls Made | Pilot Date | Notes |
| Britam Group Construction | T1 | Nairobi | Procurement Director | inquiry@britam.co.ke | +254-722-423-100 | 500,000,000 | Procurement inefficiencies | Reduce bulk costs 15-20% | Not Started | 0 |  | Research: just launched [Project] phase |
| Tropical Heat Ltd | T1 | Nairobi | Supply Chain Manager | info@tropicalheat.co.ke | +254-732-111-200 | 300,000,000 | Supplier reliability | Direct West African | Not Started | 0 |  | |
| ACON Limited | T1 | Nairobi/Mombasa | Head of Ops | operations@acon.co.ke | +254-700-555-300 | 400,000,000 | Material shortages | Guaranteed supply | Not Started | 0 |  | |
| ... (all 45 rows from CSV) | | | | | | | | | | | | |

**Status values**: Not Started | Contacted | Responded | Negotiating | Closed Won | Closed Lost | Nurture

---

## SHEET 4: INVESTOR PIPELINE MATRIX

| A | B | C | D | E | F | G | H | I | J |
|---|---|---|---|---|---|---|---|---|---|
| Investor | Tier | Ticket (USD) | Timeline (Wks) | Thesis Match | Email | Status | Meetings | TS Date? | Notes |
| Catalyst Fund | T1 | 50K-500K | 6-8 | logistics tech East Africa | investments@catalyst... | Not Started | 0 | — | Fast-track; best fit |
| Impact Ventures | T1 | 500K-2M | 8-10 | growth-stage Africa | team@impactventures... | Not Started | 0 | — | |
| BII | T1 | 1M-5M | 12-16 | impact + SMEs | africa@bii.co.uk | Not Started | 0 | — | |
| Mulistar | T1 | 500K-3M | 8-12 | B2B trade enablement | investments@mulistar... | Not Started | 0 | — | |
| ... (all 25 rows) | | | | | | | | | |

**Status values**: Not Started | Contacted | Meeting Scheduled | Pitched | Due Diligence | Term Sheet | Closed

---

## SHEET 5: PARTNERSHIP PIPELINE

| A | B | C | D | E | F | G | H |
|---|---|---|---|---|---|---|---|
| Partner | Country | Tier | Capability | Revenue Model | Potential (USD/mo) | Status | Pilot Start |
| Meridian Trust | Ghana | T1 | Warehouse + Distribution | USD 3K + 15% rev share | 7,500 | Not Contacted | — |
| Jospong | Ghana | T1 | Fleet + Warehouse | USD 3K + 12% comm | 5,000 | Not Contacted | — |
| GNPC Downstream | Ghana | T1 | Retail network | Referral + Co-mktg | 3,000 | Not Contacted | — |
| DHL West Africa | Ghana/SN | T1 | 3PL + Cross-border | Contract Logistics | 8,000 | Not Contacted | — |
| Traders' Warehouse | Senegal | T1 | Import/Warehouse | USD 3K + 15% rev | 8,000 | Not Contacted | — |
| ... (all 18 rows) | | | | | | | |

**Pipeline formula**: =SUM(F2:F20) — total monthly revenue potential at full scale

---

## IMPORTANT FORMULAS

**Response Rate** (row 2 of Weekly Summary, col G):
```
=COUNTIFS(Daily!G:G,"✅") / COUNTA(Daily!G:G)
```

**Pilot Conversion Rate** (from Week 2 onward):
```
=COUNTIF(Pipeline_Matrix!J:J,"Closed Won") / COUNTA(Pipeline_Matrix!J:J)
```

**Cumulative Revenue Potential** (Partnership Pipeline, cell H1):
```
=SUMIF(Partnership_Pipeline!G:G,"Pilot Active",Partnership_Pipeline!F:F)
   + SUMIF(Partnership_Pipeline!G:G,"Live",Partnership_Pipeline!F:F)
```

**# Calls This Week**:
```
=COUNTIFS(Daily!A:A,">=DATEVALUE(""5/13/2026"")",
          Daily!A:A,"<=DATEVALUE(""5/17/2026"")",
          Daily!J:J,"Discovery Call")
```

**% of Target Reached** (each week):
```
=SUM(week_range_sales_emails) / target_sales_emails
```

---

## COLOUR CONDITIONAL FORMATTING RULES

Apply these in each sheet via Format → Conditional Formatting:

1. **Date cell** (Sheet 1, col A): if blank → grey
2. **Status** (Sheets 3-5): 
   - "Closed Won" → green background
   - "Closed Lost" → red background
   - "Negotiating / DD" → orange background
   - "Contacted" → yellow background
   - "Awaiting" → grey
3. **Response rate** (Sheet 2): if >30% → green; <15% → red; in-between → yellow
4. **Pilot Date** (Sheets 3-5): if date < TODAY() → orange (overdue); if date > TODAY()+14 → green (upcoming)

---

*Template created: May 20, 2026 | Source: EXECUTION-PLAN.md §Appendix A + PROSPECT-TRACKING-TEMPLATE.md*
*Synchronise with Sokogate AI dashboard weekly — sheets are a backup layer; dashboard is source of truth.*
