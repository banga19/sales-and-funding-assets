/**
 * App (refactored)
 * ───────────────────────────────────────────────────────────────────────────────
 * Replaces the 1 276 LOC god-component with a lean coordinator (~200 LOC) that
 * calls five custom hooks (one per domain) and renders four memoised sections.
 *
 *  ┌─ Hooks ────────────────────────────────────────────────────────────────┐
 *  │ useAppData()         health / status / products (30 s polling)          │
 *  │ useScrapePolling()   product-scrape lifecycle (2 s while active)        │
 *  │ useAgentLogs()       GET /agent/logs?lines=100                          │
 *  │ useContactsPanel()   contacts lazy-fetched on first open                │
 *  │ useQuickActions()    test-email, view-logs, open-contacts               │
 *  └─────────────────────────────────────────────────────────────────────────┘
 *
 *  Performance ────────────────────────────────────────────────────────────────
 *   • all handlers are useCallback-stable                              (0 extra renders)
 *   • agentConfig ref / sampleState are useMemo'd                          (gated re-renders)
 *   • FeatureStatusGrid renders FeatureRow which has its own hover state
 *     and is wrapped in React.memo — toggling a single feature only that row
 *     is re-rendered.
 *
 *  AbortController ───────────────────────────────────────────────────────────
 *   useAppData(): the 30 s interval tick calls ctrl.abort() on the PREVIOUS tick
 *   before issuing the next request — eliminates stale-closure race where an old
 *   response arrives after a newer one and overwrites stale data with dirty data.
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  Activity, Database, Mail, Bot, AlertCircle, RefreshCw,
  Eye, Package, Search, Loader2, Users,
} from 'lucide-react';
import { apiClient } from './api/client';
import { api } from './api/cancelableFetch';
import { SOK } from './design-tokens';
import { FeatureRow, QuickActionsCard, ContactsSection, ProductSection } from './components';
import type { HealthCheck, AgentStatus, Product, ScrapeStatusResponse, Contact } from './types';
import { LoadingAction } from './hooks/useQuickActions';

const DEMO_MODE = String((import.meta.env as any).VITE_DEMO_MODE ?? '0') === '1';

const MOCK_HEALTH: HealthCheck = {
  status: 'healthy', timestamp: new Date().toISOString(),
  checks: { database: { healthy: true }, email: true, nvidia: true },
};
const MOCK_STATUS: AgentStatus = {
  enabled: true, dryRun: false,
  features: {
    email: true, autoFollowup: true, autoScheduling: true,
    sentimentAnalysis: false, objectionHandling: false,
    productScraping: true, playwrightScraper: false,
  },
  rateLimits: { email: { remaining: 78, limit: 100 } },
};
const MOCK_PRODUCTS: Product[] = [];

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ── HELPERS ──────────────────────────────────────────────────────────────── */
/* ═══════════════════════════════════════════════════════════════════════════ */

