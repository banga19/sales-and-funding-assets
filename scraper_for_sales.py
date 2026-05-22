#!/usr/bin/env python3
"""
Sokogate Product Scraper for Sales Outreach
Extracts product data from sokogate.com to use in sales pitches and email campaigns
"""

import sys
import os
import json
import asyncio
import logging
from datetime import datetime
from typing import List, Dict, Any

# Add the scraper directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'scraper'))

from sokogate_scraper.config import settings
from sokogate_scraper.stealth.user_agents import UserAgentPool
from sokogate_scraper.stealth.proxy_rotation import ProxyPool
from sokogate_scraper.stealth.rate_limiter import TokenBucket
from sokogate_scraper.parsers.woocommerce import WooCommerceParser

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('scraper_for_sales.log'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

class SokogateProductScraper:
    def __init__(self, base_url: str = None, max_pages: int = 5, max_products: int = 20):
        self.base_url = base_url or settings.sokogate.base_url
        self.max_pages = max_pages
        self.max_products = max_products
        
        # Initialize stealth components
        self.ua_pool = UserAgentPool(settings.scraper.user_agent_pool_file)
        self.proxy_pool = ProxyPool(settings.scraper.proxy_pool_file) if settings.scraper.proxy_enabled else None
        self.limiter = TokenBucket(
            rate=settings.scraper.max_concurrency,
            burst=settings.scraper.max_concurrency,
        )
        
        # Initialize parser (we'll use it without DB persistence)
        self.parser = WooCommerceParser(
            base_url=self.base_url,
            max_pages=self.max_pages,
            max_products=self.max_products,
            user_agent_pool=self.ua_pool,
            proxy_pool=self.proxy_pool,
            limiter=self.limiter,
            run_id="sales_scraper_" + datetime.now().strftime("%Y%m%d_%H%M%S")
        )
    
    async def scrape_products(self) -> List[Dict[str, Any]]:
        """
        Scrape product data from sokogate.com
        Returns a list of product dictionaries
        """
        logger.info(f"Starting product scrape from {self.base_url}")
        logger.info(f"Settings: max_pages={self.max_pages}, max_products={self.max_products}")
        
        try:
            # Phase 1: discover product URLs
            logger.info("Discovering product URLs...")
            product_urls = await self.parser.discover_product_urls()
            logger.info(f"Discovered {len(product_urls)} product URLs")
            
            # Limit to max_products
            product_urls = product_urls[:self.max_products]
            logger.info(f"Limited to {len(product_urls)} products for scraping")
            
            # Phase 2: scrape each detail page
            scraped_products = []
            failed_urls = []
            
            for i, product_url in enumerate(product_urls):
                try:
                    await self.limiter.acquire()
                    result = await self.parser.parse_detail_page(product_url, self.parser.run_id)
                    if result:
                        scraped_products.append(result)
                    logger.info(f"Scraped {i+1}/{len(product_urls)}: {result.get('name', 'Unknown') if result else 'Failed'}")
                except Exception as e:
                    logger.warning(f"Failed to scrape {product_url}: {e}")
                    failed_urls.append(product_url)
            
            logger.info(f"Scraping complete. Successful: {len(scraped_products)}, Failed: {len(failed_urls)}")
            
            # Clean up the data for sales use
            cleaned_products = self._clean_product_data(scraped_products)
            return cleaned_products
            
        except Exception as e:
            logger.error(f"Error during scraping: {e}")
            return []
    
    def _clean_product_data(self, products: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Clean and format product data for sales outreach
        """
        cleaned = []
        for product in products:
            cleaned_product = {
                'id': product.get('source_url', '').split('/')[-1] if product.get('source_url') else '',
                'name': product.get('name', ''),
                'description': product.get('description', ''),
                'category': product.get('category', 'General'),
                'price': product.get('price_numeric'),
                'price_raw': product.get('price_raw'),
                'currency': product.get('currency', 'KES'),
                'sku': product.get('sku', ''),
                'in_stock': product.get('in_stock', True),
                'images': product.get('images', []),
                'specifications': product.get('specifications', {}),
                'attributes': product.get('attributes', {}),
                'tags': product.get('tags', []),
                'source_url': product.get('source_url', ''),
                'last_scraped': datetime.now().isoformat()
            }
            cleaned.append(cleaned_product)
        return cleaned
    
    def save_to_json(self, products: List[Dict[str, Any]], filename: str = None):
        """
        Save product data to JSON file
        """
        if filename is None:
            filename = f"sokogate_products_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        
        try:
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(products, f, indent=2, ensure_ascii=False)
            logger.info(f"Saved {len(products)} products to {filename}")
        except Exception as e:
            logger.error(f"Error saving to JSON: {e}")
    
    def save_to_csv(self, products: List[Dict[str, Any]], filename: str = None):
        """
        Save product data to CSV file (flattened)
        """
        import csv
        
        if filename is None:
            filename = f"sokogate_products_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        
        try:
            if not products:
                logger.warning("No products to save to CSV")
                return
            
            # Flatten the data for CSV
            flattened = []
            for product in products:
                flat_product = {
                    'id': product['id'],
                    'name': product['name'],
                    'description': product['description'],
                    'category': product['category'],
                    'price': product['price'],
                    'price_raw': product['price_raw'],
                    'currency': product['currency'],
                    'sku': product['sku'],
                    'in_stock': product['in_stock'],
                    'source_url': product['source_url'],
                    'last_scraped': product['last_scraped'],
                    # Join images and specs as strings
                    'images': ' | '.join(product['images']) if product['images'] else '',
                    'specifications_count': len(product['specifications']),
                    'tags': ' | '.join(product['tags']) if product['tags'] else ''
                }
                flattened.append(flat_product)
            
            # Write CSV
            if flattened:
                keys = flattened[0].keys()
                with open(filename, 'w', newline='', encoding='utf-8') as f:
                    writer = csv.DictWriter(f, fieldnames=keys)
                    writer.writeheader()
                    writer.writerows(flattened)
                
                logger.info(f"Saved {len(flattened)} products to {filename}")
        except Exception as e:
            logger.error(f"Error saving to CSV: {e}")

async def main():
    """
    Main function to run the scraper
    """
    print("🕷️  Sokogate Product Scraper for Sales Outreach")
    print("=" * 60)
    
    # Initialize scraper
    scraper = SokogateProductScraper(
        base_url="https://sokogate.com",
        max_pages=3,   # Limit pages for faster testing
        max_products=10  # Limit products for faster testing
    )
    
    # Scrape products
    products = await scraper.scrape_products()
    
    if products:
        # Save results
        scraper.save_to_json(products, "sokogate_products_sales.json")
        scraper.save_to_csv(products, "sokogate_products_sales.csv")
        
        # Print summary
        print("\n📊 SCRAPING RESULTS")
        print("=" * 60)
        print(f"✅ Successfully scraped: {len(products)} products")
        
        # Show first few products
        print("\n📦 Sample Products:")
        for i, product in enumerate(products[:5], 1):
            print(f"{i}. {product['name']} - {product['category']}")
            print(f"   Price: {product['price']} {product['currency']}")
            print(f"   In Stock: {product['in_stock']}")
            print(f"   SKU: {product['sku'] or 'N/A'}")
            print(f"   URL: {product['source_url'][:80]}...")
            print()
        
        # Show categories
        categories = list(set(p['category'] for p in products if p['category']))
        print(f"📂 Categories found: {', '.join(categories[:10])}")
        if len(categories) > 10:
            print(f"    ... and {len(categories)-10} more")
        
        print(f"\n💾 Data saved to:")
        print(f"   - sokogate_products_sales.json")
        print(f"   - sokogate_products_sales.csv")
        print(f"   - scraper_for_sales.log (detailed logs)")
        
    else:
        print("❌ No products were scraped. Check the logs for details.")
    
    print("\n🎉 Scraping completed!")

if __name__ == "__main__":
    asyncio.run(main())
