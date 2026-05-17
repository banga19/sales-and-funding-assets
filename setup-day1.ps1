# Setup Day 1 — Windows PowerShell

This is the **Windows-native equivalent** of `setup-day1.sh`.  
If you are running Windows (win32 platform) use this script.  
If you are on WSL2/macOS/Linux use `setup-day1.sh`.

Run from PowerShell (5.1+):

```powershell
pwsh -File .\setup-day1.ps1
```

---

## What This Script Does

Sprint 0 foundation checklist — 8 steps to prepare for Day 4 outreach:

1. **Prerequisites check** — Git, Node.js, database connectivity
2. **Git repository** — verify `.git` exists, check for untracked files
3. **Dashboard access** — confirm `https://sokogate-ai.ultimotradingltd.co.ke/` is reachable
4. **Database tables** — confirm migrations have run
5. **CSV import** — instruct user to import 88 contacts via dashboard
6. **Calendly** — instruct user to create scheduling link
7. **Google Drive** — instruct user to create folder structure
8. **Pitch deck** — instruct user to start Google Slides deck
9. **Email templates** — instruct user to draft first 5 outreach emails
10. **Summary** — pass/fail check and next-step instructions

---

## Requirements Before Running

| Tool | Required? | Install if missing |
|------|-----------|-------------------|
| Git | Yes | https://git-scm.com/download/win |
| Node.js | Yes (≥ 20) | https://nodejs.org/ (LTS) |
| npm | Yes (≥ 10) | Ships with Node 20+ |
| PostgreSQL client (psql) | Optional | https://www.postgresql.org/download/windows/ |

---

## Script

