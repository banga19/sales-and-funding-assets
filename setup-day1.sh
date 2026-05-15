#!/bin/bash
# Sokogate Sales & Funding — Day 1 Setup Script
# WSL2 Ubuntu-24.04 compatible
# Purpose: Automate Sprint 0 foundation tasks using custom Sokogate AI CRM

set -e  # Exit on error

echo "================================================================"
echo "  SOKOGATE SALES & FUNDING — DAY 1 SETUP"
echo "  This script automates Sprint 0 foundation tasks"
echo "  Expected time: 10-15 minutes"
echo "================================================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to print status
status() {
    echo -e "${GREEN}[✓]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

error() {
    echo -e "${RED}[✗]${NC} $1"
}

# Track what's been done
COMPLETED=0

# Check prerequisites
echo "--- Checking Prerequisites ---"
if command -v git &> /dev/null; then
    status "Git found: $(git --version | head -1)"
    ((COMPLETED++))
else
    error "Git not found — please install: sudo apt install git"
    exit 1
fi

if command -v node &> /dev/null; then
    status "Node.js found: $(node --version)"
    ((COMPLETED++))
else
    warning "Node.js not found (optional, only needed for automation scripts)"
fi

if command -v python3 &> /dev/null; then
    status "Python found: $(python3 --version)"
    ((COMPLETED++))
else
    warning "Python3 not found (optional, only needed for CSV processing)"
fi

echo ""

# Verify we're in the right directory
if [ ! -f "00-MASTER-SUMMARY.md" ]; then
    error "Not in sales-and-funding-assets directory. Please cd there first."
    exit 1
fi
status "Directory verified: $(pwd)"

echo ""

# Step 1: Verify git repo
echo "--- Step 1: Git Repository ---"
if [ -d ".git" ]; then
    status "Git repository already initialized"
    if git status --porcelain | grep -q "^\?\?"; then
        warning "Untracked files exist — consider committing them"
    else
        status "Working tree clean"
    fi
else
    warning "No git repository found — run: git init"
fi
((COMPLETED++))

echo ""

# Step 2: Verify Sokogate AI dashboard access
echo "--- Step 2: Sokogate AI Dashboard Access ---"
echo "Please confirm you can access your CRM:"
echo "  URL: https://sokogate-ai.ultimotradingltd.co.ke/"
echo "  Login with your credentials"
echo ""
read -p "Can you access the dashboard? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    status "Dashboard access confirmed"
    ((COMPLETED++))
else
    warning "Ensure dashboard is accessible before importing data"
fi

echo ""

# Step 3: Database tables verification
echo "--- Step 3: Database Tables ---"
echo "Your CRM requires these tables in PostgreSQL:"
echo "  - sales_prospects"
echo "  - investors"
echo "  - partnerships"
echo "  - weekly_metrics"
echo ""
echo "These should be created by migration: 003_add_sales_tables.sql"
read -p "Have you run the migration? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    status "Database tables confirmed"
    ((COMPLETED++))
else
    warning "Run migration before importing CSV data:"
    warning "  psql \$DATABASE_URL -f sokogate-ai/apps/web/src/db/migrations/003_add_sales_tables.sql"
fi

echo ""

# Step 4: CSV import instructions
echo "--- Step 4: Import CSV Data to Dashboard ---"
echo "Once database tables exist, import via dashboard buttons:"
echo ""
echo "  1. Login to https://sokogate-ai.ultimotradingltd.co.ke/"
echo "  2. Go to /dashboard"
echo "  3. Click 'Prospects' tab → 'Import CSV' button"
echo "     (loads TRACKER-PROSPECTS.csv → 45 records)"
echo "  4. Click 'Investors' tab → 'Import CSV' button"
echo "     (loads TRACKER-INVESTORS.csv → 25 records)"
echo "  5. Click 'Partners' tab → 'Import CSV' button"
echo "     (loads TRACKER-PARTNERSHIPS.csv → 18 records)"
echo "  6. Verify: All 88 contacts appear in respective tabs"
echo ""
read -p "CSV imports completed? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    status "All contacts imported to Sokogate AI dashboard"
    ((COMPLETED++))
else
    warning "Import all CSVs before starting outreach"
fi

echo ""

# Step 5: Calendly setup
echo "--- Step 5: Calendly Setup ---"
echo "  1. Go to calendly.com"
echo "  2. Create event: 'Sokogate Intro Call' (15 minutes)"
echo "  3. Set availability: Weekdays 9am-5pm EAT"
echo "  4. Connect Google Calendar"
echo "  5. Copy booking link (e.g., https://calendly.com/yourname/sokogate-intro)"
echo ""
read -p "Calendly link created? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    status "Scheduling link ready"
    ((COMPLETED++))
else
    warning "Create Calendly link before sending emails"
fi

echo ""

# Step 6: Google Drive folders
echo "--- Step 6: Google Drive Folder Structure ---"
echo "Create this structure in Google Drive:"
echo "  Sokogate-Sales-Funding/"
echo "  ├── 00-Strategic-Docs/   (original markdown files)"
echo "  ├── 01-Pitch-Deck/       (Google Slides + exports)"
echo "  ├── 02-CRM-Exports/      (CSV backups from dashboard)"
echo "  ├── 03-Outreach-Templates/ (customized emails)"
echo "  ├── 04-Tracking/         (live metrics dashboard)"
echo "  └── 05-Legal/            (term sheets, agreements)"
echo ""
read -p "Drive folders created? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    status "Drive structure ready"
    ((COMPLETED++))
else
    warning "Set up Drive folders before Sprint 1"
fi

echo ""

# Step 7: Pitch deck
echo "--- Step 7: Google Slides Pitch Deck ---"
echo "  1. Go to slides.google.com → 'Create new presentation'"
echo "  2. Title: 'Sokogate Series A Pitch Deck — May 2026'"
echo "  3. Create 15 blank slides (per 03-INVESTOR-PITCH-DECK-OUTLINE.md)"
echo "  4. Copy full content from: 06-PITCH-DECK-FIRST-DRAFT.md"
echo "  5. Apply branding: Primary #1E3A8A, Secondary #EF4444"
echo "  6. Insert logo, charts, customer screenshots if available"
echo "  7. Share with advisor for feedback (Commenter access)"
echo ""
read -p "Pitch deck built in Google Slides? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    status "Pitch deck ready"
    ((COMPLETED++))
else
    warning "Build pitch deck before first investor meeting (Sprint 2)"
fi

echo ""

# Step 8: Email templates
echo "--- Step 8: Outreach Templates ---"
echo "  1. Open 05-SALES-OUTREACH-TEMPLATES.md"
echo "  2. Personalize 5 emails for top Tier 1 prospects:"
echo "     - Britam Group Construction"
echo "     - Tropical Heat Ltd"
echo "     - ACON Limited"
echo "     - Tamarind Construction"
echo "     - Kilimani Builders"
echo "  3. Save each as a Gmail draft (or send test to yourself)"
echo ""
read -p "Email drafts prepared? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    status "Outreach templates ready to send"
    ((COMPLETED++))
else
    warning "Prepare emails before Sprint 1 outreach (Day 4)"
fi

echo ""

# Final summary
echo "================================================================"
echo "  SETUP CHECKLIST COMPLETE"
echo "================================================================"
echo ""
echo "Tasks completed: $COMPLETED/8"
echo ""
if [ $COMPLETED -eq 8 ]; then
    echo "All steps completed ✓ — You're ready for Sprint 1!"
else
    echo "Some steps pending. Complete ALL items before Day 4 outreach."
fi
echo ""
echo "Next actions (Sprint 1 — Days 4-10):"
echo "  Day 4: Send first 5 sales emails to Tier 1 prospects"
echo "  Day 5: Send next 5 sales emails to Tier 1-2 prospects"
echo "  Day 6: Send 3 partnership intro emails"
echo "  Day 7: Send 2 investor cold emails"
echo "  Day 8: Follow up on non-responders (Day 5 follow-up template)"
echo "  Day 9-10: Discovery calls (if scheduled)"
echo ""
echo "Remember: After each email batch, update dashboard statuses!"
echo ""
echo "Good luck! 🚀"
echo ""

# Optional: open browser to dashboard
read -p "Open Sokogate AI dashboard in browser now? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    if command -v xdg-open &> /dev/null; then
        xdg-open "https://sokogate-ai.ultimotradingltd.co.ke/dashboard" 2>/dev/null || true
    elif command -v wslview &> /dev/null; then
        wslview "https://sokogate-ai.ultimotradingltd.co.ke/dashboard" 2>/dev/null || true
    else
        echo "Please open https://sokogate-ai.ultimotradingltd.co.ke/dashboard manually"
    fi
    status "Dashboard opened in browser"
fi
