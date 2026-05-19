/**
 * Dashboard — Sokogate Sales & Funding Agent
 *
 * Polls /api/status (30s) and /api/health (60s) independently so health
 * refresh is not blocked by a slow status response and vice-versa.
 * Both hooks use AbortController so stale ticks never race the UI.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Activity, Bot, AlertCircle, RefreshCw } from 'lucide-react';
import { apiClient } from '@/api/client';
import { SystemHealth, QuickActionsBar, SlideOverPanel, TestEmailPanel, AgentLogsPanel, ContactsPanel, ProductSourcingCard, OutreachPanel, AgentHub, FeatureRow } from '@/components';
import type { HealthCheck, AgentStatus } from '@/types';
import { EmailPanelProvider } from '@/context/EmailPanelContext';

import { Toaster } from 'react-hot-toast';

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
    agentsEnabled: true,
  },
  rateLimits: { email: { remaining: 78, limit: 100 } },
};
const MOCK_PRODUCTS: any[] = [];

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ── POLLING HOOKS ────────────────────────────────────────────────────────── */

/**
 * useStatusPolling  — polls GET /api/status every 30 s.
 * Uses AbortController so a lingering tick from the previous 30-s does not
 * overwrite state set by a fresher request.
 */
function useStatusPolling() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [isDemo, setIsDemo] = useState(false);

  const fetchStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      const r: any = await (apiClient.get as any)('/status', { signal });
      if (r != null && typeof r === 'object' && 'features' in r) {
        setStatus(r as AgentStatus);
        setIsDemo(false);
      }
    } catch (_e: any) { if (DEMO_MODE) setIsDemo(true); }
  }, []);

  useEffect(() => {
    let ctrl = new AbortController();
    const tick = () => {
      ctrl.abort();
      ctrl = new AbortController();
      void fetchStatus(ctrl.signal);
    };
    tick();
    const timer = setInterval(tick, 30_000);
    return () => { ctrl.abort(); clearInterval(timer); };
  }, [fetchStatus]);

  return { status, isDemo };
}

/**
 * useHealthPolling  — polls GET /api/health every 60 s.
 * Separate from status so health checks don't block status fetches.
 */
function useHealthPolling() {
  const [health, setHealth] = useState<HealthCheck | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async (signal?: AbortSignal) => {
    try {
      const r: any = await (apiClient.get as any)('/health', { signal });
      if (r?.checks) setHealth(r as HealthCheck);
    } catch (e: any) {
      console.warn('[App] /health fetch failed:', e?.message);
      setError(e?.message ?? 'Health check failed');
    }
  }, []);

  useEffect(() => {
    let ctrl = new AbortController();
    const tick = () => {
      ctrl.abort();
      ctrl = new AbortController();
      void fetchHealth(ctrl.signal);
    };
    tick();
    const timer = setInterval(tick, 60_000);
    return () => { ctrl.abort(); clearInterval(timer); };
  }, [fetchHealth]);

  return { health, error };
}