```powershell
<#
.SYNOPSIS
  Sokogate Sales & Funding — Day 1 Setup (Windows PowerShell)
#>

$ErrorActionPreference = "SilentlyContinue"

function Write-OK   ($msg) { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Warn ($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }
function Write-Err  ($msg) { Write-Host "[X] $msg" -ForegroundColor Red }

Clear-Host
Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  SOKOGATE SALES & FUNDING — DAY 1 SETUP (Windows)" -ForegroundColor Cyan
Write-Host "  Sprint 0 foundation checklist" -ForegroundColor Cyan
Write-Host "  Expected time: 10-15 minutes" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

$completed = 0

# ── Step 0: Verify working directory ─────────────────────────────
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Push-Location $scriptDir

if (-not (Test-Path "00-MASTER-SUMMARY.md")) {
    Write-Err "Not in sales-and-funding-assets directory. Navigate there first:"
    Write-Err "  cd C:\Users\LapTop\OneDrive\文档\UTCLTD\sales-and-funding-assets"
    Pop-Location
    exit 1
}
Write-OK "Working directory: $(Get-Location)"
$script:HOME_DIR = Get-Location

# ── Prerequisites ────────────────────────────────────────────────
Write-Host ""
Write-Host "--- Step 0: Prerequisites ---"

# Git
if (Get-Command git -ErrorAction SilentlyContinue) {
    $gitVer = & git --version
    Write-OK "Git: $gitVer"
    $script:hasGit = $true
    $completed++
} else {
    Write-Warn "Git not found — install from https://git-scm.com/download/win"
}

# Node.js
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVer = & node --version
    Write-OK "Node.js: $nodeVer"
    $script:hasNode = $true
    $completed++
} else {
    Write-Warn "Node.js not found — install from https://nodejs.org/ (LTS)"
}

# npm
if (Get-Command npm -ErrorAction SilentlyContinue) {
    $npmVer = & npm --version
    Write-OK "npm: $npmVer"
    $completed++
} else {
    Write-Warn "npm not found"
}

# psql (optional)
if (Get-Command psql -ErrorAction SilentlyContinue) {
    Write-OK "PostgreSQL client (psql) found"
} else {
    Write-Warn "psql not found (optional — needed for manual DB verification)"
}

Write-Host ""

# ── Step 1: Git repository ───────────────────────────────────────
Write-Host "--- Step 1: Git Repository ---"
if (Test-Path ".git") {
    Write-OK "Git repository already initialized"
    $status = git status --porcelain
    if ($status) {
        Write-Warn "Untracked or modified files exist:"
        git status --short
    } else {
        Write-OK "Working tree clean"
    }
} else {
    Write-Warn "No git repository found — run: git init"
}
$completed++

Write-Host ""

# ── Step 2: Dashboard access ─────────────────────────────────────
Write-Host "--- Step 2: Sokogate AI Dashboard Access ---"
Write-Host "  URL: https://sokogate-ai.ultimotradingltd.co.ke/dashboard"
$reply = Read-Host "  Can you access the dashboard? (y/n)"
if ($reply -match '^[Yy]') {
    Write-OK "Dashboard access confirmed"
    $completed++
} else {
    Write-Warn "Ensure dashboard is accessible before importing data"
}

Write-Host ""

# ── Step 3: Database tables ──────────────────────────────────────
Write-Host "--- Step 3: Database Tables ---"
Write-Host "  Your CRM requires these tables in PostgreSQL:"
Write-Host "    - sales_prospects"
Write-Host "    - investors"
Write-Host "    - partnerships"
Write-Host "    - weekly_metrics"
Write-Host ""
Write-Host "  Run: npm run db:migrate"
$reply = Read-Host "  Have you run the migration? (y/n)"
if ($reply -match '^[Yy]') {
    Write-OK "Database tables confirmed"
    $completed++
} else {
    Write-Warn "Run: npm run db:migrate"
}

Write-Host ""

# ── Step 4: CSV import ───────────────────────────────────────────
Write-Host "--- Step 4: Import CSV Data to Dashboard ---"
Write-Host ""
Write-Host "  1. Login to https://sokogate-ai.ultimotradingltd.co.ke/"
Write-Host "  2. Go to /dashboard"
Write-Host "  3. Prospects tab  -> Import CSV (loads 45 records from TRACKER-PROSPECTS.csv)"
Write-Host "  4. Investors tab  -> Import CSV (loads 25 records from TRACKER-INVESTORS.csv)"
Write-Host "  5. Partners tab   -> Import CSV (loads 18 records from TRACKER-PARTNERSHIPS.csv)"
Write-Host "  6. Verify: All 88 contacts appear in respective tabs"
Write-Host ""
$reply = Read-Host "  CSV imports completed? (y/n)"
if ($reply -match '^[Yy]') {
    Write-OK "All contacts imported to Sokogate AI dashboard"
    $completed++
} else {
    Write-Warn "Import all CSVs before starting outreach"
}

Write-Host ""

# ── Step 5: Calendly ─────────────────────────────────────────────
Write-Host "--- Step 5: Calendly Setup ---"
Write-Host "  1. Go to calendly.com"
Write-Host "  2. Create event: 'Sokogate Intro Call' (15 min)"
Write-Host "  3. Set availability: Weekdays 9am-5pm EAT"
Write-Host "  4. Connect Google Calendar"
Write-Host "  5. Copy booking link"
Write-Host ""
$reply = Read-Host "  Calendly link created? (y/n)"
if ($reply -match '^[Yy]') {
    Write-OK "Scheduling link ready"
    $completed++
} else {
    Write-Warn "Create Calendly link before sending emails"
}

Write-Host ""

# ── Step 6: Google Drive ─────────────────────────────────────────
Write-Host "--- Step 6: Google Drive Folder Structure ---"
Write-Host "  Sokogate-Sales-Funding/"
Write-Host "    ├── 00-Strategic-Docs/"
Write-Host "    ├── 01-Pitch-Deck/"
Write-Host "    ├── 02-CRM-Exports/"
Write-Host "    ├── 03-Outreach-Templates/"
Write-Host "    ├── 04-Tracking/"
Write-Host "    └── 05-Legal/"
Write-Host ""
$reply = Read-Host "  Drive folders created? (y/n)"
if ($reply -match '^[Yy]') {
    Write-OK "Drive structure ready"
    $completed++
} else {
    Write-Warn "Set up Drive folders before Sprint 1"
}

Write-Host ""

# ── Step 7: Pitch deck ───────────────────────────────────────────
Write-Host "--- Step 7: Google Slides Pitch Deck ---"
Write-Host "  1. Go to slides.google.com -> Create new presentation"
Write-Host "  2. Title: 'Sokogate Series A Pitch Deck — May 2026'"
Write-Host "  3. Create 15 blank slides (per 03-INVESTOR-PITCH-DECK-OUTLINE.md)"
Write-Host "  4. Copy full content from: 06-PITCH-DECK-FIRST-DRAFT.md"
Write-Host "  5. Apply branding: Primary #1E3A8A, Secondary #EF4444"
Write-Host "  6. Share with advisor for feedback (Commenter access)"
Write-Host ""
$reply = Read-Host "  Pitch deck built in Google Slides? (y/n)"
if ($reply -match '^[Yy]') {
    Write-OK "Pitch deck ready"
    $completed++
} else {
    Write-Warn "Build pitch deck before Sprint 2 (Day 11)"
}

Write-Host ""

# ── Step 8: Email templates ──────────────────────────────────────
Write-Host "--- Step 8: Outreach Templates ---"
Write-Host "  1. Open 05-SALES-OUTREACH-TEMPLATES.md"
Write-Host "  2. Personalize 5 emails for top Tier 1 prospects"
Write-Host "     - Britam Group Construction"
Write-Host "     - Tropical Heat Ltd"
Write-Host "     - ACON Limited"
Write-Host "     - Tamarind Construction"
Write-Host "     - Kilimani Builders"
Write-Host "  3. Save each as a Gmail draft"
Write-Host ""
$reply = Read-Host "  Email drafts prepared? (y/n)"
if ($reply -match '^[Yy]') {
    Write-OK "Outreach templates ready to send"
    $completed++
} else {
    Write-Warn "Prepare emails before Sprint 1 outreach (Day 4)"
}

Write-Host ""

# ── Rewind to original directory ────────────────────────────────
Pop-Location

# ── Summary ──────────────────────────────────────────────────────
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  SPRINT 0 SETUP — SUMMARY" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Tasks completed: $completed / 9"
Write-Host ""

if ($completed -eq 9) {
    Write-Host "ALL STEPS COMPLETE — You're ready for Sprint 1!" -ForegroundColor Green
} else {
    Write-Host "Some steps pending. Complete all items before Day 4 outreach." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Next actions (Sprint 1 — Days 4-10):"
Write-Host "  Day 4:  Send first 5 sales emails to Tier 1 prospects"
Write-Host "  Day 5:  Send next 5 sales emails to Tier 1-2 prospects"
Write-Host "  Day 6:  Send 3 partnership intro emails"
Write-Host "  Day 7:  Send 2 investor cold emails"
Write-Host "  Day 8:  Follow up on non-responders"
Write-Host "  Day 9-10: Discovery calls (if scheduled)"
Write-Host ""
Write-Host "Remember: After each email batch, update dashboard statuses!"
Write-Host ""

# ── Ask to open dashboard ─────────────────────────────────────────
$openDash = Read-Host "  Open Sokogate AI dashboard in browser now? (y/n)"
if ($openDash -match '^[Yy]') {
    Start-Process "https://sokogate-ai.ultimotradingltd.co.ke/dashboard"
    Write-OK "Dashboard opened in browser"
}

Write-Host ""
Write-Host "Good luck!" -ForegroundColor Green
Write-Host ""
