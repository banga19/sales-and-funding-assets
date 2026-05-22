import { useState, useEffect, useCallback, useRef } from 'react';
import {
  RefreshCw, TrendingUp, Package, DollarSign, Scale, Truck,
  Factory, ShoppingCart, ChevronDown,
  MapPin, Clock, BadgeCheck, Send,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useEmailPanel, type EmailPanelProduct } from '@/context/EmailPanelContext';
import { apiClient } from '@/api/client';
import ContentGeneratorPanel from './ContentGeneratorPanel';
import type { Product, ProductStats, ProductPriceTier } from '@/types';

// ─── Types ─────────────────────────────────────────────────────────────────────

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'trending',    label: '🔥 Trending' },
  { key: 'weight_asc',  label: 'Lightest' },
  { key: 'price_desc',  label: 'Price ↓' },
  { key: 'price_asc',   label: 'Price ↑' },
];
export type SortKey = 'trending' | 'price_asc' | 'price_desc' | 'weight_asc';

const CATEGORIES = [
  'All', 'Electronics', 'Fashion', 'Home & Garden', 'Home & Kitchen',
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, decimals = 0): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPrice(p: string): string {
  const n = parseFloat(p);
  return isNaN(n) ? p : `$${n.toFixed(2)}`;
}

/** Resolve OSS image URL – append x-oss-process if missing. */
function getImageUrl(url: string, size = 'w400'): string {
  if (!url) return '';
  if (url.includes('oss.sokogate.com') && !url.includes('x-oss-process')) {
    return `${url}?x-oss-process=style/${size}`;
  }
  return url;
}

// ─── Stat Badge ────────────────────────────────────────────────────────────────

