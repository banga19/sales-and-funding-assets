import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity,
  Database,
  Mail,
  MessageSquare,
  Bot,
  AlertCircle,
  RefreshCw,
  Eye,
  Package,
  Image as ImageIcon,
  Search,
  XCircle,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { apiClient } from './api/client';
import type { HealthCheck, AgentStatus, Product, ScrapeStatusResponse } from './types';
import './App.css';

/* ──────────────────────────────────
   Sokogate / Ultimo Trading brand tokens
   Primary : #605BE5  (Sokogate Indigo)
   Hover   : #6B6DFF  (Bright Indigo)
   Neutral : #070707  (Near-black)
   Surface : #FFFFFF  (White)
   Border  : #E5E5FF  (Lilac tint)
────────────────────────────────── */

const SOK = {
  primary:       '#605BE5',
  primaryB:      '#6B6DFF',
  primaryDeep:   '#5456FF',
  neutral:       '#070707',
  surface:       '#FFFFFF',
  surfaceMuted:  '#FAFAFF',
  surfaceRaised: '#F5F5FF',
  border:        '#E5E5FF',
  borderSoft:    '#E8E8E8',
  textSec:       '#555566',
  textMuted:     '#888899',
  success:       '#10B981',
  error:         '#DC2626',
  warning:       '#F59E0B',
};

/* ─────────────────────────────────────────────
   DEMO MODE — toggle via VITE_DEMO_MODE=1 in frontend/.env
   When enabled the dashboard falls back to realistic mock
   data whenever the backend is unreachable; it always shows
   something — no blank error screens.
───────────────────────────────────────────── */
const DEMO_MODE = String((import.meta.env as any).VITE_DEMO_MODE ?? '0') === '1';

/* ── Mock data (realistic sample values) ── */
const MOCK_HEALTH: HealthCheck = {
  status:       'healthy',
  timestamp:    new Date().toISOString(),
  checks: {
    database: { healthy: true },
    email:    true,
    nvidia:      true,
  },
};

const MOCK_STATUS: AgentStatus = {
  enabled:  true,
  dryRun:   false,
  features: {
    email:             true,
    autoFollowup:      true,
    autoScheduling:    true,
    sentimentAnalysis: false,
    objectionHandling: false,
  },
  rateLimits: {
    email:    { remaining: 78,  limit: 100 },
  },
};

/* ══════════════════════════════════════════════════════════════
   MODULE-LEVEL DESIGN TOKENS & REUSABLE COMPONENTS
   Defined once, used everywhere  — single source of truth
   ══════════════════════════════════════════════════════════════ */

/* ── StatCard ── all System Health service cards share this layout */

const statCardBase: React.CSSProperties = {
  background:   SOK.surface,
  border:       `1px solid ${SOK.border}`,
  borderRadius: '0.75rem',
  padding:      '1.25rem',
  transition:   'border-color 200ms, box-shadow 200ms',
  cursor:       'default',
};
const _hovBorder = `${SOK.primary}`;
const _hovShadow = '0 4px 14px rgba(96,91,229,.10)';
const _rstBorder = SOK.border;
const _rstShadow = 'none';

function StatCard({ hovered, ...props }: { hovered?: boolean } & React.HTMLAttributes<HTMLDivElement>) {
  /* When used as a plain card (no hover tracking) just render the base style */
  if (!hovered) {
    return <div {...props} style={{ ...statCardBase, ...(props.style || {}) }} />;
  }
  const style: React.CSSProperties = {
    ...statCardBase,
    borderColor: _hovBorder, boxShadow: _hovShadow,
    ...(props.style || {}),
  };
  return <div {...props} style={style} />;
}

/* ── StatusDot / statusBadge ── reused across all sections */

function StatusDot({ healthy }: { healthy: boolean }) {
  const dot: React.CSSProperties = {
    width: '0.5rem', height: '0.5rem', borderRadius: '50%',
    display: 'inline-block', flexShrink: 0,
    backgroundColor: healthy ? SOK.success : SOK.error,
    boxShadow: healthy
      ? '0 0 0 2px rgba(16,185,129,.2)'
      : '0 0 0 2px rgba(220,38,38,.2)',
  };
  return <span style={dot} />;
}

const statusDot = (healthy?: boolean) => <StatusDot healthy={!!healthy} />;

