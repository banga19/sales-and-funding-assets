/**
 * useDashboardData
 *
 * Polls three endpoints independently:
 *   Status  → GET /api/status  every 30 s  (AbortController-cancelled)
 *   Health  → GET /api/health  every 60 s  (AbortController-cancelled)
 *   Products → GET /api/products one-shot + on-demand refresh
 *
 * A stale tick from a previous interval never overwrites the UI because each
 * tick creates a fresh AbortController that cancels any still-in-flight call.
 */

import { useState, useCallback, useEffect } from 'react';
import { apiClient } from '../api/client';
import type { HealthCheck, AgentStatus, Product } from '../types';

const DEMO_MODE = String((import.meta.env as any).VITE_DEMO_MODE ?? '0') === '1';

/* Demo fallbacks — shared by both hooks */
const MOCK_HEALTH: HealthCheck = {
  status:    'healthy',
  timestamp: new Date().toISOString(),
  checks:    { database: { healthy: true }, email: true, nvidia: true },
};
const MOCK_STATUS: AgentStatus = {
  enabled:  true, dryRun: false,
  features: {
    email: true, autoFollowup: true, autoScheduling: true,
    sentimentAnalysis: true, objectionHandling: true,
    productScraping: true, playwrightScraper: true,
    agentsEnabled: false,
    autonomousAgents: false, bulkSourcing: false, marketing: false, content: false, fundingPitch: false,
  },
  rateLimits: { email: { remaining: 922, limit: 1000 } },
};
const MOCK_PRODUCTS: Product[] = [];

export interface DashboardData {
  health:     HealthCheck | null;
  status:     AgentStatus | null;
  products:   Product[];
  isDemo:     boolean;
  loading:    boolean;
  error:      string | null;
  lastUpdate: Date;
  refresh:    () => void;
}

export function useDashboardData(): DashboardData {
  const [health,     setHealth]     = useState<HealthCheck | null>(null);
  const [status,     setStatus]     = useState<AgentStatus | null>(null);
  const [products,   setProducts]   = useState<Product[]>([]);
  const [isDemo,     setIsDemo]     = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [errorState, setError]      = useState<string | null>(null);
  const [lastUpdate, setLastUpd]    = useState(new Date());

  /* ── Status ── 30-second poll ─────────────────────────────── */
  const fetchStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      const raw: any = await (apiClient.get as any)('/status', { signal });
      if (raw != null && typeof raw === 'object' && 'features' in raw) {
        setStatus(raw as AgentStatus);
        setIsDemo(false);
      }
    } catch (err: any) {
      console.warn('[useDashboardData] /api/status error:', err?.message);
      if (DEMO_MODE) setIsDemo(true);
    }
  }, []);

  /* ── Health ── 60-second poll ─────────────────────────────── */
  const fetchHealth = useCallback(async (signal?: AbortSignal) => {
    try {
      const raw: any = await (apiClient.get as any)('/health', { signal });
      if (raw != null && typeof raw === 'object' && 'checks' in raw) {
        setHealth(raw as HealthCheck);
      }
    } catch (err: any) {
      const code = err?.response?.status;
      if (code === 503) {
        setHealth({
          status: 'unhealthy', timestamp: new Date().toISOString(),
          checks: { database: { healthy: false, error: 'Connection not confirmed' }, email: false, nvidia: false },
        });
      } else {
        console.warn('[useDashboardData] /api/health error:', err?.message);
        if (DEMO_MODE) { setError('Backend unreachable — displaying demo data.'); }
      }
    }
  }, []);

  /* ── Products — one-shot ─────────────────────────────────── */
  const fetchProducts = useCallback(async () => {
    try {
      const raw: any = await apiClient.get('/products');
      setProducts(Array.isArray(raw?.data) ? raw.data : []);
    } catch (err: any) {
      console.warn('[useDashboardData] /api/products error:', err?.message);
      if (DEMO_MODE) setProducts(MOCK_PRODUCTS);
    }
  }, []);

  /* ── Combined fetch (called by tick + manual refresh) ────── */
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    setIsDemo(false);

    await fetchStatus();
    await Promise.race([fetchHealth(), new Promise(r => setTimeout(r, 5000))]); // health: don't wait >5 s
    await fetchProducts();

    // Demo fallback when ALL three failed
    if (DEMO_MODE && !status && !health) {
      setHealth(MOCK_HEALTH); setStatus(MOCK_STATUS); setProducts(MOCK_PRODUCTS); setIsDemo(true);
    }

    setLastUpd(new Date());
    setLoading(false);
  }, [fetchStatus, fetchHealth, fetchProducts, DEMO_MODE]);

  const refresh = useCallback(() => { void fetchAll(); }, [fetchAll]);

  /* ── Mount: status every 30 s, health every 60 s ─────────── */
  useEffect(() => {
    let statusCtrl = new AbortController();
    let healthCtrl = new AbortController();

    const statusTick = () => {
      statusCtrl.abort();
      statusCtrl = new AbortController();
      void fetchStatus(statusCtrl.signal);
    };
    const healthTick = () => {
      healthCtrl.abort();
      healthCtrl = new AbortController();
      void fetchHealth(healthCtrl.signal);
    };

    statusTick();                 // immediate status fetch
    healthTick();                 // immediate health fetch
    const statusTimer = setInterval(statusTick, 30_000);
    const healthTimer = setInterval(healthTick, 60_000);

    return () => {
      statusCtrl.abort(); clearInterval(statusTimer);
      healthCtrl.abort(); clearInterval(healthTimer);
    };
  }, [fetchStatus, fetchHealth]);

  /* ── Products refresh button ─────────────────────────────── */
  useEffect(() => {
    void fetchProducts();
  }, [fetchProducts]);

  return { health, status, products, isDemo, loading, error: errorState, lastUpdate, refresh };
}

// Made with Bob
