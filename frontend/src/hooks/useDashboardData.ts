/**
 * useDashboardData
 *
 * Health / status / products — 30 s polling.
 * Each call is independent — a failure in one does NOT invalidate the others.
 * The AbortController singleton (cancelableFetch.ts) is used only for
 * health and status (short, fast 200 ms-ish GETs). Product list Requests are
 * larger (retail catalogue) so we skip the abort middleware for them and
 * rely on the interval tick setting loading=true to prevent flash-of-stale-data.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { api } from '../api/cancelableFetch';
import { apiClient } from '../api/client';
import type { HealthCheck, AgentStatus, Product } from '../types';

const DEMO_MODE = String((import.meta.env as any).VITE_DEMO_MODE ?? '0') === '1';

/* Demo fall — created once at module scope and shared by all */
const MOCK_HEALTH: HealthCheck = {
  status:    'healthy',
  timestamp: new Date().toISOString(),
  checks:    { database: { healthy: true }, email: true, nvidia: true },
};
const MOCK_STATUS: AgentStatus = {
  enabled:  true, dryRun: false,
  features: {
    email: true, autoFollowup: true, autoScheduling: true,
    sentimentAnalysis: false, objectionHandling: false,
    productScraping: true, playwrightScraper: false,
  },
  rateLimits: { email: { remaining: 78, limit: 100 } },
};
const MOCK_PRODUCTS: Product[] = [];

const POLL_INTERVAL = 30_000;

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

  /* ── Status ── */
  const fetchStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      const raw: any = await api.getStatus(signal);
      if (raw != null && typeof raw === 'object' && 'features' in raw) {
        setStatus(raw as AgentStatus);
        setIsDemo(false);
      }
    } catch (err: any) {
      console.warn('[useDashboardData] /api/status error:', err?.message);
      if (DEMO_MODE) setIsDemo(true);
    }
  }, []);

  /* ── Health ── */
  const fetchHealth = useCallback(async (signal?: AbortSignal) => {
    try {
      const raw: any = await api.getHealth(signal);
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

  /* ── Products (direct call — no signal wrapper; large payload) ── */
  const fetchProducts = useCallback(async () => {
    try {
      const raw: any = await apiClient.get('/api/products');
      setProducts(Array.isArray(raw?.data) ? raw.data : []);
    } catch (err: any) {
      console.warn('[useDashboardData] /api/products error:', err?.message);
      if (DEMO_MODE) setProducts(MOCK_PRODUCTS);
    }
  }, []);

  /* ── Combined fetch ── */
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    setIsDemo(false);

    const statusP  = fetchStatus();
    const healthP  = fetchHealth();
    const prodP    = fetchProducts();

    await statusP; await healthP; await prodP;

    // Demo fallback — use mock data when ALL three failed
    if (DEMO_MODE && !status && !health) {
      setHealth(MOCK_HEALTH); setStatus(MOCK_STATUS); setProducts(MOCK_PRODUCTS); setIsDemo(true);
    }

    setLastUpd(new Date());
    setLoading(false);
  }, [fetchStatus, fetchHealth, fetchProducts]);

  const refresh = useCallback(() => fetchAll(), [fetchAll]);

  /* ── Mount: 30 s interval — abort the prior tick before firing next ── */
  useEffect(() => {
    let ctrl = new AbortController();
    const tick = () => {
      ctrl.abort();            // cancel any in-flight calls from previous tick
      ctrl = new AbortController();
      fetchAll();
    };

    fetchAll();               // initial fetch
    const timer = setInterval(tick, POLL_INTERVAL);

    return () => { ctrl.abort(); clearInterval(timer); };
  }, [fetchAll]);

  return { health, status, products, isDemo, loading, error: errorState, lastUpdate, refresh };
}

// Made with Bob