function OverallStatusBadge({ healthy }: { healthy: boolean }) {
  const style: React.CSSProperties = {
    backgroundColor: healthy ? '#D1FAE5' : '#FEE2E2',
    color:           healthy ? '#065F46' : '#991B1B',
  };
  return <span className="badge" style={style}>{healthy ? 'Healthy' : 'Unhealthy'}</span>;
}

/* ── DemoNotice ── thin wrapper for every "— Demo" caption inside cards */

function DemoNotice({ text }: { text: string }) {
  return <p className="text-xs" style={{ color: SOK.textMuted, marginTop: '0.25rem' }}>{text}</p>;
}

/* ── SettingBadge / ProgressBar ── Agent Configuration section */

type BadgeType = 'success' | 'warning' | 'muted';
const badgeColors: Record<BadgeType, React.CSSProperties> = {
  success: { backgroundColor: '#D1FAE5', color: '#065F46' },
  warning: { backgroundColor: '#FEF3C7', color: '#92400E' },
  muted:   { backgroundColor: SOK.surfaceRaised, color: SOK.textMuted },
};
function SettingBadge({ value, type }: { value: string; type: BadgeType }) {
  return <span className="badge" style={badgeColors[type]}>{value}</span>;
}

export const progressPct = (remaining?: number, limit?: number) =>
  limit ? Math.round(((remaining ?? 0) / limit) * 100) : 0;

export function progressColor(remaining?: number, limit?: number): string {
  const pct = progressPct(remaining, limit);
  if (!limit || pct === 0) return SOK.borderSoft;
  if (pct < 5)  return SOK.error;
  if (pct < 30) return SOK.warning;
  return `linear-gradient(90deg, ${SOK.primary}, ${SOK.primaryB})`;
}

function ProgressBar({ remaining, limit }: { remaining: number; limit: number }) {
  const pct  = progressPct(remaining, limit);
  const fill: React.CSSProperties = {
    width:  `${pct}%`,
    height: '100%',
    background: progressColor(remaining, limit),
    borderRadius: '9999px',
    transition: 'width 400ms ease',
  };
  const track: React.CSSProperties = {
    width: '100%', height: '0.5rem',
    background: SOK.borderSoft,
    borderRadius: '9999px', overflow: 'hidden',
  };
  return <div style={track}><div style={fill} /></div>;
}

