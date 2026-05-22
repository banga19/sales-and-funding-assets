#!/usr/bin/env python3
"""
Simple Sokogate scraper using requests and BeautifulSoup
"""

import requests
from bs4 import BeautifulSoup
import csv
import json
import time
import logging
from urllib.parse import urljoin, urlparse
import re

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('simple_scraper.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

class SimpleSokogateScraper:
    def __init__(self, base_url="https://sokogate.com"):
        self.base_url = base_url
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        })
        self.products = []
    
    def get_page(self, url):
        """Fetch a page and return BeautifulSoup object"""
        try:
            response = self.session.get(url, timeout=10)
            response.raise_for_status()
            return BeautifulSoup(response.content, 'html.parser')
        except Exception as e:
            logger.error(f"Error fetching {url}: {e}")
            return None
    
    def extract_product_links(self, soup):
        """Extract product links from a category/listing page"""
        product_links = []
        # Common selectors for product links
        selectors = [
            'a[href*="/product/"]',
            '.product-item a',
            '.product-link',
            'h2 a',
            'h3 a',
            '.product-title a'
        ]
        
        for selector in selectors:
            links = soup.select(selector)
            for link in links:
                href = link.get('href')
                if href:
                    full_url = urljoin(self.base_url, href)
                    if full_url not in product_links:
                        product_links.append(full_url)
        
        return product_links
    
    def parse_product_page(self, url):
        """Parse an individual product page"""
        logger.info(f"Parsing product: {url}")
        soup = self.get_page(url)
        if not soup:
            return None
        
        # Extract product data
        product = {
            'url': url,
            'title': self.extract_title(soup),
            'price': self.extract_price(soup),
            'description': self.extract_description(soup),
            'category': self.extract_category(soup),
            'sku': self.extract_sku(soup),
            'stock_status': self.extract_stock_status(soup),
            'images': self.extract_images(soup),
            'specifications': self.extract_specifications(soup)
        }
        
        return product
    
    def extract_title(self, soup):
        """Extract product title"""
        selectors = ['h1', '.product-title', '.entry-title', 'h2']
        for selector in selectors:
            element = soup.select_one(selector)
            if element and element.get_text(strip=True):
                return element.get_text(strip=True)
        return "Unknown Product"
    
    def extract_price(self, soup):
        """Extract product price"""
        selectors = ['.price', '.product-price', '.cost', '[class*="price"]']
        for selector in selectors:
            element = soup.select_one(selector)
            if element:
                text = element.get_text(strip=True)
                # Extract numeric price
                price_match = re.search(r'[\d,]+\.?\d*', text.replace(',', ''))
                if price_match:
                    try:
                        return float(price_match.group())
                    except ValueError:
                        pass
        return None
    
    def extract_description(self, soup):
        """Extract product description"""
        selectors = ['.description', '.product-description', '.entry-content', '.product-details']
        for selector in selectors:
            element = soup.select_one(selector)
            if element:
                return element.get_text(strip=True)[:500]  # Limit length
        return ""
    
    def extract_category(self, soup):
        """Extract product category"""
        # Try breadcrumbs
        breadcrumb_selectors = ['.breadcrumb', '.breadcrumbs', '[class*="breadcrumb"]']
        for selector in breadcrumb_selectors:
            element = soup.select_one(selector)
            if element:
                links = element.select('a')
                if len(links) > 1:
                    return links[-2].get_text(strip=True)  # Second to last is usually category
        
        # Try other category indicators
        cat_selectors = ['.category', '.product-category', '[class*="category"]']
        for selector in cat_selectors:
            element = soup.select_one(selector)
            if element:
                return element.get_text(strip=True)
        
        return "General"
    
    def extract_sku(self, soup):
        """Extract product SKU"""
        sku_selectors = ['.sku', '.product-sku', '[class*="sku"]']
        for selector in sku_selectors:
            element = soup.select_one(selector)
            if element:
                return element.get_text(strip=True)
        
        # Look for SKU in text
        text = soup.get_text()
        sku_match = re.search(r'SKU[:\s]*([A-Za-z0-9\-]+)', text, re.I)
        if sku_match:
            return sku_match.group(1)
        
        return ""
    
    def extract_stock_status(self, soup):
        """Extract stock availability"""
        stock_selectors = ['.stock', '.availability', '[class*="stock"]', '[class*="availability"]']
        for selector in stock_selectors:
            element = soup.select_one(selector)
            if element:
                text = element.get_text(strip=True).lower()
                if 'in stock' in text or 'available' in text:
                    return True
                elif 'out of stock' in text or 'unavailable' in text:
                    return False
        
        # Default to True if we can't determine
        return True
    
    def extract_images(self, soup):
        """Extract product images"""
        images = []
        img_selectors = ['img', '.product-image img', '[class*="image"] img']
        
        for selector in img_selectors:
            imgs = soup.select(selector)
            for img in imgs:
                src = img.get('src') or img.get('data-src') or img.get('data-lazy')
                if src:
                    full_url = urljoin(self.base_url, src)
                    if full_url not in images:
                        images.append(full_url)
        
        return images[:5]  # Limit to 5 images
    
    def extract_specifications(self, soup):
        """Extract product specifications"""
        specs = {}
        # Look for specification tables
        spec_selectors = ['.specifications', '.specs', '.product-specs', 'table']
        
        for selector in spec_selectors:
            elements = soup.select(selector)
            for element in elements:
                # Try to parse as key-value pairs
                rows = element.select('tr, .spec-row, .spec-item')
                for row in rows:
                    cells = row.select('td, th, .spec-key, .spec-value')
                    if len(cells) >= 2:
                        key = cells[0].get_text(strip=True)
                        value = cells[1].get_text(strip=True)
                        if key and value:
                            specs[key] = value
                
                # Also try dl/dt/dd
                dts = element.select('dt')
                dds = element.select('dd')
                if len(dts) == len(dds) and len(dts) > 0:
                    for dt, dd in zip(dts, dds):
                        key = dt.get_text(strip=True)
                        value = dd.get_text(strip=True)
                        if key and value:
                            specs[key] = value
        
        return specs
    
    def scrape_category_page(self, category_url):
        """Scrape all products from a category page"""
        logger.info(f"Scraping category: {category_url}")
        soup = self.get_page(category_url)
        if not soup:
            return []
        
        # Extract product links
        product_links = self.extract_product_links(soup)
        logger.info(f"Found {len(product_links)} product links")
        
        # Scrape each product
        products = []
        for i, link in enumerate(product_links[:10]):  # Limit to 10 products per category
            logger.info(f"Scraping product {i+1}/{min(10, len(product_links))}: {link}")
            product = self.parse_product_page(link)
            if product:
                products.append(product)
            time.sleep(1)  # Be respectful
        
        return products
    
    def scrape_products(self, max_categories=3):
        """Main scraping method"""
        logger.info("Starting Sokogate product scraping")
        
        # Start with the main page
        main_soup = self.get_page(self.base_url)
        if not main_soup:
            logger.error("Could not fetch main page")
            return []
        
        # Try to find category links
        category_selectors = [
            'a[href*="/product-category/"]',
            'a[href*="/category/"]',
            '.category-link',
            '[class*="category"] a'
        ]
        
        category_links = []
        for selector in category_selectors:
            links = main_soup.select(selector)
            for link in links:
                href = link.get('href')
                if href:
                    full_url = urljoin(self.base_url, href)
                    if full_url not in category_links and 'sokogate.com' in full_url:
                        category_links.append(full_url)
        
        logger.info(f"Found {len(category_links)} category links")
        
        # Scrape products from each category
        all_products = []
        for i, category_url in enumerate(category_links[:max_categories]):
            logger.info(f"Processing category {i+1}/{min(max_categories, len(category_links))}")
            products = self.scrape_category_page(category_url)
            all_products.extend(products)
            time.sleep(2)  # Delay between categories
        
        self.products = all_products
        logger.info(f"Scraping completed. Total products: {len(all_products)}")
        return all_products
    
    def save_to_json(self, filename="sokogate_products.json"):
        """Save products to JSON file"""
        try:
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(self.products, f, indent=2, ensure_ascii=False)
            logger.info(f"Saved {len(self.products)} products to {filename}")
        except Exception as e:
            logger.error(f"Error saving to JSON: {e}")
    
    def save_to_csv(self, filename="sokogate_products.csv"):
        """Save products to CSV file"""
        try:
            if not self.products:
                logger.warning("No products to save")
                return
            
            # Flatten for CSV
            flattened = []
            for product in self.products:
                flat_product = {
                    'title': product['title'],
                    'price': product['price'],
                    'description': product['description'],
                    'category': product['category'],
                    'sku': product['sku'],
                    'stock_status': product['stock_status'],
                    'url': product['url'],
                    'images_count': len(product['images']),
                    'specifications_count': len(product['specifications'])
                }
                flattened.append(flat_product)
            
            if flattened:
                keys = flattened[0].keys()
                with open(filename, 'w', newline='', encoding='utf-8') as f:
                    import csv
                    writer = csv.DictWriter(f, fieldnames=keys)
                    writer.writeheader()
                    writer.writerows(flattened)
                
                logger.info(f"Saved {len(flattened)} products to {filename}")
        except Exception as e:
            logger.error(f"Error saving to CSV: {e}")

def main():
    """Main function"""
    print("🕷️  Simple Sokogate Product Scraper")
    print("=" * 50)
    
    scraper = SimpleSokogateScraper()
    products = scraper.scrape_products(max_categories=2)
    
    if products:
        scraper.save_to_json("sokogate_products_simple.json")
        scraper.save_to_csv("sokogate_products_simple.csv")
        
        print(f"\n📊 Results:")
        print(f"✅ Products scraped: {len(products)}")
        
        # Show sample products
        print(f"\n📦 Sample Products:")
        for i, product in enumerate(products[:5], 1):
            print(f"{i}. {product['title']}")
            print(f"   Category: {product['category']}")
            print(f"   Price: {product['price']} KES" if product['price'] else "   Price: N/A")
            print(f"   In Stock: {product['stock_status']}")
            print()
        
        print(f"💾 Files saved:")
        print(f"   - sokogate_products_simple.json")
        print(f"   - sokogate_products_simple.csv")
        print(f"   - simple_scraper.log")
    else:
        print("❌ No products were scraped")
    
    print("\n🎉 Scraping completed!")

if __name__ == "__main__":
    main()