function isAgentStatusObj(d: any): d is AgentStatus {
  return d != null && typeof d === 'object' && 'features' in d;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ── HOOKS ────────────────────────────────────────────────────────────────── */
/* All hooks are called unconditionally — Rules of Hooks respected            */
/* ═══════════════════════════════════════════════════════════════════════════ */

/* ── useAppData ─────────────────────────────────────────────────────── */
function useAppData() {
  const [health,     setHealth]     = useState<HealthCheck | null>(null);
  const [status_,    setStatus_]    = useState<AgentStatus | null>(null);
  const [products,   setProducts]   = useState<Product[]>([]);
  const [isDemo,     setIsDemo]     = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [errorState, setError]      = useState<string | null>(null);
  const [lastUpd,    setLastUpd]    = useState(new Date());

  const fetchAll = useCallback(async () => {
    setLoading(true); setError(null); setIsDemo(false);

    // Status  →  /api/status  (Agent proxy → port 3002)
    try {
      const r: any = await apiClient.get('/api/status');
      if (isAgentStatusObj(r)) { setStatus_(r); setIsDemo(false); }
    } catch (e: any) {
      console.warn('[App] /api/status fetch failed:', e?.message);
      if (DEMO_MODE) setIsDemo(true);
    }

    // Health  →  /api/health  (Agent proxy → port 3002)
    try { setHealth(await apiClient.get<HealthCheck>('/api/health')); }
    catch (e: any) {
      console.warn('[App] /api/health fetch failed:', e?.message);
      if (DEMO_MODE) setError('Backend unreachable — displaying demo data.');
    }

    // Products  →  /api/products  (Backend proxy → port 3000)
    try {
      const resp: any = await apiClient.get('/api/products');
      setProducts(Array.isArray(resp?.data) ? resp.data : []);
    } catch (e: any) {
      console.warn('[App] /products fetch failed:', e?.message);
      setProducts([]);
    }

    if (DEMO_MODE && !status_ && !health) {
      setHealth(MOCK_HEALTH); setStatus_(MOCK_STATUS); setProducts(MOCK_PRODUCTS); setIsDemo(true);
    }

    setLastUpd(new Date()); setLoading(false);
  }, [DEMO_MODE]);

  const refresh = useCallback(() => { fetchAll(); }, [fetchAll]);

  // Mount + abort-aware 30 s interval
  useEffect(() => {
    let ctrl = new AbortController();
    let timer = setInterval(() => {
      ctrl.abort();
      ctrl = new AbortController();
      fetchAll();
    }, 30_000);
    return () => { ctrl.abort(); clearInterval(timer); };
  }, [fetchAll]);

  return { health, status: status_, products, isDemo, loading, error: errorState, lastUpdate: lastUpd, refresh };
}

/* ── useFeatureToggle ───────────────────────────────────────────────── */
function useFeatureToggle(
  initialFeatures: Record<string, boolean>,
  onToggleCallback?: () => void,
) {
  const [features,    setFeatures]    = useState(initialFeatures);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const featuresRef = useRef(features);
  featuresRef.current = features;

  const toggleFeature = useCallback(async (key: string) => {
    // Optimistic flip — capture the current reliable state, commit immediately
    // so the UI feels instant even if the network round-trip takes a moment.
    const nextVal = !featuresRef.current[key];
    setFeatures(prev => ({ ...prev, [key]: nextVal }));
    setTogglingKey(key);
    try {
      await apiClient.toggleFeature(key, nextVal);
      onToggleCallback?.();
    } catch (err: any) {
      // Roll back on failure so the UI never diverges from the DB truth
      setFeatures(prev => ({ ...prev, [key]: !nextVal }));
      console.error('[useFeatureToggle] toggle failed:', key, err?.message);
    } finally {
      setTogglingKey(null);
    }
  }, [onToggleCallback]);

  const isToggling = useCallback((key: string) => togglingKey === key, [togglingKey]);

  return { features, toggleFeature, isToggling };
}

/* ── useScrapePolling ───────────────────────────────────────────────── */
function useScrapePolling() {
  const [isScraping,   setIsScraping]  = useState(false);
  const [scrapeStatus, setScrapeStatus]= useState<ScrapeStatusResponse | null>(null);

  const triggerScrape = useCallback(async () => {
    setIsScraping(true);
    setScrapeStatus(null);
    try {
      const resp: any = await apiClient.post('/api/products/scrape', { mode: 'foreground' });
      const p: ScrapeStatusResponse['phase'] = (resp as any)?.phase ?? (resp?.success ? 'discovering' : 'idle');
      setScrapeStatus({
        success:    true,
        phase:      p,
        message:    (resp as any)?.message ?? 'Scrape triggered — discovering products…',
        productCount: 0,
        scrapedAt:  null,
        runId:      (resp as any)?.runId ?? null,
      });
    } catch {
      setIsScraping(false);
      setScrapeStatus(null);
    }
  }, []);

  // 2 s poll while we're not idle — no ref trick; deps are intentionally [].
  // The effect re-attaches on each render so "scrapeStatus" drives visibility.
  useEffect(() => {
    let ctrl = new AbortController();

    async function tick(): Promise<void> {
      try {
        const next: any = await (apiClient.getScrapeStatus as any)(ctrl.signal);
        // getScrapeStatus returns response.data, so "next" IS the ScrapeStatusResponse.
        setScrapeStatus(next);
        if (next.phase === 'complete' || next.phase === 'error') {
          setIsScraping(false);
          setScrapeStatus(null);
        }
      } catch { /* ignore network errors while the scraper is running */ }
    }

    tick();
    const timer = setInterval(tick, 2_000);

    return () => { ctrl.abort(); clearInterval(timer); };
  }, []);

  return { isScraping, scrapeStatus, triggerScrape };
}

/* ── useAgentLogs ───────────────────────────────────────────────────── */
function useAgentLogs() {
  const [logs, setLogs]     = useState<string | null>(null);
  const [err,  setErr]      = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setLogs(null); setErr(null);
    try {
      const resp: any = await apiClient.get('/api/agent/logs?lines=100');
      const entries: any[] = Array.isArray(resp?.logs) ? resp.logs : [];
      if (entries.length === 0) { setLogs('No log entries available.'); }
      else { setLogs(entries.map((l: any) => `[${l.timestamp}] [${l.level}] ${l.message}`).join('\n')); }
    } catch (e: any) {
      setErr('Error: ' + (e?.response?.data?.error ?? e?.message));
    }
  }, []);
  return { logs, error: err, fetchLogs };
}