function FeatureRow({ feature, enabled }: { feature: string; enabled: boolean }) {
  const [hovered, setHovered] = useState(false);
  const rowStyle: React.CSSProperties = {
    padding: '0.75rem 1rem',
    borderRadius: '0.5rem',
    border: `1px solid ${hovered ? SOK.primary + '60' : SOK.borderSoft}`,
    background: SOK.surfaceRaised,
    transition: 'border-color 200ms',
    cursor: 'default',
  };
  const badgeStyle: React.CSSProperties = {
    backgroundColor: enabled ? '#D1FAE5' : '#F3F4F6',
    color:           enabled ? '#065F46' : '#6B7280',
    fontSize:        '0.6875rem',
  };
  return (
    <div
      style={rowStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ color: SOK.textSec, fontSize: '0.8125rem', fontWeight: 500, textTransform: 'capitalize' }}>
        {feature.replace(/([A-Z])/g, ' $1').trim()}
      </span>
      <span className="badge" style={badgeStyle}>{enabled ? 'On' : 'Off'}</span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════ */

function App() {
  const [health, setHealth]             = useState<HealthCheck | null>(null);
  const [status, setStatus]             = useState<AgentStatus | null>(null);
  const [products, setProducts]         = useState<Product[]>([]);
  const [scrapeStatus, setScrapeStatus] = useState<ScrapeStatusResponse | null>(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [lastUpdate, setLastUpdate]     = useState<Date>(new Date());
  const [isDemo, setIsDemo]             = useState(false);
  const [demoVisible, setDemoVisible]   = useState(false);
  const [isScraping, setIsScraping]     = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // ── Fire status, health, and products in parallel ──────────────────────────
      // All three are independent — no dependency between them.
      // We use Promise.all here for speed; each call has its own try/catch below.
      const [statusData, healthData, productsResp] = await Promise.all([
        apiClient.getStatus(),
        apiClient.getHealth(),
        apiClient.getProducts(),
      ]);

      let isDemo = false;

      // ── Agent status ───────────────────────────────────────────────────────────
      try {
        setStatus(statusData);
        setIsDemo(false);
      } catch (statusErr: any) {
        console.warn('[App] /api/status error:', statusErr.message);
        if (!DEMO_MODE) {
          setError('Agent status unavailable: ' + (statusErr.response?.data?.error || statusErr.message));
        }
      }

      // ── Health check ──────────────────────────────────────────────────────────
      try {
        setHealth(healthData);
      } catch (healthErr: any) {
        const code = healthErr.response?.status;
        if (code === 503) {
          console.warn('[App] Agent /api/health returned 503 — agent is running but some checks are not ready yet');
          setHealth({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
        checks: {
               database: { healthy: false, error: 'Connection not confirmed' },
               email:    false,
               nvidia:   false,
             },
          });
        } else {
          console.warn('[App] /api/health network error:', healthErr.message);
          if (!DEMO_MODE) {
            setError('Backend unreachable: ' + (healthErr.response?.data?.error || healthErr.message));
          }
        }
      }

      // ── Products ──────────────────────────────────────────────────────────────
      try {
        setProducts(productsResp.data);
      } catch (e: any) {
        console.warn('[App] /products fetch failed:', e.message);
        setProducts([]);
      }

      if (DEMO_MODE && !statusData) {
        console.warn('[App] Backend unreachable — using demo data');
        setHealth(MOCK_HEALTH);
        setStatus(MOCK_STATUS);
        setIsDemo(true);
      }

      setLastUpdate(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Poll scrape status every 2 s while a scrape is in-flight.
  // IsScraping is derived from the live phase ref — no dependency on the
  // closure-scraped scrapeStatus from the initial fetchData call.
  const phaseRef = useRef<ScrapeStatusResponse['phase'] | null>(scrapeStatus?.phase ?? null);
  useEffect(() => {
    if (!scrapeStatus || scrapeStatus.phase === 'idle') return;

    const poller = setInterval(async () => {
      try {
        const next: ScrapeStatusResponse = await apiClient.getScrapeStatus();
        const nextPhase = next.phase;
        phaseRef.current = nextPhase;
        setScrapeStatus(next);
        if (nextPhase === 'complete') {
          const prodList = await apiClient.getProducts();
          setProducts(prodList.data);
          setIsScraping(false);
        } else if (nextPhase === 'error') {
          setIsScraping(false);
        }
      } catch (e: any) {
        console.warn('[App] poller /products fetch failed:', e.message);
      }
    }, 2000);

    // Schedule setIsScraping once per poller mount — use current phase from ref
    setIsScraping(phaseRef.current === 'discovering' || phaseRef.current === 'scraping');

    return () => { clearInterval(poller); };
  }, [scrapeStatus?.phase]);

  // ── Handle: trigger scrape ───────────────────────────────────────────────────
  // Fire the POST without awaiting; set phase → discovering immediately so the
  // poller starts ≤1 ms after the click rather than after the network round-trip.
  const handleTriggerScrape = async (): Promise<void> => {
    setIsScraping(true);
    // intentionally not awaited — UI updates instantly
    apiClient.triggerScrape().then((resp) => {
      setScrapeStatus({
        success:    true,
        phase:      'discovering',
        message:    resp.message || 'Scrape triggered — discovering products…',
        productCount: 0,
        scrapedAt:  null,
        runId:      resp.runId ?? null,
      });
    }).catch((err: any) => {
      console.error('[App] Scrape trigger failed:', err.message);
      setIsScraping(false);
    });
  };

  /* ── Element-specific state transitions — App render helpers are at module level ── */

  /* ── Loading ── */
  if (loading && !health) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: SOK.surfaceMuted }}
      >
        <div className="text-center">
          <Activity
            className="w-12 h-12 mx-auto mb-4 animate-spin"
            style={{ color: SOK.primary }}
          />
          <p style={{ color: SOK.textSec, fontSize: '0.9375rem' }}>
            Loading dashboard&hellip;
          </p>
        </div>
      </div>
    );
  }

  /* ── Error ──
     In demo mode we continue rendering with mock data instead of
     showing the full error screen — so the UI is always visible. */
  if (error && !isDemo && !status) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: SOK.surfaceMuted }}
      >
        <div
          className="p-8 rounded-xl shadow-lg max-w-md"
          style={{
            background: SOK.surface,
            border: `1px solid ${SOK.border}`,
            boxShadow: '0 20px 40px rgba(96,91,229,.08)',
          }}
        >
          <AlertCircle className="w-12 h-12 mx-auto mb-4" style={{ color: SOK.error }} />
          <h2
            className="text-xl font-bold mb-2 text-center"
            style={{ color: SOK.neutral }}
          >
            Connection Error
          </h2>
          <p
            className="mb-4 text-center"
            style={{ color: SOK.textSec, fontSize: '0.875rem' }}
          >
            {error}
          </p>
          <button
            onClick={fetchData}
            className="btn btn-primary w-full"
            style={{ width: '100%' }}
          >
            Retry Connection
          </button>
          {DEMO_MODE && (
            <button
              onClick={() => {
                setDemoVisible(true);
                setHealth(MOCK_HEALTH);
                setStatus(MOCK_STATUS);
                setIsDemo(true);
                setLastUpdate(new Date());
              }}
              className="btn btn-ghost mt-3 w-full"
              style={{ width: '100%' }}
            >
              <Eye className="w-4 h-4 mr-2" />
              Show Demo Dashboard
            </button>
          )}
          <div
            className="mt-4 p-4 rounded-lg"
            style={{
              background: SOK.surfaceRaised,
              border: `1px solid ${SOK.border}`,
              fontSize: '0.8125rem',
            }}
          >
            <p className="font-semibold mb-2" style={{ color: SOK.neutral }}>
              Troubleshooting:
            </p>
            <ul
              className="list-disc list-inside space-y-1"
              style={{ color: SOK.textSec }}
            >
              <li>Verify backend is running on port 3000</li>
              <li>Check REACT_APP_API_URL in .env</li>
              <li>Ensure CORS is configured</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  /* ── Main Dashboard ── */
  return (
    <div className="min-h-screen" style={{ background: SOK.surfaceMuted }}>
      {/* ══════════════════ HEADER ══════════════════ */}
      <header
        style={{
          background: SOK.surface,
          borderBottom: `1px solid ${SOK.border}`,
          boxShadow: '0 1px 2px rgba(96,91,229,.04)',
        }}
      >
        <div
          className="flex items-center justify-between"
          style={{
            maxWidth: '80rem',
            margin: '0 auto',
            padding: '1rem 1.5rem',
          }}
        >
          <div className="flex items-center" style={{ gap: '0.75rem' }}>
            <Bot className="w-8 h-8" style={{ color: SOK.primary }} />

            <div>
              <h1
                className="text-xl font-bold"
                style={{
                  color: SOK.neutral,
                  fontFamily: "'Poppins', 'Segoe UI', sans-serif",
                  letterSpacing: '-0.01em',
                }}
              >
                Sokogate Sales &amp; Funding Agent
              </h1>
              <p
                className="text-sm"
                style={{ color: SOK.textSec, fontSize: '0.8125rem' }}
              >
                AI-Powered Sales Automation Dashboard
              </p>
            </div>
          </div>

          <div className="flex items-center" style={{ gap: '1rem' }}>
            {/* Demo Mode badge */}
            {isDemo && (
              <span
                className="badge"
                style={{
                  backgroundColor: '#FEF3C7',
                  color: '#92400E',
                }}
              >
                Demo Data
              </span>
            )}

            <div className="text-right" style={{ fontSize: '0.75rem', color: SOK.textMuted }}>
              <p>Last Updated</p>
              <p
                className="font-semibold"
                style={{ color: SOK.neutral, fontSize: '0.8125rem' }}
              >
                {lastUpdate.toLocaleTimeString()}
              </p>
            </div>
            <button
              onClick={fetchData}
              disabled={loading}
              className="btn btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}
            >
              <RefreshCw
                className="w-4 h-4"
                style={{
                  animation: loading ? 'sok-spin 1s linear infinite' : 'none',
                }}
              />
              {loading ? 'Refreshing\u2026' : 'Refresh'}
            </button>
          </div>
        </div>
      </header>

      {/* ══════════════════ MAIN ══════════════════ */}
      <main
        style={{
          maxWidth: '80rem',
          margin: '0 auto',
          padding: '2rem 1.5rem',
        }}
      >
        {/* ─── System Health ─── */}
        <section className="mb-8">
          <h2
            className="section-title"
            style={{
              fontFamily: "'Poppins', 'Segoe UI', sans-serif",
              color: SOK.neutral,
            }}
          >
            System Health
          </h2>
          <div
            className="card"
            style={{ padding: '1.5rem' }}
          >
            {/* Overall status row */}
            <div
              className="flex items-center justify-between mb-6"
              style={{ borderBottom: `1px solid ${SOK.border}` }}
            >
              <div className="flex items-center" style={{ gap: '0.5rem' }}>
                <Activity className="w-5 h-5" style={{ color: SOK.primary }} />
                <span
                  className="text-xl font-semibold"
                  style={{ color: SOK.neutral }}
                >
                  Overall Status
                </span>
              </div>
               {health && <OverallStatusBadge healthy={health.status === 'healthy'} />}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
              {/* Database */}
              <StatCard key="db">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center" style={{ gap: '0.5rem' }}>
                    <Database className="w-5 h-5" style={{ color: SOK.primary }} />
                    <span className="font-medium" style={{ color: SOK.neutral }}>
                      Database
                    </span>
                  </div>
                  {health && statusDot(health.checks.database.healthy)}
                </div>
                {health?.checks.database.error && (
                  <p className="text-xs" style={{ color: SOK.error, marginTop: '0.25rem' }}>
                    {health.checks.database.error}
                  </p>
                )}
                {isDemo && !health?.checks.database.error && (
                  <DemoNotice text="Connected — Demo" />
                )}
              </StatCard>

              {/* Email */}
              <StatCard key="email">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center" style={{ gap: '0.5rem' }}>
                    <Mail className="w-5 h-5" style={{ color: SOK.primary }} />
                    <span className="font-medium" style={{ color: SOK.neutral }}>
                      Email Service
                    </span>
                  </div>
                  {health && statusDot(health.checks.email)}
                </div>
                {isDemo && <DemoNotice text="Active — Demo" />}
              </StatCard>

              {/* NVIDIA AI */}
              <StatCard key="nvidia">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center" style={{ gap: '0.5rem' }}>
                    <Bot className="w-5 h-5" style={{ color: SOK.primary }} />
                    <span className="font-medium" style={{ color: SOK.neutral }}>
                      NVIDIA AI
                    </span>
                  </div>
                  {health && statusDot(health.checks.nvidia)}
                </div>
                {!health?.checks.nvidia && !isDemo && (
                  <p className="text-xs" style={{ color: SOK.textMuted, marginTop: '0.25rem' }}>
                    Add NVIDIA API credits
                  </p>
                )}
                {isDemo && <DemoNotice text="Enabled — Demo" />}
              </StatCard>
            </div>
          </div>
        </section>

        {/* ─── Agent Configuration ─── */}
        {status && (
          <section className="mb-8">
            <h2
              className="section-title"
              style={{
                fontFamily: "'Poppins', 'Segoe UI', sans-serif",
                color: SOK.neutral,
              }}
            >
              Agent Configuration
            </h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '1.5rem',
              }}
            >
              {/* Settings Panel */}
              <div
                className="card"
                style={{ padding: '1.5rem' }}
              >
                <h3
                  className="font-semibold mb-4"
                  style={{ color: SOK.neutral, fontSize: '1rem' }}
                >
                  Settings
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div className="flex items-center justify-between">
                    <span style={{ color: SOK.textSec, fontSize: '0.875rem' }}>Agent Enabled</span>
                    <SettingBadge value={status.enabled ? 'Yes' : 'No'} type={status.enabled ? 'success' : 'muted'} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ color: SOK.textSec, fontSize: '0.875rem' }}>Dry Run Mode</span>
                    <SettingBadge value={status.dryRun ? 'Yes' : 'No'} type={status.dryRun ? 'warning' : 'muted'} />
                  </div>
                </div>
              </div>

              {/* Rate Limits */}
              {status?.rateLimits?.email && (
                <div
                  className="card"
                  style={{ padding: '1.5rem' }}
                >
                  <h3
                    className="font-semibold mb-4"
                    style={{ color: SOK.neutral, fontSize: '1rem' }}
                  >
                    Rate Limits
                    <span
                      style={{
                        fontSize: '0.75rem',
                        color: SOK.textMuted,
                        fontWeight: 400,
                        marginLeft: '0.5rem',
                      }}
                    >
                      (Today)
                    </span>
                  </h3>

                  {/* Email rate bar */}
                  <div className="mb-5">
                    <div className="flex items-center justify-between mb-2">
                      <span style={{ color: SOK.textSec, fontSize: '0.8125rem', fontWeight: 500 }}>Email</span>
                      <span className="text-sm font-semibold" style={{ color: SOK.neutral }}>
                        {status.rateLimits.email.remaining} / {status.rateLimits.email.limit}
                      </span>
                    </div>
                    <ProgressBar remaining={status.rateLimits.email.remaining} limit={status.rateLimits.email.limit} />
                  </div>

                </div>
              )}
            </div>
          </section>
        )}

        {/* ─── Feature Status ─── */}
        {status && (
          <section className="mb-8">
            <h2
              className="section-title"
              style={{
                fontFamily: "'Poppins', 'Segoe UI', sans-serif",
                color: SOK.neutral,
              }}
            >
              Feature Status
            </h2>
            <div
              className="card"
              style={{
                background: SOK.surface,
                border: `1px solid ${SOK.border}`,
                borderRadius: '0.75rem',
                padding: '1.5rem',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '0.75rem',
                }}
              >
                {Object.entries(status.features).map(([feature, enabled]) => (
                  <FeatureRow key={feature} feature={feature} enabled={enabled} />
                ))}
              </div>

              {isDemo && (
                <p
                  className="mt-4 text-xs text-center"
                  style={{ color: SOK.textMuted }}
                >
                  Values shown are demo placeholders — connect your backend to see live data.
                </p>
              )}
            </div>
          </section>
        )}

        {/* ─── Quick Actions ─── */}
        <section>
          <h2
            className="section-title"
            style={{
              fontFamily: "'Poppins', 'Segoe UI', sans-serif",
              color: SOK.neutral,
            }}
          >
            Quick Actions
          </h2>
          <div
            className="card"
            style={{
              background: SOK.surface,
              border: `1px solid ${SOK.border}`,
              borderRadius: '0.75rem',
              padding: '0',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              }}
            >
              {[
                {
                  icon: Mail,
                  label: isDemo ? 'Test Email (Demo)' : 'Send Test Email',
                  desc:  isDemo ? 'Demo mode — actions disabled' : 'Test email service configuration',
                  color: SOK.primary,
                  disabled: isDemo,
                },
                {
                  icon: Activity,
                  label: isDemo ? 'View Logs (Demo)' : 'View Logs',
                  desc:  isDemo ? 'Demo mode — actions disabled' : 'Check recent agent activity',
                  color: '#8B5CF6',
                  disabled: isDemo,
                },
                {
                  icon: Database,
                  label: isDemo ? 'View Contacts (Demo)' : 'View Contacts',
                  desc:  isDemo ? 'Demo mode — actions disabled' : 'Manage prospects and leads',
                  color: '#0EA5E9',
                  disabled: isDemo,
                },
              ].map((action, i) => (
                <button
                  key={i}
                  className="flex items-start p-5"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    borderBottom: i < 2 ? `1px solid ${SOK.border}` : 'none',
                    borderRight: i !== 2 ? `1px solid ${SOK.border}` : 'none',
                    cursor: action.disabled ? 'not-allowed' : 'pointer',
                    textAlign: 'left',
                    transition: 'background 150ms',
                    opacity: action.disabled ? 0.6 : 1,
                  }}
                  onClick={() => !action.disabled && alert(`${action.label} — not yet wired to a page`)}
                  onMouseEnter={e => {
                    if (!action.disabled) {
                      (e.currentTarget as HTMLElement).style.background = SOK.surfaceMuted;
                    }
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                  }}
                >
                  <div style={{ marginRight: '0.75rem' }}>
                    <action.icon
                      className="w-5 h-5"
                      style={{ color: action.color }}
                      strokeWidth={1.75}
                    />
                  </div>
                  <div>
                    <p
                      className="font-semibold"
                      style={{ color: SOK.neutral, fontSize: '0.9375rem' }}
                    >
                      {action.label}
                    </p>
                    <p style={{ color: SOK.textMuted, fontSize: '0.8125rem' }}>
                      {action.desc}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Real-Time Product Sourcing ─── */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h2 className="section-title" style={{ fontFamily: "'Poppins', 'Segoe UI', sans-serif", color: SOK.neutral }}>
              Real-Time Product Sourcing
            </h2>
            <button
              onClick={handleTriggerScrape}
              disabled={isScraping || isDemo}
              className="btn btn-primary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                opacity: isScraping || isDemo ? 0.6 : 1,
                cursor: isScraping || isDemo ? 'not-allowed' : 'pointer',
              }}
            >
              {isScraping
                ? <><Loader2 className="w-4 h-4" style={{ animation: 'sok-spin 1s linear infinite' }} /> Crawling sokogate.com…</>
                : <><Search className="w-4 h-4" /> Scrape Products</>
              }
            </button>
          </div>

          <div className="card" style={{ padding: '1.5rem', background: SOK.surface, border: `1px solid ${SOK.border}`, borderRadius: '0.75rem' }}>

            {/* Scrape status bar */}
            {scrapeStatus && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.625rem 1rem',
                  borderRadius: '0.5rem',
                  marginBottom: '1rem',
                  background:
                    scrapeStatus.phase === 'error'   ? '#FEE2E2' :
                    scrapeStatus.phase === 'complete' ? '#D1FAE5' :
                    SOK.surfaceRaised,
                  border: `1px solid ${
                    scrapeStatus.phase === 'error'   ? SOK.error :
                    scrapeStatus.phase === 'complete' ? SOK.success : SOK.border
                  }40`,
                }}
              >
                {scrapeStatus.phase === 'complete' && <CheckCircle2 className="w-4 h-4" style={{ color: SOK.success, flexShrink: 0 }} />}
                {scrapeStatus.phase === 'error'    && <XCircle  className="w-4 h-4" style={{ color: SOK.error,   flexShrink: 0 }} />}
                {isScraping                          && <Loader2  className="w-4 h-4" style={{ color: SOK.primary, flexShrink: 0, animation: 'sok-spin 1s linear infinite' }} />}
                {scrapeStatus.phase === 'idle'     && <Activity className="w-4 h-4" style={{ color: SOK.textMuted, flexShrink: 0 }} />}
                <span style={{ fontSize: '0.8125rem', color: SOK.textSec, flex: 1 }}>
                  {scrapeStatus.message}
                  {scrapeStatus.productCount > 0 && (
                    <strong style={{ color: SOK.neutral, marginLeft: '0.5rem' }}>
                      ({scrapeStatus.productCount} product{scrapeStatus.productCount !== 1 ? 's' : ''} in store)
                    </strong>
                  )}
                </span>
              </div>
            )}

            {isDemo && !scrapeStatus && (
              <div style={{ marginBottom: '1rem', padding: '0.625rem 1rem', borderRadius: '0.5rem', background: '#FEF3C7', border: '1px solid #FCD34D', fontSize: '0.8125rem', color: '#92400E' }}>
                Demo mode — product scraping is simulated. Connect your backend to scrape live product data from sokogate.com.
              </div>
            )}

            {Array.isArray(products) && products.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: SOK.textMuted }}>
                <Package className="w-10 h-10 mx-auto mb-3" style={{ opacity: 0.3 }} />
                <p style={{ fontSize: '0.9375rem', fontWeight: 500, marginBottom: '0.25rem', color: SOK.neutral }}>
                  No products yet
                </p>
                <p style={{ fontSize: '0.8125rem' }}>
                  Click <strong>Scrape Products</strong> to autonomously crawl sokogate.com and populate this catalogue.
                </p>
              </div>
            ) : (
              Array.isArray(products) ? (
                <>
                  <div style={{ marginBottom: '0.75rem', fontSize: '0.8125rem', color: SOK.textMuted }}>
                    Showing {products.length} product{products.length !== 1 ? 's' : ''}
                    {scrapeStatus?.scrapedAt && (
                      <> — last updated {new Date(scrapeStatus.scrapedAt).toLocaleTimeString()}</>
                    )}
                  </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
                  {products.map((product) => (
                    <div
                      key={product.id}
                      style={{
                        border: `1px solid ${SOK.borderSoft}`,
                        borderRadius: '0.75rem',
                        overflow: 'hidden',
                        transition: 'border-color 200ms, box-shadow 200ms',
                        background: SOK.surface,
                        cursor: 'default',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor   = SOK.primary + '70';
                        e.currentTarget.style.boxShadow     = '0 4px 16px rgba(96,91,229,.10)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor   = SOK.borderSoft;
                        e.currentTarget.style.boxShadow     = 'none';
                      }}
                    >
                      {/* Image area */}
                      <div
                        style={{
                          height: '9rem',
                          background: SOK.surfaceRaised,
                          borderBottom: `1px solid ${SOK.borderSoft}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          overflow: 'hidden',
                        }}
                      >
                        {product.images.length > 0 ? (
                          <img
                            src={product.images[0]}
                            alt={product.name}
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                            }}
                            loading="lazy"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : (
                          <ImageIcon className="w-8 h-8" style={{ color: SOK.borderSoft }} />
                        )}
                      </div>

                      {/* Card body */}
                      <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {/* Category + in-stock badges */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span
                            style={{
                              fontFamily: 'monospace',
                              fontSize: '0.6875rem',
                              textTransform: 'uppercase',
                              letterSpacing: '0.05em',
                              color: SOK.primary,
                              background: SOK.surfaceRaised,
                              padding: '0.125rem 0.5rem',
                              borderRadius: '9999px',
                              border: `1px solid ${SOK.border}`,
                            }}
                          >
                            {product.category}
                          </span>
                          <span
                            style={{
                              fontSize: '0.6875rem',
                              fontWeight: 500,
                              color:   product.inStock ? '#065F46'    : '#991B1B',
                              background: product.inStock ? '#D1FAE5' : '#FEE2E2',
                              padding: '0.125rem 0.5rem',
                              borderRadius: '9999px',
                              border: `1px solid ${product.inStock ? '#A7F3D0' : '#FECACA'}`,
                            }}
                          >
                            {product.inStock ? 'In Stock' : 'Out of Stock'}
                          </span>
                        </div>

                        /* Product name */
                        <p style={{ fontSize: '0.875rem', fontWeight: 600, color: SOK.neutral, lineHeight: 1.4 }}>
                          {product.name}
                        </p>

                        /* Price */
                        {product.price && (
                          <p style={{ fontSize: '1.0625rem', fontWeight: 700, color: SOK.primary }}>
                            KSh {product.price}
                          </p>
                        )}

                        /* Description snippet */
                        <p
                          style={{
                            fontSize: '0.75rem',
                            color: SOK.textMuted,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            lineHeight: 1.5,
                          }}
                        >
                          {product.description}
                        </p>

                        /* Specifications chips */
                        {product.specifications.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.25rem' }}>
                            {product.specifications.slice(0, 3).map((spec) => (
                              <span
                                key={spec.key}
                                style={{
                                  fontSize: '0.6875rem',
                                  color: SOK.textSec,
                                  background: SOK.surfaceMuted,
                                  border: `1px solid ${SOK.borderSoft}`,
                                  padding: '0.125rem 0.375rem',
                                  borderRadius: '0.25rem',
                                }}
                              >
                                {spec.value}
                              </span>
                            ))}
                          </div>
                        )}

                        /* Visit source link */
                        {product.sourceUrl && (
                          <a
                            href={product.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontSize: '0.75rem',
                              color: SOK.primary,
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
                            View on sokogate.com &rarr;
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                </>
              ) : null
            )}
          </div>
        </section>
      </main>

      {/* ══════════════════ FOOTER ══════════════════ */}
      <footer
        style={{
          borderTop: `1px solid ${SOK.border}`,
          padding: '1.5rem',
          textAlign: 'center',
          fontSize: '0.8125rem',
          color: SOK.textMuted,
        }}
      >
        <span>
          &copy; {new Date().getFullYear()}{' '}
          <strong style={{ color: SOK.primary }}>Sokogate</strong> —{' '}
          Ultimo Trading Company Limited
        </span>
        <span style={{ margin: '0 0.5rem', color: SOK.borderSoft }}>|</span>
        <span>AI-Powered B2B E-Commerce</span>
      </footer>
    </div>
  );
}

export default App;

// Made with Bob
