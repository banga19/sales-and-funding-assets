/**
 * ProductSection
 *
 * All product-sourcing card rendering: scrape trigger button, status bar,
 * empty-state, and the product grid.
 *
 * Receives all data as props — stateless and fully memoised.
 *
 * Polling optimisation:
 *   Current implementation uses 2 s intervals (useScrapeStatus hook).
 *   For production, replace `ScrapeEventSource` with a genuine WebSocket
 *   connection (server-side: emit status changes via ws server on each job
 *   transition) to eliminate waste when not scraping.
 *   ─────────────────────────────────────────────────────────────────
 *   | Phase         | Recommended strategy                            |
 *   |────────────────────────────────────────────────────────────|
 *   | idle, no jobs | no connections at all            (~0 msgs/s)   |
 *   | scraping      | 1 s server-sent interval for client progress bar  |
 *   | complete      | 10 s summary release poll + WS status for final    |
 *   ─────────────────────────────────────────────────────────────────
 *   Token usage saved: ~30 unnecessary requests / scrape when idle.
 */

import React from 'react';
import {
  Search, Package, CheckCircle2, XCircle, Loader2, Activity,
  Image as ImageIcon, ExternalLink,
} from 'lucide-react';
import { SOK } from '../design-tokens';
import type { Product, ScrapeStatusResponse } from '../types';

interface ProductSectionProps {
  products:         Product[];
  isScraping:       boolean;
  scrapeStatus:     ScrapeStatusResponse | null;
  onScrapeTrigger:  () => void;
  isDemo:           boolean;
}

const cardStyle = (color: string): React.CSSProperties => ({
  display:       'flex',
  alignItems:    'center',
  gap:           '0.75rem',
  padding:       '0.625rem 1rem',
  borderRadius:  '0.5rem',
  marginBottom:  '1rem',
  background:    color === 'idle'  ? SOK.surfaceRaised   :
                 color === 'error' ? '#FEE2E2'           : '#D1FAE5',
  border:        `1px solid ${
    color === 'error'   ? SOK.error   :
    color === 'complete' ? SOK.success : SOK.border
  }40`,
});

function ScrapeStatusBar({ status, isScraping }: { status: ScrapeStatusResponse; isScraping: boolean }) {
  const barStyle = cardStyle(status.phase === 'discovering' || status.phase === 'scraping' ? 'active' : status.phase);
  const Icon = status.phase === 'complete'   ? CheckCircle2
             : status.phase === 'error'        ? XCircle
             : isScraping                       ? Loader2
             :                                   Activity;

  return (
    <div style={barStyle}>
      <Icon
        className="w-4 h-4"
        style={{
          flexShrink:   0,
          color:        status.phase === 'error'  ? SOK.error
                      : status.phase === 'complete' ? SOK.success
                      : isScraping                    ? SOK.primary
                      :                                SOK.textMuted,
          ...(isScraping ? { animation: 'sok-spin 1s linear infinite' } : {}),
        }}
      />
      <span style={{ fontSize: '0.8125rem', color: SOK.textSec, flex: 1 }}>
        {status.message}
        {status.productCount > 0 && (
          <strong style={{ color: SOK.neutral, marginLeft: '0.5rem' }}>
            ({status.productCount} product{status.productCount !== 1 ? 's' : ''} in store)
          </strong>
        )}
      </span>
    </div>
  );
}

/* ── Sub-component: single product card ── */

const prodCard: React.CSSProperties = {
  border:       `1px solid ${SOK.borderSoft}`,
  borderRadius: '0.75rem',
  overflow:     'hidden',
  transition:   'border-color 200ms, box-shadow 200ms',
  background:   SOK.surface,
  cursor:       'default',
};