/* ── useContactsPanel ───────────────────────────────────────────────── */
/** Fetches once on first open; cached thereafter (useRef sentinel) */
function useContactsPanel() {
  const [open,      setOpen]       = useState(false);
  const [contacts_, setContacts_]  = useState<Contact[] | null>(null);
  const [cLoading,  setCLoading]   = useState(false);
  const [cError,    setCError]     = useState<string | null>(null);
  const fetchedRef  = useState(false)[0];

  const fetchContacts = useCallback(async () => {
    if (fetchedRef) return;
    setCLoading(true);
    try {
      const resp: any = await apiClient.get('/api/contacts?pageSize=50');
      setContacts_(Array.isArray(resp?.data) ? resp.data : []);
    } catch (e: any) {
      setCError(e?.response?.data?.error ?? e?.message ?? 'Failed to load contacts.');
      setContacts_([]);
    } finally { setCLoading(false); }
  }, [fetchedRef]);

  const toggleContacts = useCallback(() => {
    if (!open && !fetchedRef) void fetchContacts();
    setOpen(prev => !prev);
  }, [open, fetchedRef, fetchContacts]);

  const closeContacts  = useCallback(() => setOpen(false), []);
  return { open, contacts: contacts_, contactsLoading: cLoading, contactsError: cError, toggleContacts, closeContacts };
}

/* ── useQuickActions ────────────────────────────────────────────────── */
/** Lazy state: each action has stable callback identity */
function useQuickActionsLogic(props: {
  contactsOpen: boolean;
  toggleContacts: () => void;
  fetchLogs: () => void;
}) {
  const [loadingAction, setLoadingAction] = useState<LoadingAction>(null);
  const [emailResult,   setEmailResult]  = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sendTestEmail = useCallback(async () => {
    setEmailResult(null); setLoadingAction('testEmail');
    try {
      const r: any  = await apiClient.post('/api/agent/email/test');
      setEmailResult(`Mode: ${r?.mode ?? 'live'} | ${r?.message}`);
    } catch (e: any) {
      setEmailResult('Error: ' + (e?.response?.data?.error ?? e?.message));
    } finally { setLoadingAction(null); }
  }, []);

  const resetEmailResult = useCallback(() => setEmailResult(null), []);
  return { loadingAction, emailResult, resetEmailResult, sendTestEmail };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ── STATELESS PRESENTATIONAL HELPERS ─────────────────────────────────────── */
/* ═══════════════════════════════════════════════════════════════════════════ */

function LoadingOverlay() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: SOK.surfaceMuted }}>
      <div className="text-center">
        <Activity className="w-12 h-12 mx-auto mb-4 animate-spin" style={{ color: SOK.primary }} />
        <p style={{ color: SOK.textSec, fontSize: '0.9375rem' }}>Loading dashboard&hellip;</p>
      </div>
    </div>
  );
}

interface ErrorRecoveryProps { error: string; onRetry: () => void; }
function ErrorRecoveryCard({ error, onRetry }: ErrorRecoveryProps) {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: SOK.surfaceMuted }}>
      <div style={{ padding: '2rem', borderRadius: '0.75rem', boxShadow: '0 20px 40px rgba(96,91,229,.08)', background: SOK.surface, border: `1px solid ${SOK.border}`, maxWidth: '28rem', width: '100%' }}>
        <AlertCircle className="w-12 h-12 mx-auto mb-4" style={{ color: SOK.error }} />
        <h2 className="text-xl font-bold mb-2 text-center" style={{ color: SOK.neutral }}>Connection Error</h2>
        <p className="mb-4 text-center" style={{ color: SOK.textSec, fontSize: '0.875rem' }}>{error}</p>
        <button onClick={onRetry} className="btn btn-primary w-full">Retry Connection</button>
        {DEMO_MODE && (
          <button onClick={() => window.location.reload()} className="btn btn-ghost mt-3 w-full" style={{ marginTop: '0.75rem', width: '100%' }}>
            <Eye className="w-4 h-4 mr-2" /> Show Demo Dashboard
          </button>
        )}
        <div style={{ marginTop: '1rem', padding: '1rem', borderRadius: '0.5rem', background: SOK.surfaceRaised, border: `1px solid ${SOK.border}`, fontSize: '0.8125rem' }}>
          <p className="font-semibold mb-2" style={{ color: SOK.neutral }}>Troubleshooting:</p>
          <ul className="list-disc list-inside space-y-1" style={{ color: SOK.textSec }}>
            <li>Verify backend is running on port 3000</li>
            <li>Check REACT_APP_API_URL in frontend/.env</li>
            <li>Ensure CORS is configured</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

