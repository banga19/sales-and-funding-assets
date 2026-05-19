/**
 * ProductSourcingCard
 *
 * Replaces the old ProductSourcing section with a statistics bar, sort controls,
 * and a rich 4-column product grid that shows weight, trending badge, origin,
 * shipping estimate, and B2B suitability for each item.
 *
 * Backend shape expected:
 *   GET  /api/products    → { products: Product[]; total: number; ... }
 *   GET  /api/products/stats → { stats: ProductStats }
 *   POST /api/products/scrape → { success; productsStored; ... }
 *
 * where Product extends the shared `frontend/src/types/index.ts` Product
 * with optional: weightGrams, trendingScore, b2bSuitable, originCountry,
 * shippingEst, subcategory, sourceId.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, TrendingUp, Package, DollarSign, Scale } from 'lucide-react';
import axios from 'axios';
import type { Product, ProductStats } from '@/types';

export type SortKey = 'trending' | 'price_asc' | 'price_desc' | 'weight_asc';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'trending',    label: 'Trending' },
  { key: 'weight_asc',  label: 'Lightest' },
  { key: 'price_desc',  label: 'Price ↓' },
  { key: 'price_asc',   label: 'Price ↑' },
];

function fmt(n: number | null | undefined, decimals = 0): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPrice(p: string): string {
  const n = parseFloat(p);
  return isNaN(n) ? p : `$${n.toFixed(2)}`;
}

/* ── helpers ────────────────────────────────────────────────────────────────── */

export default function ProductSourcingCard() {
  const [products, setProducts]   = useState<Product[]>([]);
  const [stats, setStats]         = useState<ProductStats | null>(null);
  const [isScraping, setIsScraping] = useState(false);
  const [loading, setLoading]     = useState(true);
  const [sortBy, setSortBy]       = useState<SortKey>('trending');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: prodData }, { data: statsData }] = await Promise.all([
        axios.get(`/api/products?sort=${sortBy}&limit=24`),
        axios.get('/api/products/stats'),
      ]);
      setProducts(Array.isArray(prodData?.data) ? prodData.data : []);
      setStats(statsData?.stats ?? null);
    } catch {
      /* keep existing state on network error */
    } finally {
      setLoading(false);
    }
  }, [sortBy]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const handleScrape = useCallback(async () => {
    setIsScraping(true);
    try {
      const { data } = await axios.post('/api/products/scrape', {
        baseUrl: 'https://sokogate.com',
        maxPages: 10,
        maxProducts: 50,
        mode: 'foreground',
      });
      if (data?.success) {
        await fetchData();
      }
    } finally {
      setIsScraping(false);
    }
  }, [fetchData]);

  /* ── Render helpers ────────────────────────────────────────────────────────── */

  const statDefs = stats
    ? [
        { icon: TrendingUp, color: 'text-amber-500', label: 'Trending', value: fmt(stats.trending) },
        { icon: Scale,      color: 'text-green-600',  label: 'Lightweight', value: fmt(stats.lightweight) },
        { icon: Package,    color: 'text-blue-500',   label: 'Total', value: fmt(stats.total) },
        { icon: DollarSign, color: 'text-purple-500', label: 'Avg Price',
          value: stats.avgPrice != null ? fmtPrice(String(stats.avgPrice)) : '—' },
      ]
    : [];

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <Package className="w-5 h-5 text-blue-600 flex-shrink-0" />
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">Real-Time Product Sourcing</h3>
            <span className="text-xs text-gray-400">— Sokogate Marketplace</span>
          </div>
        </div>
        <button
          onClick={handleScrape}
          disabled={isScraping}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${isScraping ? 'animate-spin' : ''}`} />
          {isScraping ? 'Scraping…' : 'Scrape Products'}
        </button>
      </div>

      {/* ── Stats bar ───────────────────────────────────────────────────────── */}
      {stats && (
        <div className="px-6 py-3 bg-gray-50 border-b border-gray-100 grid grid-cols-4 gap-4">
          {statDefs.map(({ icon: Icon, color, label, value }) => (
            <div key={label} className="flex items-center gap-2 text-sm">
              <Icon className={`w-4 h-4 ${color} flex-shrink-0`} />
              <span className="text-gray-500 truncate">{label}</span>
              <span className="font-semibold text-gray-900 ml-1">{value}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="p-6">
        {/* Sort controls */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-sm text-gray-500">Sort by</span>
          {SORT_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                sortBy === key
                  ? 'bg-blue-100 text-blue-700 font-medium'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Product grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="animate-pulse bg-gray-100 rounded-lg h-64" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <Package className="w-16 h-16 mb-4 opacity-50" />
            <p className="text-lg font-medium mb-1">No products scraped yet</p>
            <p className="text-sm mb-4">Click &quot;Scrape Products&quot; to begin fetching trending items from Sokogate</p>
            <button
              onClick={handleScrape}
              disabled={isScraping}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              Start Scraping
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {products.map((product) => (
              <ProductSourcingItem key={product.id} product={product} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── ProductSourcingItem ──────────────────────────────────────────────────────── */

function ProductSourcingItem({ product }: { product: Product }) {
  const imgSrc = product.images?.[0] ?? '';

  return (
    <div className="group bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-all duration-200 hover:border-blue-200">
      {/* Image */}
      <div className="aspect-square bg-gray-50 flex items-center justify-center overflow-hidden">
        {imgSrc ? (
          <img
            src={imgSrc}
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <Package className="w-12 h-12 text-gray-300" />
        )}
      </div>

      <div className="p-3">
        {/* B2B badge */}
        {product.b2bSuitable && (
          <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-green-50 text-green-700 rounded-full mb-1.5">
            B2B
          </span>
        )}

        {/* Trending badge */}
        {(product.trendingScore ?? 0) >= 80 && (
          <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-700 rounded-full mb-1.5 ml-1">
            <TrendingUp className="w-3 h-3 mr-1" />
            Trending
          </span>
        )}

        {/* Title */}
        <h4 className="text-sm font-medium text-gray-900 line-clamp-2 mb-2 group-hover:text-blue-600 transition-colors leading-snug">
          {product.name}
        </h4>

        {/* Price + origin */}
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-lg font-bold text-gray-900">{fmtPrice(product.price)}</span>
          {product.originCountry && (
            <span className="text-xs text-gray-400">{product.originCountry}</span>
          )}
        </div>

        {/* Weight / shipping */}
        <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
          {product.weightGrams != null && (
            <>
              <Scale className="w-3 h-3" />
              <span>{fmt(product.weightGrams, 1)}g</span>
            </>
          )}
          {product.shippingEst && <span>· {product.shippingEst}</span>}
        </div>

        {/* Category tag */}
        {product.category && (
          <div>
            <span className="inline-block px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
              {product.category}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
