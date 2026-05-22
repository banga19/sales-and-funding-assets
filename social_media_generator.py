import os
#!/usr/bin/env python3
"""
Social Media Content Generator for Sales and Funding Outreach
Creates engaging social media content from product data and prospect information
"""

import json
import csv
import re
import random
from datetime import datetime, timedelta
from typing import List, Dict, Any
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('social_media_generator.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

class SocialMediaContentGenerator:
    def __init__(self):
        # Content templates for different platforms
        self.linkedin_templates = [
            "🚀 Just discovered amazing {product_category} solutions that could help {prospect_company} reduce costs by up to 20%!\n\n{product_name} offers:\n• {key_benefit_1}\n• {key_benefit_2}\n• {key_benefit_3}\n\nPerfect for companies in {prospect_location} looking to optimize their supply chain. #Procurement #SupplyChain #AfricaBusiness",
            
            "💡 Innovation alert: {product_name} is transforming how businesses approach {product_category} procurement.\n\nWith features like {feature_1} and {feature_2}, companies are seeing:\n- {result_1}\n- {result_2}\n- {result_3}\n\nCould this be the solution {prospect_company} has been looking for? #Innovation #BusinessGrowth",
            
            "📈 Market insight: The {product_category} sector in {prospect_location} is ripe for optimization.\n\nRecent data shows companies using advanced sourcing solutions like {product_name} achieve:\n• Average cost savings: {savings_percent}%\n• Reduced lead times: {time_reduction}%\n• Improved supplier reliability: {reliability_improvement}%\n\nReady to explore how this could work for {prospect_company}? #MarketInsights #B2B"
        ]
        
        self.twitter_templates = [
            "🚨 Just found {product_name} - game-changing {product_category} solution!\n\n✂️ Cut costs by {savings_percent}%\n⚡ Speed up delivery by {speed_improvement}%\n🔒 Boost supplier reliability\n\nPerfect for {prospect_company} types. #ProcurementTech #AfricanBusiness",
            
            "💼 Hey {prospect_company} team! Tired of overpaying for {product_category}?\n\n{product_name} offers direct manufacturer access with:\n• {benefit_1}\n• {benefit_2}\n• {benefit_3}\n\nLet's chat about saving you money! #B2B #SupplyChain",
            
            "📊 Quick stat: Companies using smart {product_category} sourcing save avg {savings_percent}% annually.\n\n{product_name} makes this happen through:\n🔹 Direct manufacturer partnerships\n🔹 Bulk consolidation across regions\n🔹 Quality guaranteed\n\nWho wants to learn more? #BusinessTips"
        ]
        
        self.facebook_templates = [
            "🌟 Exciting news for businesses in {prospect_location}!\n\nWe've identified a fantastic opportunity for {prospect_company} to optimize your {product_category} procurement with {product_name}.\n\n🔹 What it offers: {key_feature}\n🔹 Benefits: {benefit_1}, {benefit_2}, {benefit_3}\n🔹 Expected ROI: {roi_timeframe}\n\nThis could be just what you need to stay competitive in today's market. Interested in learning more? Drop a comment or send us a message!\n\n#BusinessOpportunity #ProcurementSolutions",
            
            "🎯 Targeted solution alert!\n\nIf you're in the {prospect_industry} industry in {prospect_location} and dealing with {pain_point}, you need to see this.\n\n{product_name} solves exactly these problems by providing:\n✅ Solution 1: {solution_1}\n✅ Solution 2: {solution_2}\n✅ Solution 3: {solution_3}\n\nCompanies like yours are already seeing results. Want to see how it works for your specific situation? #IndustrySolution",
            
            "💰 Money-saving opportunity spotted!\n\nDid you know the average company in {prospect_location} overspends by {overspend_percent}% on {product_category} due to fragmented supplier networks?\n\n{product_name} changes that by offering:\n• 🌍 Direct access to verified manufacturers\n• 📦 Bulk ordering benefits\n• 🚚 Faster, more reliable delivery\n• 📋 Quality assurance processes\n\nLet's discuss how this applies to {prospect_company}! #CostSaving #BusinessGrowth"
        ]
        
        # Industry-specific pain points and solutions
        self.industry_data = {
            "construction": {
                "pain_points": ["material procurement inefficiencies", "supplier reliability issues", "price volatility", "long lead times"],
                "solutions": ["direct manufacturer partnerships", "bulk consolidation", "quality assurance programs", "just-in-time delivery"],
                "benefits": ["reduced material costs by 15-25%", "implemented guaranteed supply chains", "cut procurement time by 40%"],
                "roi_timeframe": "2-3 months"
            },
            "manufacturing": {
                "pain_points": ["component shortages", "quality inconsistency", "high inventory costs", "supply chain disruptions"],
                "solutions": ["vendor managed inventory", "supplier quality programs", "dual sourcing strategies", "real-time inventory tracking"],
                "benefits": ["reduced stockouts by 60%", "improved quality scores by 30%", "lowered carrying costs by 25%"],
                "roi_timeframe": "3-4 months"
            },
            "retail": {
                "pain_points": ["stockouts", "overstock issues", "slow-moving inventory", "inconsistent product quality"],
                "solutions": ["demand forecasting partnerships", "consignment inventory programs", "supplier scorecards", "collaborative planning"],
                "benefits": ["increased inventory turns by 35%", "reduced markdowns by 20%", "improved fill rates to 95%+"],
                "roi_timeframe": "4-5 months"
            },
            "healthcare": {
                "pain_points": ["supply chain reliability", "product authenticity concerns", "temperature control issues", "regulatory compliance"],
                "solutions": ["certified supplier networks", "cold chain logistics", "blockchain traceability", "automated compliance tracking"],
                "benefits": ["ensured product authenticity", "reduced waste by 40%", "maintained 99.8% compliance rate"],
                "roi_timeframe": "3-6 months"
            }
        }
    
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
    
    def determine_industry(self, prospect: Dict) -> str:
        """Determine industry based on prospect data"""
        company = prospect.get('COMPANY', '').lower()
        location = prospect.get('LOCATION', '').lower()
        notes = prospect.get('NOTES', '').lower()
        
        # Simple keyword matching
        if any(word in company or word in location or word in notes for word in ['construction', 'build', 'contract', 'engineering']):
            return 'construction'
        elif any(word in company or word in location or word in notes for word in ['manufacturing', 'factory', 'production', 'industrial']):
            return 'manufacturing'
        elif any(word in company or word in location or word in notes for word in ['retail', 'shop', 'store', 'trade', 'wholesale']):
            return 'retail'
        elif any(word in company or word in location or word in notes for word in ['health', 'medical', 'hospital', 'clinic', 'pharma']):
            return 'healthcare'
        else:
            # Default to construction since that's what we see in the data
            return 'construction'
    
    def generate_product_data(self) -> List[Dict]:
        """Generate sample product data for demonstration"""
        # In a real implementation, this would come from scraped data
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
            },
            {
                'name': 'Electrical Cables & Wiring',
                'category': 'Electrical Supplies',
                'price': 1200,
                'currency': 'KES',
                'features': ['KEBS certified', 'Fire retardant options', 'Various gauges'],
                'benefits': ['Safety compliance', 'Long-term durability', 'Technical support available'],
                'supplier': 'PowerConnect Distribution',
                'sku': 'ECW-2.5'
            },
            {
                'name': 'Roofing Sheets',
                'category': 'Construction Materials',
                'price': 3200,
                'currency': 'KES',
                'features': ['Pre-painted options', 'Various profiles', 'Long span capabilities'],
                'benefits': ['Weather resistance guarantee', 'Aesthetic variety', 'Lightweight yet strong'],
                'supplier': 'RoofTech Solutions',
                'sku': 'RS-0.5'
            }
        ]
        return sample_products
    
    def generate_linkedin_post(self, prospect: Dict, product: Dict) -> str:
        """Generate LinkedIn post content"""
        industry = self.determine_industry(prospect)
        industry_info = self.industry_data.get(industry, self.industry_data['construction'])
        
        template = random.choice(self.linkedin_templates)
        
        # Fill in the template
        content = template.format(
            product_name=product['name'],
            product_category=product['category'],
            prospect_company=prospect.get('COMPANY', 'your company'),
            prospect_location=prospect.get('LOCATION', 'your region'),
            prospect_industry=industry.title(),
            key_benefit_1=random.choice(product['benefits']) if product['benefits'] else 'Cost savings',
            key_benefit_2=random.choice([b for b in product['benefits'] if b != locals().get('key_benefit_1', '')]) if len(product['benefits']) > 1 else 'Improved quality',
            key_benefit_3=random.choice([b for b in product['benefits'] if b not in [locals().get('key_benefit_1', ''), locals().get('key_benefit_2', '')]]) if len(product['benefits']) > 2 else 'Reliable supply',
            feature_1=random.choice(product['features']) if product['features'] else 'Direct manufacturer access',
            feature_2=random.choice([f for f in product['features'] if f != locals().get('feature_1', '')]) if len(product['features']) > 1 else 'Quality assurance',
            result_1=random.choice(industry_info['benefits']) if industry_info['benefits'] else 'Cost reduction',
            result_2=random.choice([b for b in industry_info['benefits'] if b != locals().get('result_1', '')]) if len(industry_info['benefits']) > 1 else 'Efficiency gains',
            result_3=random.choice([b for b in industry_info['benefits'] if b not in [locals().get('result_1', ''), locals().get('result_2', '')]]) if len(industry_info['benefits']) > 2 else 'Better supplier relations',
            savings_percent=random.randint(15, 25),
            time_reduction=random.randint(20, 40),
            reliability_improvement=random.randint(25, 45)
        )
        
        return content
    
    def generate_twitter_post(self, prospect: Dict, product: Dict) -> str:
        """Generate Twitter/X post content"""
        industry = self.determine_industry(prospect)
        industry_info = self.industry_data.get(industry, self.industry_data['construction'])
        
        template = random.choice(self.twitter_templates)
        
        # Fill in the template
        content = template.format(
            product_name=product['name'],
            product_category=product['category'],
            prospect_company=prospect.get('COMPANY', 'your company'),
            savings_percent=random.randint(15, 30),
            speed_improvement=random.randint(25, 50),
            benefit_1=random.choice(product['benefits']) if product['benefits'] else 'Lower costs',
            benefit_2=random.choice([b for b in product['benefits'] if b != locals().get('benefit_1', '')]) if len(product['benefits']) > 1 else 'Better quality',
            benefit_3=random.choice([b for b in product['benefits'] if b not in [locals().get('benefit_1', ''), locals().get('benefit_2', '')]]) if len(product['benefits']) > 2 else 'Reliable supply'
        )
        
        # Truncate to Twitter character limit if needed
        if len(content) > 280:
            content = content[:277] + "..."
        
        return content
    
    def generate_facebook_post(self, prospect: Dict, product: Dict) -> str:
        """Generate Facebook post content"""
        industry = self.determine_industry(prospect)
        industry_info = self.industry_data.get(industry, self.industry_data['construction'])
        
        template = random.choice(self.facebook_templates)
        
        # Fill in the template
        content = template.format(
            product_name=product['name'],
            product_category=product['category'],
            prospect_company=prospect.get('COMPANY', 'your company'),
            prospect_location=prospect.get('LOCATION', 'your region'),
            prospect_industry=industry.title(),
            key_feature=random.choice(product['features']) if product['features'] else 'Direct manufacturer partnerships',
            benefit_1=random.choice(product['benefits']) if product['benefits'] else 'Cost savings',
            benefit_2=random.choice([b for b in product['benefits'] if b != locals().get('benefit_1', '')]) if len(product['benefits']) > 1 else 'Quality improvement',
            benefit_3=random.choice([b for b in product['benefits'] if b not in [locals().get('benefit_1', ''), locals().get('benefit_2', '')]]) if len(product['benefits']) > 2 else 'Supply chain reliability',
            roi_timeframe=industry_info['roi_timeframe'],
            pain_point=random.choice(industry_info['pain_points']) if industry_info['pain_points'] else 'supply chain inefficiencies',
            solution_1=random.choice(industry_info['solutions']) if industry_info['solutions'] else 'direct sourcing',
            solution_2=random.choice([s for s in industry_info['solutions'] if s != locals().get('solution_1', '')]) if len(industry_info['solutions']) > 1 else 'bulk purchasing',
            solution_3=random.choice([s for s in industry_info['solutions'] if s not in [locals().get('solution_1', ''), locals().get('solution_2', '')]]) if len(industry_info['solutions']) > 2 else 'quality programs',
            overspend_percent=random.randint(20, 40)
        )
        
        return content
    
    def generate_content_for_prospect(self, prospect: Dict, product: Dict = None) -> Dict[str, str]:
        """Generate social media content for a specific prospect"""
        if product is None:
            products = self.generate_product_data()
            product = random.choice(products)
        
        content = {
            'linkedin': self.generate_linkedin_post(prospect, product),
            'twitter': self.generate_twitter_post(prospect, product),
            'facebook': self.generate_facebook_post(prospect, product),
            'prospect': prospect.get('COMPANY', 'Unknown'),
            'product': product['name'],
            'generated_at': datetime.now().isoformat()
        }
        
        return content
    
    def generate_campaign_content(self, csv_files: List[str], products_per_prospect: int = 2) -> List[Dict]:
        """Generate social media content for all prospects in CSV files"""
        all_prospects = []
        
        # Load prospects from all CSV files
        for csv_file in csv_files:
            if os.path.exists(csv_file):
                prospects = self.load_prospects_from_csv(csv_file)
                all_prospects.extend(prospects)
                logger.info(f"Loaded {len(prospects)} prospects from {csv_file}")
            else:
                logger.warning(f"CSV file not found: {csv_file}")
        
        if not all_prospects:
            logger.error("No prospects loaded from any CSV files")
            return []
        
        # Generate product data
        products = self.generate_product_data()
        
        # Generate content for each prospect
        campaign_content = []
        for prospect in all_prospects:
            # Generate multiple content pieces per prospect with different products
            for i in range(min(products_per_prospect, len(products))):
                product = products[i % len(products)]  # Cycle through products
                content = self.generate_content_for_prospect(prospect, product)
                campaign_content.append(content)
        
        logger.info(f"Generated {len(campaign_content)} social media content pieces")
        return campaign_content
    
    def save_content_to_json(self, content: List[Dict], filename: str = None):
        """Save generated content to JSON file"""
        if filename is None:
            filename = f"social_media_content_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        
        try:
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(content, f, indent=2, ensure_ascii=False)
            logger.info(f"Saved {len(content)} content pieces to {filename}")
        except Exception as e:
            logger.error(f"Error saving content to JSON: {e}")
    
    def save_content_to_markdown(self, content: List[Dict], filename: str = None):
        """Save generated content to markdown file for easy review"""
        if filename is None:
            filename = f"social_media_content_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
        
        try:
            with open(filename, 'w', encoding='utf-8') as f:
                f.write("# Social Media Content Campaign\n\n")
                f.write(f"Generated on: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
                f.write(f"Total content pieces: {len(content)}\n\n")
                
                for i, item in enumerate(content, 1):
                    f.write(f"## Content Piece {i}\n\n")
                    f.write(f"**Prospect:** {item['prospect']}\n\n")
                    f.write(f"**Product:** {item['product']}\n\n")
                    
                    f.write("### LinkedIn Post\n\n")
                    f.write(f"{item['linkedin']}\n\n")
                    
                    f.write("### Twitter Post\n\n")
                    f.write(f"{item['twitter']}\n\n")
                    
                    f.write("### Facebook Post\n\n")
                    f.write(f"{item['facebook']}\n\n")
                    
                    f.write("---\n\n")
            
            logger.info(f"Saved content to markdown: {filename}")
        except Exception as e:
            logger.error(f"Error saving content to markdown: {e}")

def main():
    """Main function to run the social media content generator"""
    print("📱 Social Media Content Generator for Sales Outreach")
    print("=" * 60)
    
    # CSV files to process
    csv_files = [
        '/mnt/c/Users/LapTop/OneDrive/文档/UTCLTD/sales-and-funding-assets/TRACKER-PROSPECTS.csv',
        '/mnt/c/Users/LapTop/OneDrive/文档/UTCLTD/sales-and-funding-assets/TRACKER-INVESTORS.csv',
        '/mnt/c/Users/LapTop/OneDrive/文档/UTCLTD/sales-and-funding-assets/TRACKER-PARTNERSHIPS.csv'
    ]
    
    # Initialize generator
    generator = SocialMediaContentGenerator()
    
    # Generate content
    print("\n🔄 Generating social media content...")
    campaign_content = generator.generate_campaign_content(csv_files, products_per_prospect=2)
    
    if campaign_content:
        # Save results
        generator.save_content_to_json(campaign_content, "social_media_campaign.json")
        generator.save_content_to_markdown(campaign_content, "social_media_campaign.md")
        
        # Show summary
        print(f"\n📊 CONTENT GENERATION RESULTS")
        print("=" * 60)
        print(f"✅ Content pieces generated: {len(campaign_content)}")
        
        # Show sample content
        print(f"\n📱 Sample Content (First Piece):")
        sample = campaign_content[0]
        print(f"Prospect: {sample['prospect']}")
        print(f"Product: {sample['product']}")
        print(f"\n🔗 LinkedIn:\n{sample['linkedin'][:200]}...")
        print(f"\n🐦 Twitter:\n{sample['twitter']}")
        print(f"\n📘 Facebook:\n{sample['facebook'][:200]}...")
        
        print(f"\n💾 Files saved:")
        print(f"   - social_media_campaign.json")
        print(f"   - social_media_campaign.md")
        print(f"   - social_media_generator.log")
        
    else:
        print("❌ No content was generated")
    
    print("\n🎉 Content generation completed!")

if __name__ == "__main__":
    main()