function useFeatureToggle(
  initialFeatures: Record<string, boolean>,
  onToggleCallback?: () => void,
) {
  const [features, setFeatures] = useState(initialFeatures);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const featuresRef = useRef(features);
  featuresRef.current = features;

  const toggleFeature = useCallback(async (key: string) => {
    const nextVal = !featuresRef.current[key];
    // Optimistic UI update
    setFeatures(prev => ({ ...prev, [key]: nextVal }));
    setTogglingKey(key);
    try {
      await apiClient.toggleFeature(key, nextVal);
      onToggleCallback?.();
    } catch (_err: any) {
      // Revert on failure
      setFeatures(prev => ({ ...prev, [key]: !nextVal }));
      console.error('[useFeatureToggle] toggle failed:', key);
    } finally {
      setTogglingKey(null);
    }
  }, [onToggleCallback]);

  const isToggling = useCallback((key: string) => togglingKey === key, [togglingKey]);
  return { features, toggleFeature, isToggling };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ── STATELESS HELPERS ─────────────────────────────────────────────────────── */

function StatusDot({ healthy }: { healthy: boolean }) {
  return (
    <span style={{
      width: '0.5rem', height: '0.5rem', borderRadius: '50%', display: 'inline-block',
      backgroundColor: healthy ? '#10B981' : '#DC2626',
      boxShadow: healthy ? '0 0 0 2px rgba(16,185,129,.2)' : '0 0 0 2px rgba(220,38,38,.2)',
    }} />
  );
}

function OverallStatusBadge({ healthy }: { healthy: boolean }) {
  return <span className="badge" style={{ backgroundColor: healthy ? '#D1FAE5' : '#FEE2E2', color: healthy ? '#065F46' : '#991B1B', padding: '0.25rem 0.75rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>{healthy ? 'Healthy' : 'Unhealthy'}</span>;
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <h2 className="section-title" style={{ fontFamily: "'Poppins','Segoe UI',sans-serif", color: '#070707', fontSize: '1.125rem', fontWeight: 600 }}>{children}</h2>;
}

function ProgressBar({ remaining, limit }: { remaining: number; limit: number }) {
  const pct = Math.round(((remaining ?? 0) / Math.max(1, limit ?? 1)) * 100);
  const fill: React.CSSProperties = { width: `${pct}%`, height: '100%', background: pct < 5 ? '#DC2626' : pct < 30 ? '#F59E0B' : 'linear-gradient(90deg,#605BE5,#6B6DFF)', borderRadius: '9999px', transition: 'width 400ms ease' };
  const track: React.CSSProperties = { width: '100%', height: '0.5rem', background: '#E8E8E8', borderRadius: '9999px', overflow: 'hidden' };
  return <div style={track}><div style={fill} /></div>;
}

function StatusBadge({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex flex-col items-center p-3 rounded-xl" style={{ background: ok ? '#ECFDF5' : '#FEF2F2' }}>
      <StatusDot healthy={ok} />
      <span className="text-xs font-medium mt-1.5" style={{ color: ok ? '#065F46' : '#991B1B' }}>{label}</span>
    </div>
  );
}

/** ⚠️  Warning banner shown when health or status fetch has failed. */
function StatusWarningBanner({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (!error) return null;
  return (
    <div className="mb-6 px-4 py-3 rounded-xl flex items-center gap-3" style={{ background: '#FFFBEB', border: '1px solid #FCD34D' }}>
      <AlertCircle className="w-5 h-5" style={{ color: '#D97706', flexShrink: 0 }} />
      <p className="text-sm flex-1" style={{ color: '#92400E' }}>
        System status unavailable. Some features may be limited.
      </p>
      <button onClick={onRetry} className="px-3 py-1 rounded-lg text-xs font-semibold" style={{ background: '#F59E0B', color: '#fff' }}>
        Retry
      </button>
    </div>
  );
}

function Footer() {
  return (
    <footer className="mt-8 py-3 text-center" style={{ color: '#888899', fontSize: '0.75rem', borderTop: '1px solid #E5E5FF' }}>
      &copy; {new Date().getFullYear()} <strong style={{ color: '#605BE5' }}>Sokogate</strong> &mdash; Ultimo Trading Company Limited
    </footer>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ── MAIN ─────────────────────────────────────────────────────────────────── */

export default function App() {
  const { status, isDemo: statusIsDemo } = useStatusPolling();
  const { health, error: healthError }  = useHealthPolling();

  const featuresLoaded = Boolean(status?.features);
  const agentConfig     = status ?? MOCK_STATUS;

  const { features, toggleFeature, isToggling } = useFeatureToggle(
    agentConfig.features, () => { void handleRetry(); },
  );

  const [activePanel, setActivePanel] = useState<'email' | 'logs' | 'contacts' | null>(null);
  const [refreshProducts, setRefreshProducts] = useState(0);
  const [retryTrigger, setRetryTrigger]   = useState(0);

  const handleProductsUpdated = useCallback(() => {
    setRefreshProducts(prev => prev + 1);
  }, []);

  const handleRetry = useCallback(() => { setRetryTrigger(prev => prev + 1); }, []);

  const hasWarning = Boolean(healthError);

  // ── Guards ────────────────────────────────────────────────────────────────
  if (!status && !statusIsDemo) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#FAFAFF' }}>
        <div className="text-center">
          <Activity className="w-12 h-12 mx-auto mb-4 animate-spin" style={{ color: '#605BE5' }} />
          <p style={{ color: '#555566', fontSize: '0.9375rem' }}>Loading dashboard…</p>
        </div>
      </div>
    );
  }

  return (
    <EmailPanelProvider>
    <div className="min-h-screen" style={{ background: '#FAFAFF' }}>
      {/* Global toast container */}
      <Toaster position="top-right" toastOptions={{ duration: 4000, style: { fontSize: '0.875rem' } }} />

      {/* ── HEADER ── */}
      <header style={{ background: '#FFFFFF', borderBottom: '1px solid #E5E5FF', boxShadow: '0 1px 2px rgba(96,91,229,.04)' }}>
        <div style={{ maxWidth: '80rem', margin: '0 auto', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Bot className="w-8 h-8" style={{ color: '#605BE5' }} />
            <div>
              <h1 className="text-xl font-bold" style={{ color: '#070707', fontFamily: "'Poppins','Segoe UI',sans-serif", letterSpacing: '-0.01em' }}>
                Sokogate Sales &amp; Funding Agent
              </h1>
              <p className="text-xs" style={{ color: '#555566', fontSize: '0.75rem' }}>AI-Powered Sales Automation Dashboard</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            {statusIsDemo && <span className="badge" style={{ background: '#FEF3C7', color: '#92400E', padding: '0.25rem 0.75rem', borderRadius: '9999px', fontSize: '0.75rem' }}>Demo</span>}
            <button onClick={handleRetry} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', padding: '0.5rem 1rem', borderRadius: '0.5rem', fontSize: '0.8125rem', border: 'none', cursor: 'pointer' }}>
              <RefreshCw className="w-4 h-4" style={{ color: '#fff' }} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: '80rem', margin: '0 auto', padding: '2rem 1.5rem' }}>

        {/* ⚠️ Warning banner */}
        <StatusWarningBanner error={healthError} onRetry={handleRetry} />

        {/* ── 1. System Health ── */}
        <div className="mb-8">
          <SectionHeader>
            <Activity className="w-5 h-5 inline-block mr-2" style={{ color: '#605BE5' }} />
            System Health
          </SectionHeader>
          <div className="card" style={{ background: '#FFFFFF', border: '1px solid #E5E5FF', borderRadius: '0.75rem', padding: '1.5rem' }}>
            <div className="flex items-center justify-between mb-4" style={{ borderBottom: '1px solid #E5E5FF', paddingBottom: '0.75rem' }}>
              <span className="text-lg font-semibold" style={{ color: '#070707' }}>Overall Status</span>
              {health && <OverallStatusBadge healthy={health.status === 'healthy'} />}
              {!health && !statusIsDemo && <span className="text-sm" style={{ color: '#888899' }}>Loading…</span>}
            </div>
            {health ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                <StatusBadge label="Database"  ok={health.checks.database?.healthy ?? true} />
                <StatusBadge label="Email"     ok={!!health.checks.email} />
                <StatusBadge label="NVIDIA AI" ok={!!health.checks.nvidia} />
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                {[0,1,2].map(i => <div key={i} className="animate-pulse h-12 rounded-xl" style={{ background: '#F5F5FF' }} />)}
              </div>
            )}
          </div>
        </div>

        {/* ── 2. Quick Actions ── */}
        <QuickActionsBar
          onEmailClick={() => setActivePanel('email')}
          onLogsClick={() => setActivePanel('logs')}
          onContactsClick={() => setActivePanel('contacts')}
        />

        {/* ── 3. Product Sourcing ── */}
        <ProductSourcingCard />

        {/* ── 4. Automated Outreach ── */}
        <OutreachPanel />

        {/* ── 5. Agent Configuration ── */}
        {featuresLoaded && (
          <section className="mb-8">
            <SectionHeader>Agent Configuration</SectionHeader>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
              <div className="card" style={{ background: '#FFFFFF', border: '1px solid #E5E5FF', borderRadius: '0.75rem', padding: '1.5rem' }}>
                <h3 style={{ color: '#070707', fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Settings</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div className="flex items-center justify-between">
                    <span style={{ color: '#555566', fontSize: '0.875rem' }}>Agent Enabled</span>
                    <span className="badge" style={{ background: agentConfig.enabled ? '#D1FAE5' : '#F3F4F6', color: agentConfig.enabled ? '#065F46' : '#6B7280', padding: '0.25rem 0.75rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>
                      {agentConfig.enabled ? 'Yes' : 'No'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ color: '#555566', fontSize: '0.875rem' }}>Mode</span>
                    <span className="badge" style={{
                      background: agentConfig.dryRun ? '#FEF3C7' : '#D1FAE5',
                      color:    agentConfig.dryRun ? '#92400E' : '#065F46',
                      padding: '0.25rem 0.75rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600,
                    }}>
                      {agentConfig.dryRun ? 'Dry Run' : 'Live'}
                    </span>
                  </div>
                </div>
              </div>
              {agentConfig?.rateLimits?.email && (
                <div className="card" style={{ background: '#FFFFFF', border: '1px solid #E5E5FF', borderRadius: '0.75rem', padding: '1.5rem' }}>
                  <h3 style={{ color: '#070707', fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>
                    Rate Limits<span style={{ fontSize: '0.75rem', color: '#888899', fontWeight: 400, marginLeft: '0.5rem' }}>(Today)</span>
                  </h3>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span style={{ color: '#555566', fontSize: '0.8125rem', fontWeight: 500 }}>Email</span>
                      <span className="text-sm font-semibold" style={{ color: '#070707' }}>
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

        {/* ── 6. Feature Status ── */}
        {featuresLoaded && (
          <section className="mb-8">
            <SectionHeader>Feature Status</SectionHeader>
            <div className="card" style={{ background: '#FFFFFF', border: '1px solid #E5E5FF', borderRadius: '0.75rem', padding: '1.5rem' }}>
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
              {statusIsDemo && <p className="mt-4 text-xs text-center" style={{ color: '#888899' }}>Connect your backend to see live data.</p>}
            </div>
          </section>
        )}

        {/* ── 7. Autonomous Agents ── */}
        <AgentHub onProductsUpdated={handleProductsUpdated} />

        {/* ── Slide-over panels ── */}
        <SlideOverPanel isOpen={activePanel === 'email'}   onClose={() => setActivePanel(null)} title="Test Email">
          <TestEmailPanel />
        </SlideOverPanel>

        <SlideOverPanel isOpen={activePanel === 'logs'}    onClose={() => setActivePanel(null)} title="Agent Logs">
          <AgentLogsPanel />
        </SlideOverPanel>

        <SlideOverPanel isOpen={activePanel === 'contacts'} onClose={() => setActivePanel(null)} title="Contacts">
          <ContactsPanel />
        </SlideOverPanel>
      </main>

      <Footer />
    </div>
    </EmailPanelProvider>
  );
}
