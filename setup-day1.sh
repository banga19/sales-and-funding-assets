#!/bin/bash
# Sokogate Sales & Funding — Day 1 Setup Script
# WSL2 Ubuntu-24.04 compatible
# Purpose: Automate Sprint 0 foundational tasks

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

# Step 2: Check for required SaaS accounts (manual)
echo "--- Step 2: Tooling Accounts ---"
echo "Please ensure you have accounts for:"
echo "  1. HubSpot CRM (Free) — https://hubspot.com"
echo "  2. Gmail/Google Workspace — for Sheets/Slides"
echo "  3. Calendly — https://calendly.com"
echo "  4. Mailtrack or Lemlist — for email tracking"
echo ""
read -p "Have you signed up for these? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    status "All accounts confirmed"
    ((COMPLETED++))
else
    warning "Please complete signups before Sprint 1 outreach"
fi

echo ""

# Step 3: Create Google Workspace folder structure (instructions)
echo "--- Step 3: Google Drive Folder Setup ---"
echo "Manual steps:"
echo "  1. Go to drive.google.com"
echo "  2. Create folder: 'Sokogate-Sales-Funding'"
echo "  3. Inside, create subfolders:"
echo "     - 00-Strategic-Docs"
echo "     - 01-Pitch-Deck"
echo "     - 02-CRM-Exports"
echo "     - 03-Outreach-Templates"
echo "     - 04-Tracking"
echo "     - 05-Legal"
echo ""
read -p "Folders created? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    status "Drive structure ready"
    ((COMPLETED++))
else
    warning "Set up Drive folders before Sprint 1"
fi

echo ""

# Step 4: Import CSV to HubSpot (instructions)
echo "--- Step 4: HubSpot CSV Import ---"
echo "Import trackers to HubSpot CRM:"
echo ""
echo "  1. Log into HubSpot → Contacts → Import"
echo "  2. Upload these files one at a time:"
echo "     - TRACKER-PROSPECTS.csv → Create 'Prospects' pipeline"
echo "     - TRACKER-INVESTORS.csv → Create 'Investors' pipeline"
echo "     - TRACKER-PARTNERSHIPS.csv → Create 'Partners' pipeline"
echo "  3. Map fields: PROSPECT → Company Name, DECISION_MAKER → Contact Name"
echo "  4. Add tags: Tier 1, Tier 2, Tier 3"
echo "  5. Verify import: All 88 contacts loaded"
echo ""
read -p "Imports completed? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    status "All contacts imported to HubSpot"
    ((COMPLETED++))
else
    warning "Import CSV files to HubSpot before outreach"
fi

echo ""

# Step 5: Create Calendly link
echo "--- Step 5: Calendly Setup ---"
echo "  1. Go to calendly.com"
echo "  2. Create event type: 'Sokogate Intro Call' (15 minutes)"
echo "  3. Set availability: Weekdays 9am-5pm EAT"
echo "  4. Copy booking link"
echo "  5. Add to email signature"
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

# Step 6: Build pitch deck
echo "--- Step 6: Google Slides Pitch Deck ---"
echo "  1. Go to slides.google.com → 'Create new presentation'"
echo "  2. Title: 'Sokogate Series A Pitch Deck — May 2026'"
echo "  3. Create 15 blank slides"
echo "  4. Copy content from: 06-PITCH-DECK-FIRST-DRAFT.md"
echo "  5. Insert: Logo, charts, customer screenshots"
echo "  6. Share with advisor (Commenter access)"
echo ""
read -p "Pitch deck built in Google Slides? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    status "Pitch deck ready"
    ((COMPLETED++))
else
    warning "Build pitch deck before first investor meeting"
fi

echo ""

# Step 7: Email templates preparation
echo "--- Step 7: Outreach Templates ---"
echo "  1. Open 05-SALES-OUTREACH-TEMPLATES.md"
echo "  2. Personalize 5 emails for top Tier 1 prospects:"
echo "     - Britam Group Construction"
echo "     - Tropical Heat Ltd"
echo "     - ACON Limited"
echo "     - Tamarind Construction"
echo "     - Kilimani Builders"
echo "  3. Save as Gmail drafts"
echo ""
read -p "Email drafts prepared? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    status "Outreach templates ready to send"
    ((COMPLETED++))
else
    warning "Prepare emails before Sprint 1 launch"
fi

echo ""

# Final summary
echo "================================================================"
echo "  SETUP CHECKLIST COMPLETE"
echo "================================================================"
echo ""
echo "Tasks completed: $COMPLETED/8"
echo ""
echo "If all steps marked ✓, you're ready for Sprint 1."
echo ""
echo "Next actions:"
echo "  1. Send first batch of 5 sales emails (Day 4)"
echo "  2. Send 3 partnership intro emails (Day 6)"
echo "  3. Send 2 investor cold emails (Day 7)"
echo "  4. Update HubSpot with all activities"
echo "  5. Follow up on responses within 24 hours"
echo ""
echo "Good luck! 🚀"
echo ""

# Optional: open browser/tools?
read -p "Open HubSpot in browser? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    if command -v xdg-open &> /dev/null; then
        xdg-open "https://app.hubspot.com" 2>/dev/null || true
    elif command -v wslview &> /dev/null; then
        wslview "https://app.hubspot.com" 2>/dev/null || true
    else
        echo "Please open https://app.hubspot.com manually"
    fi
    status "HubSpot opened in browser"
fi
