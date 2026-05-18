/**
 * Dashboard — Sokogate Sales & Funding Agent (Overhaul)
 *
 * Lean page coordinator (~250 LOC). Renders five high-level sections,
 * delegates all complex lifting to custom hooks / sub-components.
 *
 * Mirrors the plan's section order:
 *   1. Header
 *   2. SystemHealth
 *   3. QuickActions
 *   4. ProductSourcing
 *   5. OutreachPanel
 *   6. AgentHub
 *   7. Footer
 *
 * Retains the fully-wired Buddy (feature flags, feature toggle, contacts
 * panel, quota bar) through the smallest own-state footprint possible.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Activity, Database, Mail, Bot, AlertCircle, RefreshCw } from 'lucide-react';
import { apiClient } from '@/api/client';
import { SOK } from '@/design-tokens';
import { SystemHealth, QuickActions, ProductSourcing, OutreachPanel, AgentHub, ContactsSection, FeatureRow } from '@/components';
import type { HealthCheck, AgentStatus } from '@/types';

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
/* ── HOOKS ────────────────────────────────────────────────────────────────── */

function useAppData() {
  const [health,    setHealth]    = useState<HealthCheck | null>(null);
  const [status,    setStatus]    = useState<AgentStatus | null>(null);
  const [isDemo,    setIsDemo]    = useState(false);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [lastUpd,   setLastUpd]   = useState(new Date());

  const fetchAll = useCallback(async () => {
    setLoading(true); setError(null); setIsDemo(false);
    try {
      const r: any = await apiClient.get('/status');
      if (r != null && typeof r === 'object' && 'features' in r) { setStatus(r); setIsDemo(false); }
    } catch (e: any) { console.warn('[App] /status fetch failed:', e?.message); if (DEMO_MODE) setIsDemo(true); }

    try {
      const h: any = await apiClient.get('/health');
      setHealth(h);
    } catch (e: any) {
      console.warn('[App] /health fetch failed:', e?.message);
      if (DEMO_MODE) setError('Backend unreachable — displaying demo data.');
    }

    if (DEMO_MODE && !status && !health) {
      setHealth(MOCK_HEALTH); setStatus(MOCK_STATUS); setIsDemo(true);
    }

    setLastUpd(new Date()); setLoading(false);
  }, [DEMO_MODE]);

  const refresh = useCallback(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    let ctrl = new AbortController();
    let timer = setInterval(() => { ctrl.abort(); ctrl = new AbortController(); fetchAll(); }, 30_000);
    return () => { ctrl.abort(); clearInterval(timer); };
  }, [fetchAll]);

  return { health, status, isDemo, loading, error, lastUpdate: lastUpd, refresh };
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
    setFeatures(prev => ({ ...prev, [key]: nextVal }));
    setTogglingKey(key);
    try {
      await apiClient.toggleFeature(key, nextVal);
      onToggleCallback?.();
    } catch (err: any) {
      setFeatures(prev => ({ ...prev, [key]: !nextVal }));
      console.error('[useFeatureToggle] toggle failed:', key, err?.message);
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
      backgroundColor: healthy ? SOK.success : SOK.error,
      boxShadow: healthy ? '0 0 0 2px rgba(16,185,129,.2)' : '0 0 0 2px rgba(220,38,38,.2)',
    }} />
  );
}

function OverallStatusBadge({ healthy }: { healthy: boolean }) {
  return <span className="badge" style={{ backgroundColor: healthy ? '#D1FAE5' : '#FEE2E2', color: healthy ? '#065F46' : '#991B1B' }}>{healthy ? 'Healthy' : 'Unhealthy'}</span>;
}

function DemoNotice({ text }: { text: string }) {
  return <p className="text-xs" style={{ color: SOK.textMuted, marginTop: '0.25rem' }}>{text}</p>;
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <h2 className="section-title" style={{ fontFamily: "'Poppins','Segoe UI',sans-serif", color: SOK.neutral }}>{children}</h2>;
}

function LoadingOverlay() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: SOK.surfaceMuted }}>
      <div className="text-center">
        <Activity className="w-12 h-12 mx-auto mb-4 animate-spin" style={{ color: SOK.primary }} />
        <p style={{ color: SOK.textSec, fontSize: '0.9375rem' }}>Loading dashboard…</p>
      </div>
    </div>
  );
}

function ErrorRecoveryCard({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: SOK.surfaceMuted }}>
      <div style={{ padding: '2rem', borderRadius: '0.75rem', boxShadow: '0 20px 40px rgba(96,91,229,.08)', background: SOK.surface, border: `1px solid ${SOK.border}`, maxWidth: '28rem', width: '100%' }}>
        <AlertCircle className="w-12 h-12 mx-auto mb-4" style={{ color: SOK.error }} />
        <h2 className="text-xl font-bold mb-2 text-center" style={{ color: SOK.neutral }}>Connection Error</h2>
        <p className="mb-4 text-center" style={{ color: SOK.textSec, fontSize: '0.875rem' }}>{error}</p>
        <button onClick={onRetry} className="btn btn-primary w-full">Retry Connection</button>
        {DEMO_MODE && <button onClick={() => window.location.reload()} className="btn btn-ghost mt-3 w-full" style={{ marginTop: '0.75rem', width: '100%' }}>Show Demo Dashboard</button>}
      </div>
    </div>
  );
}

function SwotStatsSection({ health, isDemo }: { health: HealthCheck | null; isDemo: boolean }) {
  return (
    <div className="mb-8">
      <SectionHeader>
        <Activity className="w-5 h-5 inline-block mr-2" style={{ color: SOK.primary }} />
        System Health
      </SectionHeader>
      <div className="card" style={{ padding: '1.5rem' }}>
        <div className="flex items-center justify-between mb-6" style={{ borderBottom: `1px solid ${SOK.border}` }}>
          <span className="text-xl font-semibold" style={{ color: SOK.neutral }}>Overall Status</span>
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
    </div>
  );
}

