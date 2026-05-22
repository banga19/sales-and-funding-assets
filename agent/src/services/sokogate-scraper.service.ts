import axios from 'axios';
import * as cheerio from 'cheerio';
import { logger } from '../utils/logger';
import { agentConfig } from '../config/agent.config';

interface Product {
  id: string;
  name: string;
  description: string;
  priceCurrent: number | null;
  moq: number | null;
  weightGrams: number | null;
  airDeliveryDays: number | null;
  seaDeliveryDays: number | null;
  supplierName: string | null;
  category: string;
  images: string[];
  specifications: Record<string, string>;
  inStock: boolean;
  sourceUrl: string;
  scrapedAt: string;
  trendingScore: number | null;
  b2bSuitable: boolean | null;
  originCountry: string | null;
  shippingEst: string | null;
  subcategory: string | null;
  sourceId: string | null;
}

// ─── cheerio shim (no deps required — re-used shareable type) ──────────────────
const load = cheerio.load as any; // cheerio "slim" full API cast
const $$ = (html: string) => load(html) as any;
type $ = ReturnType<typeof $$>;

export class SokogateScraperService {
  private static instance: SokogateScraperService;

  private constructor() {}

  public static getInstance(): SokogateScraperService {
    if (!SokogateScraperService.instance) {
      SokogateScraperService.instance = new SokogateScraperService();
    }
    return SokogateScraperService.instance;
  }

  /**
   * Scrape products from sokogate.com
   */
  public async scrapeProducts(maxPages: number = 10, maxProducts: number = 50): Promise<Product[]> {
    try {
      logger.info('[SOKOGATE-SCRAPER] Starting scrape', { maxPages, maxProducts });

      const baseUrl = agentConfig.sokogate.baseUrl || 'https://sokogate.com';
      const products: Product[] = [];

      for (let page = 1; page <= maxPages && products.length < maxProducts; page++) {
        logger.info('[SOKOGATE-SCRAPER] Scraping page', { page });

        const url = `${baseUrl}/collections/all?page=${page}`;
        const response = await axios.get(url, {
          timeout: 15000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        });

        const $$ = cheerio.load(response.data);
        const productCards = $$('.product-item, .product-card, .grid-product');

        for (let i = 0; i < productCards.length && products.length < maxProducts; i++) {
          const cardElement = $$(productCards[i]);

          try {
            const product = this.parseCardElement(cardElement, baseUrl);
            if (product) {
              products.push(product);
            }
          } catch (error) {
            logger.warn('[SOKOGATE-SCRAPER] Failed to parse product card', { error: error.message });
            continue;
          }
        }

        // Be respectful to the server
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      logger.info('[SOKOGATE-SCRAPER] Scrape completed', { productsFound: products.length });
      return products;
    } catch (error) {
      logger.error('[SOKOGATE-SCRAPER] Scrape failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Parse a product card element
   */
  private parseCardElement($: $, baseUrl: string): Product | null {
    try {
      // Extract product information - adjust selectors based on actual sokogate.com structure
      const name = $$('.product-title, .product-name, h3').first().text().trim() || 'Unknown Product';
      const description = $$('.product-description, .product-summary').first().text().trim() || '';

      // Price extraction
      let priceCurrent: number | null = null;
      const priceText = $$('.price, .product-price').first().text().trim();
      const priceMatch = priceText.match(/[\d,]+\.?\d*/);
      if (priceMatch) {
        priceCurrent = parseFloat(priceMatch[0].replace(/,/g, ''));
      }

      // Image extraction
      const images: string[] = [];
      $$('.product-image img, img[src*="product"]').each((_, img) => {
        const src = $$(img).attr('src') || $$(img).attr('data-src');
        if (src) {
          const fullUrl = src.startsWith('http') ? src : `${baseUrl}${src}`;
          images.push(fullUrl);
        }
      });

      // Generate a simple ID based on name and timestamp
      const id = `${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}`;

      return {
        id,
        name,
        description,
        priceCurrent,
        moq: null, // Would need to parse from product details
        weightGrams: null,
        airDeliveryDays: null,
        seaDeliveryDays: null,
        supplierName: null,
        category: 'General',
        images,
        specifications: {},
        inStock: true, // Assume in stock if listed
        sourceUrl: baseUrl,
        scrapedAt: new Date().toISOString(),
        trendingScore: null,
        b2bSuitable: null,
        originCountry: null,
        shippingEst: null,
        subcategory: null,
        sourceId: null
      };
    } catch (error) {
      logger.warn('[SOKOGATE-SCRAPER] Error parsing product card', { error: error.message });
      return null;
    }
  }

  /**
   * Scrape detailed product information
   */
  public async scrapeProductDetails(productUrl: string): Promise<Product | null> {
    try {
      const response = await axios.get(productUrl, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      const $$ = cheerio.load(response.data);
      return this.parseCardElement($$, productUrl);
    } catch (error) {
      logger.warn('[SOKOGATE-SCRAPER] Failed to scrape product details', { url: productUrl, error: error.message });
      return null;
    }
  }
}

export const sokogateScraper = SokogateScraperService.getInstance();
export default sokogateScraper;