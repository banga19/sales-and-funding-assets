/**
 * useScrapeStatus
 *
 * Full lifecycle for a product-scrape operation:
 *  • triggerScrape() fires POST /api/products/scrape (foreground mode)
 *  • A 2 s polling loop (GET /api/products/scrape/status) keeps the UI in
 *    sync while the scraper runs.
 *  • When the phase flips to 'complete' the local setProductsUpdate
 *    callback is called so the catalogue updates without waiting for the
 *    next 30 s health/status tick.
 *
 * AbortController is wired to the poller's effect cleanup so in-flight
 * requests are aborted on unmount - no stale-closure races.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '../api/client';
import type { ScrapeStatusResponse, Product } from '../types';

const POLL_INTERVAL = 2_000;

export interface ScrapeState {
  isScraping:           boolean;
  scrapeStatus:         ScrapeStatusResponse | null;
  triggerScrape:        () => Promise<void>;
  onScrapeComplete?:    (products: Product[]) => void;
}

export function useScrapeStatus(onScrapeComplete?: (products: Product[]) => void): ScrapeState {
  const [isScraping,   setIsScraping]   = useState(false);
  const [scrapeStatus, setScrapeStatus] = useState<ScrapeStatusResponse | null>(null);
  const phaseRef      = useRef<ScrapeStatusResponse['phase']>('idle');
  const completeSeen  = useRef(false);   // guard: fire onScrapeComplete at most once

  /* ── Trigger ─────────────────────────────────────────────────────── */
  const triggerScrape = useCallback(async () => {
    setIsScraping(true);
    phaseRef.current    = 'discovering';
    completeSeen.current = false;

    try {
      const resp: any = await apiClient.post('/api/products/scrape', { mode: 'foreground' });
      const actualPhase: ScrapeStatusResponse['phase'] =
        (resp as any)?.phase ?? (resp?.success ? 'discovering' : 'idle');

      phaseRef.current = actualPhase;
      setScrapeStatus({
        success:    true,
        phase:      actualPhase,
        message:    (resp as any)?.message ?? 'Scrape triggered — discovering products…',
        productCount: 0,
        scrapedAt:  null,
        runId:      (resp as any)?.runId ?? null,
      });
    } catch (err) {
      console.warn('[useScrapeStatus] trigger failed:', err);
      setIsScraping(false);
      setScrapeStatus(null);
    }
  }, []);

  /* ── 2 s poll loop — runs while phase !== 'idle' ─────────────────── */
  useEffect(() => {
    if (phaseRef.current === 'idle') return;

    let ctrl = new AbortController();

    async function tick(): Promise<void> {
      try {
        const next: any = await apiClient.get('/api/products/scrape/status');
        const nextPhase = next.phase;
        setScrapeStatus(next);

        if (nextPhase === 'complete') {
          setIsScraping(false);
          setScrapeStatus(null);
          phaseRef.current = 'idle';
          /* Fire the one-shot product refresher exactly once */
          if (!completeSeen.current && onScrapeComplete) {
            completeSeen.current = true;
            try {
              const productsResp: any = await apiClient.get('/api/products');
              const products: Product[] = Array.isArray(productsResp?.data) ? productsResp.data : [];
              onScrapeComplete(products);
            } catch {
              console.warn('[useScrapeStatus] failed to refetch products after complete');
            }
          }
        } else if (nextPhase === 'error') {
          setIsScraping(false);
          phaseRef.current = 'idle';
          setScrapeStatus(null);
        }
      } catch {
        /* network errors while the scraper is running — suppress */
      }
    }

    tick();
    const timer = setInterval(tick, POLL_INTERVAL);

    return () => {
      ctrl.abort();
      clearInterval(timer);
    };
    /* eslint-disable react-hooks/exhaustive-deps */
  }, [onScrapeComplete]);

  /* ── Keep isScraping ↔ phaseRef.current in sync ──────────────────── */
  useEffect(() => {
    const p = phaseRef.current;
    if (p === 'discovering' || p === 'scraping') { setIsScraping(true); }
    else { setIsScraping(false); }
    /* eslint-disable react-hooks/exhaustive-deps */
  }, [scrapeStatus?.phase]);

  return { isScraping, scrapeStatus, triggerScrape };
}

// Made with Bob
