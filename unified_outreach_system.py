#!/usr/bin/env python3
"""
Unified Sales and Funding Outreach Automation System
Integrates email sending, web scraping, and social media content generation
for comprehensive sales and funding campaigns
"""

import os
import sys
import json
import csv
import time
import logging
import asyncio
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional

# Add local modules to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('unified_outreach_system.log'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

class UnifiedOutreachSystem:
    def __init__(self):
        self.email_sender = None
        self.social_media_generator = None
        self.scraped_products = []
        self.campaign_stats = {
            'emails_sent': 0,
            'emails_failed': 0,
            'social_content_generated': 0,
            'products_scraped': 0,
            'prospects_processed': 0
        }
        
        # Initialize components
        self._initialize_components()
    
    def _initialize_components(self):
        """Initialize all system components"""
        try:
            # Import and initialize email sender
            from email_sender import EmailSender
            self.email_sender = EmailSender()
            logger.info("✅ Email sender initialized")
        except Exception as e:
            logger.warning(f"⚠️  Email sender initialization failed: {e}")
        
        try:
            # Import and initialize social media generator
            from social_media_generator import SocialMediaContentGenerator
            self.social_media_generator = SocialMediaContentGenerator()
            logger.info("✅ Social media generator initialized")
        except Exception as e:
            logger.warning(f"⚠️  Social media generator initialization failed: {e}")
        
        # Scraper will be initialized on demand
        logger.info("🔧 System components initialized")
    
    def load_prospects_from_csv(self, csv_file: str) -> List[Dict]:
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
                        import re
                        emails = re.findall(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', email_field)
                        for email in emails:
                            prospect = row.copy()
                            prospect['EMAIL'] = email.strip()
                            prospects.append(prospect)
                    else:
                        logger.debug(f"No email found for prospect: {row.get('COMPANY', 'Unknown')}")
            
            logger.info(f"Loaded {len(prospects)} email addresses from {csv_file}")
            return prospects
        except Exception as e:
            logger.error(f"Error loading CSV file {csv_file}: {e}")
            return []
    
    def scrape_products_for_personalization(self, max_products: int = 10) -> List[Dict]:
        """Scrape product data from sokogate.com for personalization"""
        logger.info("🕷️  Starting product scraping for personalization...")
        
        try:
            # Try to use the existing scraper infrastructure
            from scraper_for_sales import SokogateProductScraper
            
            scraper = SokogateProductScraper(
                base_url="https://sokogate.com",
                max_pages=2,
                max_products=max_products
            )
            
            # Run the scraper
            products = asyncio.run(scraper.scrape_products())
            
            if products:
                self.scraped_products = products
                self.campaign_stats['products_scraped'] = len(products)
                logger.info(f"✅ Successfully scraped {len(products)} products")
                return products
            else:
                logger.warning("⚠️  No products scraped, using sample data")
                return self._generate_sample_products()
                
        except Exception as e:
            logger.error(f"❌ Error in product scraping: {e}")
            logger.info("🔄 Falling back to sample product data")
            return self._generate_sample_products()
    
    def _generate_sample_products(self) -> List[Dict]:
        """Generate sample product data when scraping fails"""
        sample_products = [
            {
                'name': 'Premium Cement 42.5R',
                'category': 'Construction Materials',
                'price': 8500,
                'currency': 'KES',
                'features': ['High early strength', 'Consistent quality', 'Nationwide availability'],
                'benefits': ['Reduces curing time by 20%', 'Lower wastage rates', 'Reliable supply'],
                'supplier': 'East Africa Cement Ltd',
                'sku': 'CEM-425-001'
            },
            {
                'name': 'Structural Steel Beams',
                'category': 'Construction Materials',
                'price': 120000,
                'currency': 'KES',
                'features': ['Various sizes available', 'Galvanized options', 'Mill test certificates'],
                'benefits': ['Price stability guarantee', 'Just-in-time delivery', 'Third-party quality inspection'],
                'supplier': 'Steel Hub Africa',
                'sku': 'SSB-001'
            },
            {
                'name': 'PVC Pipes & Fittings',
                'category': 'Plumbing Supplies',
                'price': 450,
                'currency': 'KES',
                'features': ['SABS approved', 'UV resistant', 'Multiple diameters'],
                'benefits': ['50-year lifespan guarantee', 'Easy installation', 'Corrosion resistant'],
                'supplier': 'Plumbline Suppliers',
                'sku': 'PVC-110'
            }
        ]
        
        self.scraped_products = sample_products
        self.campaign_stats['products_scraped'] = len(sample_products)
        logger.info(f"📦 Generated {len(sample_products)} sample products")
        return sample_products
    
    def run_email_campaign(self, csv_files: List[str], delay_seconds: float = 2.0) -> Dict:
        """Run email campaign using prospect data"""
        logger.info("📧 Starting email campaign...")
        
        if not self.email_sender:
            logger.error("❌ Email sender not available")
            return {'sent': 0, 'failed': 0, 'total': 0}
        
        all_prospects = []
        
        # Load prospects from all CSV files
        for csv_file in csv_files:
            if os.path.exists(csv_file):
                prospects = self.load_prospects_from_csv(csv_file)
                all_prospects.extend(prospects)
                logger.info(f"📥 Loaded {len(prospects)} prospects from {csv_file}")
            else:
                logger.warning(f"📂 CSV file not found: {csv_file}")
        
        if not all_prospects:
            logger.error("❌ No prospects loaded from CSV files")
            return {'sent': 0, 'failed': 0, 'total': 0}
        
        self.campaign_stats['prospects_processed'] = len(all_prospects)
        
        # Get product data for personalization
        if not self.scraped_products:
            self.scrape_products_for_personalization()
        
        # Send emails
        results = self.email_sender.send_bulk_emails(csv_files, delay_seconds)
        
        # Update stats
        self.campaign_stats['emails_sent'] = results.get('sent', 0)
        self.campaign_stats['emails_failed'] = results.get('failed', 0)
        
        logger.info(f"📊 Email campaign completed: {results.get('sent', 0)} sent, {results.get('failed', 0)} failed")
        return results
    
    def generate_social_media_content(self, csv_files: List[str]) -> List[Dict]:
        """Generate social media content for prospects"""
        logger.info("📱 Generating social media content...")
        
        if not self.social_media_generator:
            logger.error("❌ Social media generator not available")
            return []
        
        # Load prospects
        all_prospects = []
        for csv_file in csv_files:
            if os.path.exists(csv_file):
                prospects = self.load_prospects_from_csv(csv_file)
                all_prospects.extend(prospects)
        
        if not all_prospects:
            logger.error("❌ No prospects for social media content")
            return []
        
        # Generate content
        content = self.social_media_generator.generate_campaign_content(
            csv_files, 
            products_per_prospect=2
        )
        
        self.campaign_stats['social_content_generated'] = len(content)
        
        # Save content
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        self.social_media_generator.save_content_to_json(
            content, 
            f"social_media_content_{timestamp}.json"
        )
        self.social_media_generator.save_content_to_markdown(
            content, 
            f"social_media_content_{timestamp}.md"
        )
        
        logger.info(f"📊 Generated {len(content)} social media content pieces")
        return content
    
    def run_full_campaign(self, 
                         csv_files: List[str] = None,
                         run_email: bool = True,
                         run_scraping: bool = True,
                         run_social: bool = True,
                         email_delay: float = 2.0) -> Dict:
        """Run the complete outreach campaign"""
        logger.info("🚀 Starting Unified Sales and Funding Outreach Campaign")
        logger.info("=" * 70)
        
        # Default CSV files
        if csv_files is None:
            csv_files = [
                '/mnt/c/Users/LapTop/OneDrive/文档/UTCLTD/sales-and-funding-assets/TRACKER-PROSPECTS.csv',
                '/mnt/c/Users/LapTop/OneDrive/文档/UTCLTD/sales-and-funding-assets/TRACKER-INVESTORS.csv',
                '/mnt/c/Users/LapTop/OneDrive/文档/UTCLTD/sales-and-funding-assets/TRACKER-PARTNERSHIPS.csv'
            ]
        
        start_time = datetime.now()
        
        # Step 1: Scrape product data (if enabled)
        if run_scraping:
            logger.info("\n🔍 STEP 1: Product Data Collection")
            logger.info("-" * 40)
            self.scrape_products_for_personalization(max_products=15)
        
        # Step 2: Run email campaign (if enabled)
        email_results = {}
        if run_email:
            logger.info("\n📧 STEP 2: Email Campaign Execution")
            logger.info("-" * 40)
            email_results = self.run_email_campaign(csv_files, email_delay)
        
        # Step 3: Generate social media content (if enabled)
        social_content = []
        if run_social:
            logger.info("\n📱 STEP 3: Social Media Content Generation")
            logger.info("-" * 40)
            social_content = self.generate_social_media_content(csv_files)
        
        # Calculate final stats
        end_time = datetime.now()
        duration = end_time - start_time
        
        self.campaign_stats.update({
            'campaign_start': start_time.isoformat(),
            'campaign_end': end_time.isoformat(),
            'campaign_duration_seconds': duration.total_seconds(),
            'campaign_duration_formatted': str(duration).split('.')[0]  # Remove microseconds
        })
        
        # Generate final report
        logger.info("\n📊 STEP 4: Campaign Results Summary")
        logger.info("=" * 70)
        self._print_campaign_summary()
        
        # Save campaign report
        self._save_campaign_report()
        
        return {
            'stats': self.campaign_stats,
            'email_results': email_results,
            'social_content_count': len(social_content),
            'scraped_products_count': len(self.scraped_products)
        }
    
    def _print_campaign_summary(self):
        """Print campaign summary to console"""
        stats = self.campaign_stats
        
        print(f"🎯 Campaign Duration: {stats.get('campaign_duration_formatted', 'N/A')}")
        print(f"📧 Emails Sent: {stats.get('emails_sent', 0)}")
        print(f"📧 Emails Failed: {stats.get('emails_failed', 0)}")
        print(f"📱 Social Content Generated: {stats.get('social_content_generated', 0)}")
        print(f"🕷️  Products Scraped: {stats.get('products_scraped', 0)}")
        print(f"👥 Prospects Processed: {stats.get('prospects_processed', 0)}")
        
        # Calculate success rate
        total_emails = stats.get('emails_sent', 0) + stats.get('emails_failed', 0)
        if total_emails > 0:
            success_rate = (stats.get('emails_sent', 0) / total_emails) * 100
            print(f"✅ Email Success Rate: {success_rate:.1f}%")
    
    def _save_campaign_report(self):
        """Save detailed campaign report to file"""
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        report_filename = f"outreach_campaign_report_{timestamp}.json"
        
        report = {
            'campaign_info': {
                'timestamp': timestamp,
                'system_version': '1.0.0',
                'components': {
                    'email_sender': self.email_sender is not None,
                    'social_media_generator': self.social_media_generator is not None,
                    'scraper': len(self.scraped_products) > 0
                }
            },
            'statistics': self.campaign_stats,
            'configuration': {
                'csv_files_processed': [
                    '/mnt/c/Users/LapTop/OneDrive/文档/UTCLTD/sales-and-funding-assets/TRACKER-PROSPECTS.csv',
                    '/mnt/c/Users/LapTop/OneDrive/文档/UTCLTD/sales-and-funding-assets/TRACKER-INVESTORS.csv',
                    '/mnt/c/Users/LapTop/OneDrive/文档/UTCLTD/sales-and-funding-assets/TRACKER-PARTNERSHIPS.csv'
                ]
            }
        }
        
        try:
            with open(report_filename, 'w', encoding='utf-8') as f:
                json.dump(report, f, indent=2, ensure_ascii=False)
            logger.info(f"💾 Campaign report saved to: {report_filename}")
        except Exception as e:
            logger.error(f"❌ Error saving campaign report: {e}")

def main():
    """Main function to run the unified outreach system"""
    print("🚀 Unified Sales and Funding Outreach Automation System")
    print("=" * 70)
    print("Integrating: Email Campaigns • Web Scraping • Social Media Generation")
    print()
    
    # Initialize the system
    system = UnifiedOutreachSystem()
    
    # Configuration options
    print("⚙️  Campaign Configuration:")
    print("   1. Run full campaign (email + scraping + social)")
    print("   2. Email campaign only")
    print("   3. Scraping + social media only")
    print("   4. Custom configuration")
    print()
    
    # For automated execution, we'll run the full campaign
    # In an interactive setting, we'd ask for user input
    print("🚀 Executing full campaign...")
    print()
    
    # Run the complete campaign
    results = system.run_full_campaign(
        csv_files=[
            '/mnt/c/Users/LapTop/OneDrive/文档/UTCLTD/sales-and-funding-assets/TRACKER-PROSPECTS.csv',
            '/mnt/c/Users/LapTop/OneDrive/文档/UTCLTD/sales-and-funding-assets/TRACKER-INVESTORS.csv',
            '/mnt/c/Users/LapTop/OneDrive/文档/UTCLTD/sales-and-funding-assets/TRACKER-PARTNERSHIPS.csv'
        ],
        run_email=True,
        run_scraping=True,
        run_social=True,
        email_delay=2.0  # 2 seconds between emails to avoid rate limiting
    )
    
    # Final message
    print("\n" + "=" * 70)
    print("🎉 UNIFIED OUTREACH CAMPAIGN COMPLETED!")
    print("=" * 70)
    print("📧 Check email_sender.log for email sending details")
    print("📱 Check social_media_*.json and .md for generated content")
    print("📊 Check outreach_campaign_report_*.json for full campaign analytics")
    print("📋 Check unified_outreach_system.log for complete system logs")
    print("\n💡 Next steps:")
    print("   1. Review generated social media content")
    print("   2. Monitor email delivery and responses")
    print("   3. Follow up with engaged prospects")
    print("   4. Iterate and optimize based on results")

if __name__ == "__main__":
    main()