function StatBadge({
  icon: Icon, label, value, color,
}: { icon: any; label: string; value: React.ReactNode; color: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs" aria-label={`${label}: ${value}`}>
      <Icon className={`w-3.5 h-3.5 ${color}`} />
      <span className="text-gray-400 whitespace-nowrap">{label}</span>
      <span className="font-semibold text-gray-700">{value}</span>
    </div>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────────

interface ProductDetailProps {
  product: Product;
}

function ProductDetail({ product }: ProductDetailProps) {
  const { openEmailPanel } = useEmailPanel();
  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-3 animate-fadeIn">
      {/* Supplier */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-1">Supplier</p>
        <p className="text-sm text-gray-900 flex items-center gap-1 break-all">
          {product.supplierName || 'Sokogate Official'}
          {product.supplierVerified && <BadgeCheck className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />}
        </p>
      </div>

      {/* Specs */}
      {product.specs && Object.keys(product.specs).length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">Specifications</p>
          <div className="flex flex-wrap gap-1">
            {Object.entries(product.specs).map(([k, v]) => (
              <span key={k} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">
                {k}: {v}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Legacy specifications (from DB) */}
      {product.specifications?.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">DB Specs</p>
          <div className="flex flex-wrap gap-1">
            {product.specifications.slice(0, 6).map(({ key, value }) => (
              <span key={key} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded">
                {key}: {value}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* B2B Price Tiers */}
      {product.b2bPriceTier && product.b2bPriceTier.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">B2B Volume Pricing</p>
          <div className="space-y-1">
            {product.b2bPriceTier.map((tier: ProductPriceTier) => (
              <div
                key={tier.id}
                className="flex items-center justify-between text-xs bg-green-50 px-2.5 py-1.5 rounded-lg"
              >
                <span className="text-gray-600">
                  {tier.min_qty}
                  {tier.max_qty ? ` – ${tier.max_qty}` : '+'} units
                </span>
                <span className="font-semibold text-green-700">
                  ${tier.unit_price.toFixed(2)} / unit
                  {tier.discount_percent > 0 && (
                    <span className="ml-1 text-green-500">(−{tier.discount_percent}%)</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        product.moq != null && (
          <div className="text-xs text-gray-500">
            MOQ: <span className="font-semibold text-gray-700">{product.moq} units</span>
          </div>
        )
      )}

      {/* Shipping Info */}
      <div className="bg-blue-50 p-3 rounded-lg space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-blue-700">
          <Truck className="w-3.5 h-3.5" />
          Sokogate Logistics
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            <MapPin className="w-3 h-3 text-cyan-500" />
            <div>
              <span className="text-blue-600 font-medium">Air Freight</span>
              <p className="text-gray-600">{product.airDeliveryDays || '7-15'} days</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-cyan-500" />
            <div>
              <span className="text-blue-600 font-medium">Sea Freight</span>
              <p className="text-gray-600">{product.seaDeliveryDays || '45-75'} days</p>
            </div>
          </div>
        </div>
        <p className="text-xs text-gray-500">
          Payments: M-Pesa · Wave · Orange Money · Airtel
        </p>
      </div>

      {/* View on Sokogate */}
      <a
        href={product.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block text-center py-2 text-xs font-medium text-blue-600 border
                   border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
      >
        View on Sokogate.com →
      </a>

      {/* ── Send Inquiry button ────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => {
          openEmailPanel({
                product: {
                  title: product.name,
                  price: typeof product.price === 'string' ? parseFloat(product.price) || 0 : product.price,
                  weight: product.weightGrams || 250,
                  moq: product.moq ?? 10,
                  airDelivery: product.airDeliveryDays ?? '7-15',
                  seaDelivery: product.seaDeliveryDays ?? '45-75',
                  supplier: product.supplierName ?? 'Sokogate Verified Supplier',
                  category: product.category,
                  imageUrl: product.images?.[0],
                  trendingScore: product.trendingScore ?? 90,
                },
              });
            }}
            className="w-full mt-3 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
          >
            <Send className="w-4 h-4" />
            Send Inquiry to Contacts
          </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════

export default function ProductSourcingCard() {
  const [products, setProducts]       = useState<Product[]>([]);
  const [stats, setStats]             = useState<ProductStats | null>(null);
  const [isScraping, setIsScraping]   = useState(false);
  const [scrapeProgress, setScrapeProgress] = useState(0);
  const [loading, setLoading]         = useState(true);
  const [sortBy, setSortBy]           = useState<SortKey>('trending');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [generatingFor, setGeneratingFor]     = useState<string | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Data fetch ─────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ sort: sortBy, pageSize: '24' });
      if (selectedCategory) params.append('category', selectedCategory);
      const [prodRes, statsRes]: any[] = await Promise.all([
        apiClient.get(`/products?${params}`),
        apiClient.get('/products/stats'),
      ]);
      // Deduplicate by product id to avoid React "duplicate key" warnings
      const rawProducts = Array.isArray(prodRes?.data) ? prodRes.data : [];
      const seen = new Map<string, any>();
      for (const p of rawProducts) {
        if (p?.id && !seen.has(p.id)) seen.set(p.id, p);
      }
      setProducts([...seen.values()]);
      setStats({
        total:           statsRes?.stats?.total          ?? 0,
        trending:        statsRes?.stats?.trending       ?? 0,
        lightweight:     statsRes?.stats?.lightweight    ?? 0,
        avgPrice:        statsRes?.stats?.avgPrice       ?? null,
        minPrice:        statsRes?.stats?.minPrice       ?? null,
        maxPrice:        statsRes?.stats?.maxPrice       ?? null,
        lowMoqCount:     statsRes?.stats?.lowMoqCount    ?? 0,
        b2bSuitableCount: statsRes?.stats?.b2bSuitableCount ?? 0,
      });
    } catch {
      setProducts([]);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [sortBy, selectedCategory]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  // ── Scrape trigger ──────────────────────────────────────────────────────────

  const handleScrape = useCallback(async () => {
    if (isScraping) return;

    setIsScraping(true);
    setScrapeProgress(0);

    progressIntervalRef.current = setInterval(() => {
      setScrapeProgress((prev) => {
        if (prev >= 90) {
          clearInterval(progressIntervalRef.current!);
          return 90;
        }
        return Math.min(prev + Math.floor(Math.random() * 8) + 4, 90);
      });
    }, 350);

    try {
      const data: any = await apiClient.post('/products/scrape', {
        baseUrl: 'https://www.sokogate.com',
        maxPages: 3,
        maxProducts: 60,
        mode: 'foreground',
      });

      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      setScrapeProgress(100);

      if (data.success) {
        toast.success(`Scraped ${data.productsUpserted ?? products.length} products from sokogate.com!`);
        await fetchData();
      } else if (data.errors?.length) {
        toast.error(`Scraping completed with errors: ${(data.errors as string[]).join(', ')}`);
      } else {
        toast.error(data.message || 'Scraping failed. Please try again.');
      }
    } catch (error: unknown) {
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      setScrapeProgress(0);
      const msg = (error as any)?.response?.data?.message ?? (error as Error)?.message ?? 'Scraping failed.';
      toast.error(msg);
    } finally {
      setIsScraping(false);
      setTimeout(() => setScrapeProgress(0), 1500);
    }
  }, [isScraping, fetchData, products.length]);

  const toggleExpand = (id: string) => {
    setExpandedProduct(expandedProduct === id ? null : id);
  };

  const handleGenerateContent = (productId: string) => {
    setGeneratingFor(productId);
  };

  // ── Stat bar ────────────────────────────────────────────────────────────────

  const statDefs = (stats && stats.total != null)
    ? [
        { icon: TrendingUp, color: 'text-orange-500',  label: 'Trending',      value: fmt(stats.trending) },
        { icon: Scale,      color: 'text-green-500',   label: 'Lightweight',   value: fmt(stats.lightweight) },
        { icon: Package,    color: 'text-blue-500',    label: 'Total',         value: fmt(stats.total) },
        { icon: DollarSign, color: 'text-purple-500',  label: 'Avg Price',     value: fmt(stats.avgPrice, 2) },
        { icon: ShoppingCart, color: 'text-emerald-500', label: 'Low MOQ',    value: fmt(stats.lowMoqCount) },
        { icon: Truck,      color: 'text-cyan-500',     label: 'Air 7-15d',   value: '✓' },
        { icon: Factory,    color: 'text-indigo-500',   label: 'Categories',   value: stats.b2bSuitableCount },
      ]
    : [];

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Package className="w-5 h-5 text-blue-600" />
          <h3 className="font-semibold text-gray-900">Real-Time Product Sourcing</h3>
          <span className="text-xs text-gray-400 hidden sm:inline">— Sokogate B2B Marketplace</span>
        </div>
        <button
          type="button"
          onClick={handleScrape}
          disabled={isScraping}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm
                     font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${isScraping ? 'animate-spin' : ''}`} />
          {isScraping ? `Scraping ${Math.round(scrapeProgress)}%` : 'Scrape Products'}
        </button>
      </div>

      {/* ── Progress bar ──────────────────────────────────────────────────── */}
      {isScraping && (
        <div className="px-6 py-2 bg-blue-50">
          <div className="flex items-center justify-between text-xs text-blue-700 mb-1">
            <span>Scraping live products from sokogate.com…</span>
            <span className="font-medium tabular-nums">{Math.round(scrapeProgress)}%</span>
          </div>
          <div className="w-full bg-blue-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${scrapeProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Stats bar ─────────────────────────────────────────────────────── */}
      {stats && (
        <div className="px-6 py-3 bg-gradient-to-r from-gray-50 to-blue-50
                        grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {statDefs.map(({ icon: Icon, color, label, value }) => (
            <StatBadge key={label} icon={Icon} label={label} value={value} color={color} />
          ))}
        </div>
      )}

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="px-6 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-500">Sort by:</span>
        {SORT_OPTIONS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setSortBy(key)}
            className={`px-3 py-1 text-xs rounded-full transition-colors
              ${sortBy === key
                ? 'bg-blue-100 text-blue-700 font-medium'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
          >
            {label}
          </button>
        ))}
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="ml-auto px-3 py-1 text-xs border border-gray-300 rounded-lg"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c === 'All' ? '' : c}>{c}</option>
          ))}
        </select>
      </div>

      {/* ── Product grid ──────────────────────────────────────────────────── */}
      <div className="p-6">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="animate-pulse bg-gray-100 rounded-xl h-80" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Package className="w-20 h-20 mb-4 opacity-30" />
            <p className="text-xl font-semibold mb-2">No products scraped yet</p>
            <p className="text-sm mb-6 max-w-md text-center">
              Click "Scrape Products" to pull live trending items from sokogate.com.
              Products will include full B2B details: images, MOQ, delivery times, and price tiers.
            </p>
            <button
              type="button"
              onClick={handleScrape}
              disabled={isScraping}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white
                         rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isScraping ? 'animate-spin' : ''}`} />
              Start Scraping
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {products.map((product) => (
              <div
                key={product.id}
                className="group bg-white border border-gray-200 rounded-xl
                           overflow-hidden hover:shadow-lg hover:border-blue-300
                           transition-all duration-200"
              >
                {/* ── Image + badges ───────────────────────────────────────────── */}
                <div className="aspect-square bg-gray-100 flex items-center justify-center
                                overflow-hidden relative">
                  {product.images?.[0] ? (
                    <img
                      src={getImageUrl(product.images[0])}
                      alt={product.name}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105
                                 transition-transform duration-300"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = '/placeholder-product.svg';
                      }}
                    />
                  ) : (
                    <Package className="w-12 h-12 text-gray-300" />
                  )}
                  {product.trendingScore != null && product.trendingScore >= 85 && (
                    <span className="absolute top-2 left-2 px-2 py-0.5 bg-orange-500 text-white
                                     text-xs font-bold rounded-full flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" /> HOT
                    </span>
                  )}
                  {product.moq != null && product.moq <= 20 && (
                    <span className="absolute top-2 right-2 px-2 py-0.5 bg-green-500 text-white
                                     text-xs font-bold rounded-full">
                      Low MOQ
                    </span>
                  )}
                </div>

                {/* ── Content ─────────────────────────────────────────────────── */}
                <div className="p-4">
                  <h4 className="text-sm font-semibold text-gray-900 line-clamp-2 mb-2
                                 group-hover:text-blue-600 transition-colors leading-snug">
                    {product.name}
                  </h4>

                  {/* Price + origin */}
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xl font-bold text-gray-900">
                      {fmtPrice(product.price)}
                    </span>
                    {product.originCountry && (
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <Factory className="w-3 h-3" /> {product.originCountry}
                      </span>
                    )}
                  </div>

                  {/* Key specs */}
                  <div className="grid grid-cols-2 gap-2 mb-3 text-xs text-gray-500">
                    <div className="flex items-center gap-1">
                      <Scale className="w-3 h-3" />
                      <span>{fmt(product.weightGrams, 1)}g</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <ShoppingCart className="w-3 h-3" />
                      <span>MOQ: {product.moq ?? '—'}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Truck className="w-3 h-3" />
                      <span>Air: {product.airDeliveryDays || '7-15'}d</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <DollarSign className="w-3 h-3" />
                      <span>{product.category}</span>
                    </div>
                  </div>

                  {/* Expand toggle */}
                  <button
                    type="button"
                    onClick={() => setExpandedProduct(
                      expandedProduct === product.id ? null : product.id
                    )}
                    className="w-full flex items-center justify-center gap-1 py-1.5 text-xs
                               text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100
                               transition-colors"
                  >
                    <ChevronDown
                      className={`w-3 h-3 transition-transform
                        ${expandedProduct === product.id ? 'rotate-180' : ''}`}
                    />
                    {expandedProduct === product.id ? 'Less Details' : 'B2B Details'}
                  </button>

                  {/* ── Expanded B2B details ─────────────────────────────────────── */}
                  {expandedProduct === product.id && product && (
                    <ProductDetail product={product} />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {generatingFor && (
        <ContentGeneratorPanel productId={generatingFor} onClose={() => setGeneratingFor(null)} />
      )}
    </div>
  );
}