function ProductCard({ product }: { product: Product }) {
  return (
    <div
      style={prodCard}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = `${SOK.primary}70`;
        e.currentTarget.style.boxShadow   = '0 4px 16px rgba(96,91,229,.10)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = SOK.borderSoft;
        e.currentTarget.style.boxShadow   = 'none';
      }}
    >
      {/* Image */}
      <div
        style={{
          height:              '9rem',
          background:          SOK.surfaceRaised,
          borderBottom:        `1px solid ${SOK.borderSoft}`,
          display:             'flex',
          alignItems:          'center',
          justifyContent:      'center',
          overflow:            'hidden',
        }}
      >
        {product.images.length > 0 ? (
          <img
            src={product.images[0]}
            alt={product.name}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder-product.svg'; }}
          />
        ) : (
          <ImageIcon className="w-8 h-8" style={{ color: SOK.borderSoft }} />
        )}
      </div>

      {/* Body */}
      <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {/* Category + in-stock badges */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span
            style={{
              fontFamily: 'monospace',
              fontSize:   '0.6875rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color:      SOK.primary,
              background: SOK.surfaceRaised,
              padding:    '0.125rem 0.5rem',
              borderRadius: '9999px',
              border:     `1px solid ${SOK.border}`,
            }}
          >
            {product.category}
          </span>
          <span
            style={{
              fontSize: '0.6875rem',
              fontWeight: 500,
              color:   product.inStock ? '#065F46'     : '#991B1B',
              background: product.inStock ? '#D1FAE5' : '#FEE2E2',
              padding: '0.125rem 0.5rem',
              borderRadius: '9999px',
              border:  `1px solid ${product.inStock ? '#A7F3D0' : '#FECACA'}`,
            }}
          >
            {product.inStock ? 'In Stock' : 'Out of Stock'}
          </span>
        </div>

        <p style={{ fontSize: '0.875rem', fontWeight: 600, color: SOK.neutral, lineHeight: 1.4 }}>
          {product.name}
        </p>

        {product.price && (
          <p style={{ fontSize: '1.0625rem', fontWeight: 700, color: SOK.primary }}>
            KSh {product.price}
          </p>
        )}

        <p
          style={{
            fontSize: '0.75rem',
            color:    SOK.textMuted,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            lineHeight: 1.5,
          }}
        >
          {product.description}
        </p>

        {/* Specs */}
        {product.specifications.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
            {product.specifications.slice(0, 3).map((spec) => (
              <span key={spec.key} style={{
                fontSize: '0.6875rem', color: SOK.textSec,
                background: SOK.surfaceMuted, border: `1px solid ${SOK.borderSoft}`,
                padding: '0.125rem 0.375rem', borderRadius: '0.25rem',
              }}>
                {spec.value}
              </span>
            ))}
          </div>
        )}

        {/* Source link */}
        {product.sourceUrl && (
          <a
            href={product.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: '0.75rem',
              color:    SOK.primary,
              textDecoration: 'none',
              marginTop: 'auto',
              paddingTop: '0.5rem',
              borderTop: `1px solid ${SOK.borderSoft}`,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
            onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
          >
            View on sokogate.com <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );
}

/* ── Main section ── */

export const ProductSection = React.memo(function ProductSection({
  products, isScraping, scrapeStatus, onScrapeTrigger, isDemo,
}: ProductSectionProps) {
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h2
          className="section-title"
          style={{ fontFamily: "'Poppins', 'Segoe UI', sans-serif", color: SOK.neutral }}
        >
          Real-Time Product Sourcing
        </h2>
        <button
          onClick={onScrapeTrigger}
          disabled={isScraping || isDemo}
          className="btn btn-primary"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
            opacity:  isScraping || isDemo ? 0.6 : 1,
            cursor:   isScraping || isDemo ? 'not-allowed' : 'pointer',
          }}
        >
          {isScraping ? (
            <><Loader2 className="w-4 h-4" style={{ animation: 'sok-spin 1s linear infinite' }} />
              Crawling sokogate.com&hellip;</>
          ) : (
            <><Search className="w-4 h-4" /> Scrape Products</>
          )}
        </button>
      </div>

      <div className="card" style={{ padding: '1.5rem' }}>

        {scrapeStatus && <ScrapeStatusBar status={scrapeStatus} isScraping={isScraping} />}

        {isDemo && !scrapeStatus && (
          <div style={{ marginBottom: '1rem', padding: '0.625rem 1rem', borderRadius: '0.5rem', background: '#FEF3C7', border: '1px solid #FCD34D', fontSize: '0.8125rem', color: '#92400E' }}>
            Demo mode — product scraping is simulated. Connect your backend to scrape live product data from sokogate.com.
          </div>
        )}

        {!isScraping && products.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: SOK.textMuted }}>
            <Package className="w-10 h-10 mx-auto mb-3" style={{ opacity: 0.3 }} />
            <p style={{ fontSize: '0.9375rem', fontWeight: 500, marginBottom: '0.25rem', color: SOK.neutral }}>No products yet</p>
            <p style={{ fontSize: '0.8125rem' }}>
              Click <strong>Scrape Products</strong> to autonomously crawl sokogate.com and populate this catalogue.
            </p>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: '0.75rem', fontSize: '0.8125rem', color: SOK.textMuted }}>
              Showing {products.length} product{products.length !== 1 ? 's' : ''}
              {scrapeStatus?.scrapedAt && (
                <> — last updated {new Date(scrapeStatus.scrapedAt).toLocaleTimeString()}</>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
              {products.map((product) => <ProductCard key={product.id} product={product} />)}
            </div>
          </>
        )}
      </div>
    </section>
  );
});
// Made with Bob
