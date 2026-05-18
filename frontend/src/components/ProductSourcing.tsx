/**
 * ProductSourcing
 *
 * Combines the scrape trigger + ProductCard grid inside a single card
 * section. Pulls products via the `useProductList` hook.
 */

'use client';
import { useState, useCallback } from 'react';
import { Search, Loader2 } from 'lucide-react';
import ProductCard from './ProductCard';
import EmptyState from './EmptyState';
import { useProductList } from '@/hooks/useProductList';

export default function ProductSourcing() {
  const { products, loading, error, refresh } = useProductList();
  const [scraping, setScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState<string | null>(null);

  const handleScrape = useCallback(async () => {
    setScraping(true);
    setScrapeError(null);
    try {
      const resp = await fetch('/api/products/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'foreground' })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setScrapeError(data.error || 'Scrape failed');
      } else {
        refresh();
      }
    } catch (e: any) {
      setScrapeError(e.message || 'Network error');
    } finally {
      setScraping(false);
    }
  }, [refresh]);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-gray-800">Real-Time Product Sourcing</h2>
        <button
          onClick={handleScrape}
          disabled={scraping}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-500 text-white rounded-lg text-sm font-medium hover:bg-indigo-600 disabled:opacity-50 transition"
        >
          {scraping ? <><Loader2 className="w-4 h-4 animate-spin" /> Scraping...</> : <><Search className="w-4 h-4" /> Scrape Products</>}
        </button>
      </div>

      {scrapeError && (
        <div className="mb-4 bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm">
          {scrapeError}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="animate-pulse bg-gray-100 rounded-xl h-48" />
          ))}
        </div>
      ) : error ? (
        <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={refresh}
            className="ml-2 text-indigo-600 hover:text-indigo-800 underline text-xs"
          >
            Retry
          </button>
        </div>
      ) : products.length === 0 ? (
        <EmptyState message="No products scraped yet. Click 'Scrape Products' to begin." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}