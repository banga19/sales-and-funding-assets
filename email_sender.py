#!/usr/bin/env python3
"""
Email Sending Utility for Sales and Funding Outreach
Processes CSV prospect data and sends personalized emails using templates
"""

import csv
import re
import os
import sys
import logging
import smtplib
import time
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
from typing import List, Dict, Optional
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('email_sender.log'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

class EmailSender:
    def __init__(self, smtp_host: str = 'localhost', smtp_port: int = 587, 
                 smtp_user: str = '', smtp_pass: str = '', from_email: str = ''):
        self.smtp_host = smtp_host
        self.smtp_port = smtp_port
        self.smtp_user = smtp_user
        self.smtp_pass = smtp_pass
        self.from_email = from_email or smtp_user
        
        # Email tracking
        self.sent_count = 0
        self.failed_count = 0
        self.failed_emails = []

    def load_csv_prospects(self, csv_file: str) -> List[Dict]:
        """Load prospect data from CSV file"""
        prospects = []
        try:
            with open(csv_file, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    # Extract emails from EMAIL field
                    email_field = row.get('EMAIL', '')
                    if email_field:
                        # Find all email addresses in the field
                        emails = re.findall(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', email_field)
                        for email in emails:
                            prospect = row.copy()
                            prospect['EMAIL'] = email.strip()
                            prospects.append(prospect)
                    else:
                        logger.warning(f"No email found for prospect: {row.get('COMPANY', 'Unknown')}")
            
            logger.info(f"Loaded {len(prospects)} email addresses from {csv_file}")
            return prospects
        except Exception as e:
            logger.error(f"Error loading CSV file {csv_file}: {e}")
            return []

    def extract_email_addresses(self, email_field: str) -> List[str]:
        """Extract all valid email addresses from a string"""
        if not email_field:
            return []
        # Regex to match email addresses
        email_pattern = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
        return re.findall(email_pattern, email_field)

    def get_email_template(self, prospect: Dict) -> tuple:
        """Get appropriate email template based on prospect data"""
        company = prospect.get('COMPANY', '').lower()
        tier = prospect.get('TIER', '').upper()
        decision_maker = prospect.get('DECISION_MAKER', '').lower()
        
        # Try to load template from file or use built-in
        try:
            # Check if we have specific template files
            template_dir = '/mnt/c/Users/LapTop/OneDrive/文档/UTCLTD/sales-and-funding-assets'
            
            # Default template based on tier
            if tier == 'T1':
                subject = f"Reduce Material Costs by 15-20% | Bulk Sourcing Partnership for {prospect.get('COMPANY', 'your company')}"
                body = f"""Dear {prospect.get('DECISION_MAKER', 'Team')},

I'm reaching out because {prospect.get('COMPANY', 'your company')} likely spends significant amounts annually 
on construction materials—and many contractors are overpaying due to fragmented supplier networks.

We're Sokogate, and we help major construction companies save 15-20% on bulk materials through 
direct regional sourcing (Kenya, Uganda, Tanzania, Ghana, Senegal).

HOW IT WORKS:
• Direct partnerships with 50+ manufacturers (cement, steel, aggregates, electrical, plumbing)
• Bulk consolidation across countries = lower per-unit cost
• 1-2 day fulfillment in-market
• No minimum order change—flexible bulk ordering

QUICK WIN:
We can audit your top 3 material categories and show you exact savings in 48 hours. 
Example: A similar construction company saved KES 2M in their first month on cement + steel.

Are you open to a brief 15-min call this week to explore fit? I can share a 
cost-saving analysis specific to {prospect.get('COMPANY', 'your company')}.

Best,
Sokogate Team
sales@sokogate.com | +254 XXX XXX XXX
"""
            else:
                subject = f"Partnership Opportunity with Sokogate for {prospect.get('COMPANY', 'your organization')}"
                body = f"""Dear {prospect.get('DECISION_MAKER', 'Team')},

I hope this message finds you well. I'm reaching out from Sokogate, where we specialize in 
connecting businesses with reliable suppliers and distribution networks across Africa.

After reviewing {prospect.get('COMPANY', 'your organization')}'s work in {prospect.get('LOCATION', 'the region')}, 
I believe there could be valuable synergies between our organizations.

Our platform helps companies like yours:
- Access verified suppliers across multiple African markets
- Reduce procurement costs through bulk consolidation
- Streamline supply chain logistics
- Gain access to new market opportunities

Would you be open to a brief conversation next week to explore potential collaboration?

Best regards,
Sokogate Business Development
sales@sokogate.com | +254 XXX XXX XXX
"""
            
            return subject, body
            
        except Exception as e:
            logger.error(f"Error generating template: {e}")
            # Fallback template
            subject = f"Business Opportunity - Sokogate Partnership"
            body = f"""Dear {prospect.get('DECISION_MAKER', 'Team')},

I'm reaching out from Sokogate to discuss potential partnership opportunities.

Best regards,
Sokogate Team
"""
            return subject, body

    def send_email(self, to_email: str, subject: str, body: str) -> bool:
        """Send a single email"""
        try:
            # Create message
            msg = MIMEMultipart()
            msg['From'] = self.from_email
            msg['To'] = to_email
            msg['Subject'] = subject

            # Add body to email
            msg.attach(MIMEText(body, 'plain'))

            # Create SMTP session
            server = smtplib.SMTP(self.smtp_host, self.smtp_port)
            server.starttls()  # Enable security
            
            if self.smtp_user and self.smtp_pass:
                server.login(self.smtp_user, self.smtp_pass)
            
            text = msg.as_string()
            server.sendmail(self.from_email, to_email, text)
            server.quit()
            
            logger.info(f"Email sent successfully to {to_email}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to send email to {to_email}: {e}")
            return False

    def send_bulk_emails(self, csv_files: List[str], delay_seconds: float = 1.0) -> Dict:
        """Send emails to all prospects in the provided CSV files"""
        all_prospects = []
        
        # Load prospects from all CSV files
        for csv_file in csv_files:
            if os.path.exists(csv_file):
                prospects = self.load_csv_prospects(csv_file)
                all_prospects.extend(prospects)
                logger.info(f"Loaded {len(prospects)} prospects from {csv_file}")
            else:
                logger.warning(f"CSV file not found: {csv_file}")
        
        if not all_prospects:
            logger.error("No prospects loaded from any CSV files")
            return {"sent": 0, "failed": 0, "total": 0}
        
        logger.info(f"Starting email campaign to {len(all_prospects)} prospects")
        
        # Send emails
        for i, prospect in enumerate(all_prospects, 1):
            email = prospect.get('EMAIL', '').strip()
            if not email:
                logger.warning(f"Skipping prospect {i} - no email address")
                continue
            
            # Get personalized email content
            subject, body = self.get_email_template(prospect)
            
            # Send email
            success = self.send_email(email, subject, body)
            
            if success:
                self.sent_count += 1
            else:
                self.failed_count += 1
                self.failed_emails.append({
                    'email': email,
                    'company': prospect.get('COMPANY', 'Unknown'),
                    'reason': 'SMTP failure'
                })
            
            # Progress logging
            if i % 10 == 0 or i == len(all_prospects):
                logger.info(f"Progress: {i}/{len(all_prospects)} emails processed")
            
            # Delay between emails to avoid rate limiting
            if i < len(all_prospects):  # Don't sleep after the last email
                time.sleep(delay_seconds)
        
        # Final summary
        logger.info(f"Email campaign completed. Sent: {self.sent_count}, Failed: {self.failed_count}")
        
        return {
            "sent": self.sent_count,
            "failed": self.failed_count,
            "total": len(all_prospects),
            "failed_emails": self.failed_emails
        }

def main():
    """Main function to run the email sender"""
    print("🚀 Sokogate Email Sender Utility")
    print("=" * 50)
    
    # Configuration - you can modify these or set via environment variables
    SMTP_HOST = os.getenv('SMTP_HOST', 'localhost')
    SMTP_PORT = int(os.getenv('SMTP_PORT', '587'))
    SMTP_USER = os.getenv('SMTP_USER', '')
    SMTP_PASS = os.getenv('SMTP_PASS', '')
    FROM_EMAIL = os.getenv('FROM_EMAIL', SMTP_USER)
    
    # CSV files to process
    csv_files = [
        '/mnt/c/Users/LapTop/OneDrive/文档/UTCLTD/sales-and-funding-assets/TRACKER-PROSPECTS.csv',
        '/mnt/c/Users/LapTop/OneDrive/文档/UTCLTD/sales-and-funding-assets/TRACKER-INVESTORS.csv',
        '/mnt/c/Users/LapTop/OneDrive/文档/UTCLTD/sales-and-funding-assets/TRACKER-PARTNERSHIPS.csv'
    ]
    
    # Initialize email sender
    sender = EmailSender(
        smtp_host=SMTP_HOST,
        smtp_port=SMTP_PORT,
        smtp_user=SMTP_USER,
        smtp_pass=SMTP_PASS,
        from_email=FROM_EMAIL
    )
    
    # Show configuration
    print(f"📧 SMTP Server: {SMTP_HOST}:{SMTP_PORT}")
    print(f"📧 From Email: {FROM_EMAIL or '(using SMTP user)'}")
    print(f"📁 CSV Files: {len([f for f in csv_files if os.path.exists(f)])} found")
    print()
    
    # Check if we have valid SMTP credentials
    if not SMTP_USER or not SMTP_PASS:
        print("⚠️  Warning: SMTP credentials not configured.")
        print("   The script will attempt to send emails but may fail without authentication.")
        print("   Set SMTP_USER and SMTP_PASS environment variables for real email sending.")
        print()
        
        # Ask if user wants to continue anyway
        response = input("Continue anyway? (y/N): ").strip().lower()
        if response not in ['y', 'yes']:
            print("Email sending cancelled.")
            return
    
    # Confirm before sending
    total_prospects = 0
    for csv_file in csv_files:
        if os.path.exists(csv_file):
            # Quick count
            with open(csv_file, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    email_field = row.get('EMAIL', '')
                    if email_field:
                        emails = re.findall(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', email_field)
                        total_prospects += len(emails)
    
    print(f"📊 Found {total_prospects} email addresses to contact")
    
    if total_prospects == 0:
        print("❌ No email addresses found in CSV files.")
        return
    
    confirm = input(f"\nSend emails to {total_prospects} prospects? (y/N): ").strip().lower()
    if confirm not in ['y', 'yes']:
        print("Email sending cancelled.")
        return
    
    # Send emails
    print("\n📧 Starting email campaign...")
    results = sender.send_bulk_emails(csv_files, delay_seconds=2.0)  # 2 second delay between emails
    
    # Show results
    print("\n" + "=" * 50)
    print("📈 EMAIL CAMPAIGN RESULTS")
    print("=" * 50)
    print(f"✅ Successfully sent: {results['sent']}")
    print(f"❌ Failed to send: {results['failed']}")
    print(f"📊 Total processed: {results['total']}")
    
    if results['failed'] > 0:
        print(f"\n❌ Failed emails:")
        for failed in results['failed_emails'][:5]:  # Show first 5 failures
            print(f"   - {failed['email']} ({failed['company']})")
        if len(results['failed_emails']) > 5:
            print(f"   ... and {len(results['failed_emails']) - 5} more")
    
    print(f"\n📋 Detailed logs saved to: email_sender.log")
    print("🎉 Email campaign completed!")

if __name__ == "__main__":
    main()