type BadgeType = 'success' | 'warning' | 'muted';
const badgeColors: Record<BadgeType, React.CSSProperties> = {
  success: { backgroundColor: '#D1FAE5', color: '#065F46' },
  warning: { backgroundColor: '#FEF3C7', color: '#92400E' },
  muted:   { backgroundColor: SOK.surfaceRaised, color: SOK.textMuted },
};
function SettingBadge({ value, type }: { value: string; type: BadgeType }) { return <span className="badge" style={badgeColors[type]}>{value}</span>; }

function ProgressBar({ remaining, limit }: { remaining: number; limit: number }) {
  const pct = Math.round(((remaining ?? 0) / Math.max(1, limit ?? 1)) * 100);
  const fill: React.CSSProperties = { width: `${pct}%`, height: '100%', background: pct < 5 ? SOK.error : pct < 30 ? SOK.warning : `linear-gradient(90deg,${SOK.primary},${SOK.primaryB})`, borderRadius: '9999px', transition: 'width 400ms ease' };
  const track: React.CSSProperties = { width: '100%', height: '0.5rem', background: SOK.borderSoft, borderRadius: '9999px', overflow: 'hidden' };
  return <div style={track}><div style={fill} /></div>;
}

function StatCard({ children }: { children: React.ReactNode }) {
  return <div className="stat-card">{children}</div>;
}

function Footer() {
  return (
    <footer className="mt-8 py-4 text-center text-xs" style={{ color: SOK.textMuted, borderTop: `1px solid ${SOK.border}` }}>
      <span>© {new Date().getFullYear()} <strong style={{ color: SOK.primary }}>Sokogate</strong> — Ultimo Trading Company Limited</span>
    </footer>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ── MAIN ─────────────────────────────────────────────────────────────────── */

export default function App() {
  const { health, status, isDemo, loading, error, lastUpdate, refresh } = useAppData();

  const featuresLoaded = Boolean(status?.features);
  const agentConfig     = status ?? MOCK_STATUS;

  const { features, toggleFeature, isToggling } = useFeatureToggle(
    agentConfig.features,
    () => { void refresh(); },
  );

  // Opening contacts panel is handled inside QuickActions — still expose
  // the flag here so ContactsSection can be toggled from this scope.
  const [contactsOpen, setContactsOpen]    = useState(false);

  // Refresh products list after bulk sourcing run
  const [refreshProducts, setRefreshProducts] = useState(0);
  const handleProductsUpdated = useCallback(() => {
    setRefreshProducts((prev) => prev + 1);
  }, []);

  // ── Guards ────────────────────────────────────────────────────────────────
  if (loading && !health && !isDemo) return <LoadingOverlay />;
  if (error  && !isDemo && !status)   return <ErrorRecoveryCard error={error} onRetry={refresh} />;

  return (
    <div className="min-h-screen" style={{ background: SOK.surfaceMuted }}>
      {/* ── HEADER ── */}
      <header style={{ background: SOK.surface, borderBottom: `1px solid ${SOK.border}`, boxShadow: '0 1px 2px rgba(96,91,229,.04)' }}>
        <div style={{ maxWidth: '80rem', margin: '0 auto', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Bot className="w-8 h-8" style={{ color: SOK.primary }} />
            <div>
              <h1 className="text-xl font-bold" style={{ color: SOK.neutral, fontFamily: "'Poppins','Segoe UI',sans-serif", letterSpacing: '-0.01em' }}>
                Sokogate Sales &amp; Funding Agent
              </h1>
              <p className="text-xs" style={{ color: SOK.textSec, fontSize: '0.75rem' }}>AI-Powered Sales Automation Dashboard</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            {isDemo && <span className="badge" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>Demo</span>}
            <span className="text-xs" style={{ color: SOK.textMuted, fontSize: '0.75rem' }}>
              {lastUpdate.toLocaleTimeString()}
            </span>
            <button onClick={refresh} disabled={loading} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
              <RefreshCw className="w-4 h-4" style={{ animation: loading ? 'sok-spin 1s linear infinite' : 'none' }} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: '80rem', margin: '0 auto', padding: '2rem 1.5rem' }}>

        {/* ── 1. System Health ── */}
        <SystemHealth />

        {/* ── 2. Quick Actions ── */}
        <QuickActions />

        {/* ── 3. Real-Time Product Sourcing ── */}
        <ProductSourcing key={refreshProducts} />

        {/* ── 4. Automated Outreach ── */}
        <OutreachPanel />

        {/* ── 5. Agent Configuration ── */}
        {featuresLoaded && (
          <section className="mb-8">
            <SectionHeader>Agent Configuration</SectionHeader>
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
                    Rate Limits<span style={{ fontSize: '0.75rem', color: SOK.textMuted, fontWeight: 400, marginLeft: '0.5rem' }}>(Today)</span>
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

        {/* ── 6. Feature Status ── */}
        {featuresLoaded && (
          <section className="mb-8">
            <SectionHeader>Feature Status</SectionHeader>
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

        {/* ── 7. Autonomous Agents ── */}
        <AgentHub onProductsUpdated={handleProductsUpdated} />

        {/* ── Contacts Panel ── */}
        <ContactsSection
          open={contactsOpen}
          contacts={null}
          loading={false}
          error={null}
          onClose={() => setContactsOpen(false)}
        />
      </main>

      <Footer />
    </div>
  );
}