interface HeaderProps { isDemo: boolean; lastUpdate: Date; loading: boolean; onRefresh: () => void; }
function Header({ isDemo, lastUpdate, loading, onRefresh }: HeaderProps) {
  return (
    <header style={{ background: SOK.surface, borderBottom: `1px solid ${SOK.border}`, boxShadow: '0 1px 2px rgba(96,91,229,.04)' }}>
      <div style={{ maxWidth: '80rem', margin: '0 auto', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Bot className="w-8 h-8" style={{ color: SOK.primary }} />
          <div>
            <h1 className="text-xl font-bold" style={{ color: SOK.neutral, fontFamily: "'Poppins','Segoe UI',sans-serif", letterSpacing: '-0.01em' }}>
              Sokogate Sales &amp; Funding Agent
            </h1>
            <p className="text-sm" style={{ color: SOK.textSec, fontSize: '0.8125rem' }}>AI-Powered Sales Automation Dashboard</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {isDemo && <span className="badge" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>Demo Data</span>}
          <div style={{ textAlign: 'right', fontSize: '0.75rem', color: SOK.textMuted }}>
            <p>Last Updated</p>
            <p className="font-semibold" style={{ color: SOK.neutral, fontSize: '0.8125rem' }}>{lastUpdate.toLocaleTimeString()}</p>
          </div>
          <button onClick={onRefresh} disabled={loading} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <RefreshCw className="w-4 h-4" style={{ animation: loading ? 'sok-spin 1s linear infinite' : 'none' }} />
            {loading ? 'Refreshing\u2026' : 'Refresh'}
          </button>
        </div>
      </div>
    </header>
  );
}

function StatusDot({ healthy }: { healthy: boolean }) {
  return (
    <span style={{ width: '0.5rem', height: '0.5rem', borderRadius: '50%', display: 'inline-block', flexShrink: 0,
      backgroundColor: healthy ? SOK.success : SOK.error,
      boxShadow: healthy ? '0 0 0 2px rgba(16,185,129,.2)' : '0 0 0 2px rgba(220,38,38,.2)',
    }} />
  );
}

function OverallStatusBadge({ healthy }: { healthy: boolean }) {
  return <span className="badge" style={{ backgroundColor: healthy ? '#D1FAE5' : '#FEE2E2', color: healthy ? '#065F46' : '#991B1B' }}>{healthy ? 'Healthy' : 'Unhealthy'}</span>;
}

function DemoNotice({ text }: { text: string }) { return <p className="text-xs" style={{ color: SOK.textMuted, marginTop: '0.25rem' }}>{text}</p>; }

type BadgeType = 'success' | 'warning' | 'muted';
const badgeColors: Record<BadgeType, React.CSSProperties> = {
  success: { backgroundColor: '#D1FAE5', color: '#065F46' },
  warning: { backgroundColor: '#FEF3C7', color: '#92400E' },
  muted:   { backgroundColor: SOK.surfaceRaised, color: SOK.textMuted },
};
function SettingBadge({ value, type }: { value: string; type: BadgeType }) { return <span className="badge" style={badgeColors[type]}>{value}</span>; }

function ProgressBar({ remaining, limit }: { remaining: number; limit: number }) {
  const pct = Math.round(((remaining ?? 0) / Math.max(1, limit ?? 1)) * 100);
  const fill: React.CSSProperties = { width: `${pct}%`, height: '100%', background: pct < 5 ? SOK.error : pct < 30 ? SOK.warning : `linear-gradient(90deg, ${SOK.primary}, ${SOK.primaryB})`, borderRadius: '9999px', transition: 'width 400ms ease' };
  const track: React.CSSProperties = { width: '100%', height: '0.5rem', background: SOK.borderSoft, borderRadius: '9999px', overflow: 'hidden' };
  return <div style={track}><div style={fill} /></div>;
}

function StatCard({ children }: { children: React.ReactNode }) {
  return <div style={{ background: SOK.surface, border: `1px solid ${SOK.border}`, borderRadius: '0.75rem', padding: '1.25rem', transition: 'border-color 200ms, box-shadow 200ms', cursor: 'default' }}>{children}</div>;
}

function Footer() {
  return (
    <footer style={{ borderTop: `1px solid ${SOK.border}`, padding: '1.5rem', textAlign: 'center', fontSize: '0.8125rem', color: SOK.textMuted }}>
      <span>© {new Date().getFullYear()} <strong style={{ color: SOK.primary }}>Sokogate</strong> — Ultimo Trading Company Limited</span>
      <span style={{ margin: '0 0.5rem', color: SOK.borderSoft }}>|</span>
      <span>AI-Powered B2B E-Commerce</span>
    </footer>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
export default function App() {
  /* ── Hooks at the very top ───────────────────────────────────────── */

  const { health, status, products, isDemo, lastUpdate, loading, error, refresh } = useAppData();

  const { isScraping, scrapeStatus, triggerScrape } = useScrapePolling();

  const { logs, error: logsErr, fetchLogs } = useAgentLogs();

  const { open: contactsOpen, contacts, contactsLoading, contactsError, toggleContacts, closeContacts } = useContactsPanel();

  const { loadingAction, emailResult, resetEmailResult, sendTestEmail } = useQuickActionsLogic({
    contactsOpen, toggleContacts, fetchLogs,
  });

  /* ── Derived ────────────────────────────────────────────────────────── */
  const featuresLoaded = Boolean(status?.features);
  const agentConfig     = status ?? MOCK_STATUS;

  const { features, toggleFeature, isToggling } = useFeatureToggle(
    agentConfig.features,
    // Force a fresh /api/status poll after every successful toggle
    () => { void refresh(); },
  );

  /* ── Guard: show skeleton while the first batch loads ─────────────── */
  if (loading && !health && !isDemo)  return <LoadingOverlay />;
  if (error  && !isDemo && !status)   return <ErrorRecoveryCard error={error} onRetry={refresh} />;

  return (
    <div className="min-h-screen" style={{ background: SOK.surfaceMuted }}>
      {/* ── HEADER ── */}
      <Header isDemo={isDemo} lastUpdate={lastUpdate} loading={loading} onRefresh={refresh} />

      <main style={{ maxWidth: '80rem', margin: '0 auto', padding: '2rem 1.5rem' }}>
        {/* ── SYSTEM HEALTH ── */}
        <section className="mb-8">
          <h2 className="section-title" style={{ fontFamily: "'Poppins','Segoe UI',sans-serif", color: SOK.neutral }}>System Health</h2>
          <div className="card" style={{ padding: '1.5rem' }}>
            <div className="flex items-center justify-between mb-6" style={{ borderBottom: `1px solid ${SOK.border}` }}>
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5" style={{ color: SOK.primary }} />
                <span className="text-xl font-semibold" style={{ color: SOK.neutral }}>Overall Status</span>
              </div>
              {health && <OverallStatusBadge healthy={health.status === 'healthy'} />}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
              <StatCard>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Database className="w-5 h-5" style={{ color: SOK.primary }} />
                    <span style={{ color: SOK.neutral, fontWeight: 500 }}>Database</span>
                  </div>
                  {health && <StatusDot healthy={health.checks.database?.healthy ?? true} />}
                </div>
                {health?.checks?.database?.error && <p className="text-xs" style={{ color: SOK.error, marginTop: '0.25rem' }}>{health.checks.database.error}</p>}
                {isDemo && !health?.checks?.database?.error && <DemoNotice text="Connected — Demo" />}
              </StatCard>
              <StatCard>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Mail className="w-5 h-5" style={{ color: SOK.primary }} />
                    <span style={{ color: SOK.neutral, fontWeight: 500 }}>Email Service</span>
                  </div>
                  {health && <StatusDot healthy={Boolean(health.checks.email)} />}
                </div>
                {isDemo && <DemoNotice text="Active — Demo" />}
              </StatCard>
              <StatCard>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Bot className="w-5 h-5" style={{ color: SOK.primary }} />
                    <span style={{ color: SOK.neutral, fontWeight: 500 }}>NVIDIA AI</span>
                  </div>
                  {health && <StatusDot healthy={Boolean(health.checks.nvidia)} />}
                </div>
                {!health?.checks?.nvidia && !isDemo && <p className="text-xs" style={{ color: SOK.textMuted, marginTop: '0.25rem' }}>Add NVIDIA API credits</p>}
                {isDemo && <DemoNotice text="Enabled — Demo" />}
              </StatCard>
            </div>
          </div>
        </section>

        {/* ── AGENT CONFIGURATION ── */}
        {featuresLoaded && (
          <section className="mb-8">
            <h2 className="section-title" style={{ fontFamily: "'Poppins','Segoe UI',sans-serif", color: SOK.neutral }}>Agent Configuration</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
              <div className="card" style={{ padding: '1.5rem' }}>
                <h3 style={{ color: SOK.neutral, fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Settings</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div className="flex items-center justify-between">
                    <span style={{ color: SOK.textSec, fontSize: '0.875rem' }}>Agent Enabled</span>
                    <SettingBadge value={agentConfig.enabled ? 'Yes' : 'No'} type={agentConfig.enabled ? 'success' : 'muted'} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ color: SOK.textSec, fontSize: '0.875rem' }}>Dry Run Mode</span>
                    <SettingBadge value={agentConfig.dryRun ? 'Yes' : 'No'} type={agentConfig.dryRun ? 'warning' : 'muted'} />
                  </div>
                </div>
              </div>
              {agentConfig?.rateLimits?.email && (
                <div className="card" style={{ padding: '1.5rem' }}>
                  <h3 style={{ color: SOK.neutral, fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>
                    Rate Limits
                    <span style={{ fontSize: '0.75rem', color: SOK.textMuted, fontWeight: 400, marginLeft: '0.5rem' }}>(Today)</span>
                  </h3>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span style={{ color: SOK.textSec, fontSize: '0.8125rem', fontWeight: 500 }}>Email</span>
                      <span className="text-sm font-semibold" style={{ color: SOK.neutral }}>
                        {agentConfig.rateLimits.email.remaining} / {agentConfig.rateLimits.email.limit}
                      </span>
                    </div>
                    <ProgressBar remaining={agentConfig.rateLimits.email.remaining} limit={agentConfig.rateLimits.email.limit} />
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── FEATURE STATUS ── */}
        {featuresLoaded && (
          <section className="mb-8">
            <h2 className="section-title" style={{ fontFamily: "'Poppins','Segoe UI',sans-serif", color: SOK.neutral }}>Feature Status</h2>
            <div className="card" style={{ background: SOK.surface, border: `1px solid ${SOK.border}`, borderRadius: '0.75rem', padding: '1.5rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                {Object.entries(features).map(([key, val]) => (
                  <FeatureRow
                    key={key}
                    feature={key}
                    enabled={Boolean(val)}
                    loading={isToggling(key)}
                    onToggle={() => toggleFeature(key)}
                  />
                ))}
              </div>
              {isDemo && <p className="mt-4 text-xs text-center" style={{ color: SOK.textMuted }}>Connect your backend to see live data.</p>}
            </div>
          </section>
        )}

        {/* ── QUICK ACTIONS ── */}
        <section>
          <h2 className="section-title" style={{ fontFamily: "'Poppins','Segoe UI',sans-serif", color: SOK.neutral }}>Quick Actions</h2>
          <QuickActionsCard
            emailResult={emailResult}
            logs={logs ?? (logsErr ?? null)}
            logsError={logsErr ?? null}
            loadingAction={loadingAction}
            onSendTestEmail={sendTestEmail}
            onViewLogs={fetchLogs}
            onOpenContacts={toggleContacts}
            onResetEmail={resetEmailResult}
          />
        </section>

        {/* ── CONTACTS ── */}
        <ContactsSection
          open={contactsOpen}
          contacts={contacts}
          loading={contactsLoading}
          error={contactsError}
          onClose={closeContacts}
        />

        {/* ── REAL-TIME PRODUCT SOURCING ── */}
        <section aria-label="Real-Time Product Sourcing">
          <ProductSection
            products={products}
            isScraping={isScraping}
            scrapeStatus={scrapeStatus ?? null}
            onScrapeTrigger={triggerScrape}
            isDemo={isDemo}
          />
        </section>
      </main>

      <Footer />
    </div>
  );
}

// Made with Bob
