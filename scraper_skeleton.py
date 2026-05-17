import subprocess
import json
import uuid
import logging
import argparse
import asyncio
import os
from datetime import datetime
from playwright.async_api import async_playwright
from playwright_stealth import stealth

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

class DBManager:
    def __init__(self):
        self.cmd = "team-db"

    def execute_query(self, query):
        logging.debug(f"Executing query: {query}")
        try:
            result = subprocess.run([self.cmd, query], capture_output=True, text=True, check=True)
            if result.stdout.strip():
                return json.loads(result.stdout)
            return []
        except subprocess.CalledProcessError as e:
            logging.error(f"Error executing query: {e.stderr}")
            raise
        except json.JSONDecodeError as e:
            logging.error(f"Error decoding JSON: {e}")
            return []

    def escape_str(self, val):
        if val is None:
            return "NULL"
        return f"'{str(val).replace("'", "''")}'"

    def upsert_category(self, cat_id, name, parent_id=None, weight=1.0):
        query = f"""
        INSERT INTO categories (id, name, parent_id, weight)
        VALUES ({self.escape_str(cat_id)}, {self.escape_str(name)}, {self.escape_str(parent_id)}, {weight})
        ON CONFLICT(id) DO UPDATE SET
            name = EXCLUDED.name,
            parent_id = EXCLUDED.parent_id,
            weight = EXCLUDED.weight
        """
        return self.execute_query(query)

    def upsert_supplier(self, supplier_id, name, contact_info=None, location=None, rating=None):
        rating_val = str(rating) if rating is not None else "NULL"
        
        query = f"""
        INSERT INTO suppliers (id, name, contact_info, location, rating)
        VALUES ({self.escape_str(supplier_id)}, {self.escape_str(name)}, {self.escape_str(contact_info)}, {self.escape_str(location)}, {rating_val})
        ON CONFLICT(id) DO UPDATE SET
            name = EXCLUDED.name,
            contact_info = EXCLUDED.contact_info,
            location = EXCLUDED.location,
            rating = EXCLUDED.rating
        """
        return self.execute_query(query)

    def upsert_product(self, product_id, name, description=None, price=None, currency=None, 
                       supplier_id=None, category_id=None, url=None, image_url=None,
                       transaction_volume=0, page_views=0, buyer_count=0):
        price_val = str(price) if price is not None else "NULL"
        now = datetime.now().isoformat()
        
        query = f"""
        INSERT INTO products (id, name, description, price, currency, supplier_id, category_id, url, image_url, updated_at, transaction_volume, page_views, buyer_count)
        VALUES ({self.escape_str(product_id)}, {self.escape_str(name)}, {self.escape_str(description)}, {price_val}, {self.escape_str(currency)}, {self.escape_str(supplier_id)}, {self.escape_str(category_id)}, {self.escape_str(url)}, {self.escape_str(image_url)}, '{now}', {transaction_volume}, {page_views}, {buyer_count})
        ON CONFLICT(id) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            price = EXCLUDED.price,
            currency = EXCLUDED.currency,
            supplier_id = EXCLUDED.supplier_id,
            category_id = EXCLUDED.category_id,
            url = EXCLUDED.url,
            image_url = EXCLUDED.image_url,
            updated_at = EXCLUDED.updated_at,
            transaction_volume = EXCLUDED.transaction_volume,
            page_views = EXCLUDED.page_views,
            buyer_count = EXCLUDED.buyer_count
        """
        return self.execute_query(query)

class SokogateScraper:
    def __init__(self):
        self.db = DBManager()
        self.base_url = "https://sokogate.com"
        # Set browser path for environment
        if 'PLAYWRIGHT_BROWSERS_PATH' not in os.environ:
            os.environ['PLAYWRIGHT_BROWSERS_PATH'] = os.path.expanduser('~/playwright-browsers')

    async def get_page(self, browser_context, url):
        page = await browser_context.new_page()
        await stealth(page)
        # Site audit mentioned SSL issues, ignore if possible via context args
        logging.info(f"Navigating to {url}...")
        await page.goto(url, wait_until="networkidle")
        return page

    async def scrape_categories(self, browser_context):
        logging.info("Scraping categories...")
        # page = await self.get_page(browser_context, f"{self.base_url}/categories")
        # Example: Find categories and upsert
        # await self.db.upsert_category("cat123", "Electronics")
        # await page.close()
        pass

    async def scrape_products_by_category(self, browser_context, category_id):
        logging.info(f"Scraping products for category {category_id}...")
        # Use headless browser as recommended for dynamic content
        pass

    async def run(self, args):
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            # site audit mentioned invalid certificate, so we ignore it
            context = await browser.new_context(ignore_https_errors=True)
            
            if args.scrape_all:
                await self.scrape_categories(context)
                # ... loop logic
            elif args.scrape_categories:
                await self.scrape_categories(context)
            elif args.category:
                await self.scrape_products_by_category(context, args.category)
            
            await browser.close()

async def main():
    parser = argparse.ArgumentParser(description="Sokogate Scraper (Playwright)")
    parser.add_argument("--scrape-all", action="store_true", help="Run full scrape")
    parser.add_argument("--scrape-categories", action="store_true", help="Scrape only categories")
    parser.add_argument("--category", type=str, help="Scrape products for a specific category ID")
    parser.add_argument("--test-db", action="store_true", help="Test database connection")
    
    args = parser.parse_args()
    scraper = SokogateScraper()

    if args.test_db:
        try:
            res = scraper.db.execute_query("SELECT 1")
            logging.info(f"DB Connection successful: {res}")
        except Exception as e:
            logging.error(f"DB Connection failed: {e}")
    
    if args.scrape_all or args.scrape_categories or args.category:
        await scraper.run(args)

if __name__ == "__main__":
    asyncio.run(main())
