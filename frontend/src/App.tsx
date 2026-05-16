import React, { useState, useEffect } from 'react';
import { Activity, Database, Mail, MessageSquare, Bot, AlertCircle, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { apiClient } from './api/client';
import { HealthCheck, AgentStatus } from './types';
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

function App() {
  const [health, setHealth] = useState<HealthCheck | null>(null);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [healthData, statusData] = await Promise.all([
        apiClient.getHealth(),
        apiClient.getStatus(),
      ]);
      setHealth(healthData);
      setStatus(statusData);
      setLastUpdate(new Date());
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to fetch data');
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  /* ── Helpers ── */

  const statusDot = (healthy?: boolean) => (
    <span
      className="status-dot"
      style={{
        backgroundColor: healthy ? SOK.success : SOK.error,
        boxShadow: healthy
          ? '0 0 0 2px rgba(16,185,129,.2)'
          : '0 0 0 2px rgba(220,38,38,.2)',
      }}
    />
  );

  const statusBadge = (healthy: boolean) => (
    <span
      className="badge"
      style={{
        backgroundColor: healthy ? '#D1FAE5' : '#FEE2E2',
        color: healthy ? '#065F46' : '#991B1B',
      }}
    >
      {healthy ? 'Healthy' : 'Unhealthy'}
    </span>
  );

  const progressPct = (remaining?: number, limit?: number) =>
    limit ? Math.round(((remaining ?? 0) / limit) * 100) : 0;

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

  /* ── Error ── */
  if (error && !health) {
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
            {/* Bot icon — Sokogate Indigo */}
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
              {loading ? 'Refreshing…' : 'Refresh'}
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
              {health && statusBadge(health.status === 'healthy')}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
              {/* Database */}
              <div
                className="stat-card"
                style={{
                  background: SOK.surface,
                  border: `1px solid ${SOK.border}`,
                  borderRadius: '0.75rem',
                  padding: '1.25rem',
                  transition: 'border-color 200ms, box-shadow 200ms',
                  cursor: 'default',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = SOK.primary;
                  (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 14px rgba(96,91,229,.1)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = SOK.border;
                  (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                }}
              >
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
              </div>

              {/* Email */}
              <div
                className="stat-card"
                style={{
                  background: SOK.surface,
                  border: `1px solid ${SOK.border}`,
                  borderRadius: '0.75rem',
                  padding: '1.25rem',
                  transition: 'border-color 200ms, box-shadow 200ms',
                  cursor: 'default',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = SOK.primary;
                  (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 14px rgba(96,91,229,.1)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = SOK.border;
                  (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center" style={{ gap: '0.5rem' }}>
                    <Mail className="w-5 h-5" style={{ color: SOK.primary }} />
                    <span className="font-medium" style={{ color: SOK.neutral }}>
                      Email Service
                    </span>
                  </div>
                  {health && statusDot(health.checks.email)}
                </div>
              </div>

              {/* WhatsApp */}
              <div
                className="stat-card"
                style={{
                  background: SOK.surface,
                  border: `1px solid ${SOK.border}`,
                  borderRadius: '0.75rem',
                  padding: '1.25rem',
                  transition: 'border-color 200ms, box-shadow 200ms',
                  cursor: 'default',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = SOK.primary;
                  (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 14px rgba(96,91,229,.1)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = SOK.border;
                  (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center" style={{ gap: '0.5rem' }}>
                    <MessageSquare className="w-5 h-5" style={{ color: SOK.primary }} />
                    <span className="font-medium" style={{ color: SOK.neutral }}>
                      WhatsApp
                    </span>
                  </div>
                  {health && statusDot(health.checks.whatsapp)}
                </div>
                {!health?.checks.whatsapp && (
                  <p className="text-xs" style={{ color: SOK.textMuted, marginTop: '0.25rem' }}>
                    Configure credentials in .env
                  </p>
                )}
              </div>

              {/* Claude AI */}
              <div
                className="stat-card"
                style={{
                  background: SOK.surface,
                  border: `1px solid ${SOK.border}`,
                  borderRadius: '0.75rem',
                  padding: '1.25rem',
                  transition: 'border-color 200ms, box-shadow 200ms',
                  cursor: 'default',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = SOK.primary;
                  (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 14px rgba(96,91,229,.1)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = SOK.border;
                  (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center" style={{ gap: '0.5rem' }}>
                    <Bot className="w-5 h-5" style={{ color: SOK.primary }} />
                    <span className="font-medium" style={{ color: SOK.neutral }}>
                      Claude AI
                    </span>
                  </div>
                  {health && statusDot(health.checks.claude)}
                </div>
                {!health?.checks.claude && (
                  <p className="text-xs" style={{ color: SOK.textMuted, marginTop: '0.25rem' }}>
                    Add API credits
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ─── Agent Status ─── */}
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
                    <span
                      className="badge"
                      style={{
                        backgroundColor: status.enabled ? '#D1FAE5' : SOK.surfaceRaised,
                        color: status.enabled ? '#065F46' : SOK.textMuted,
                      }}
                    >
                      {status.enabled ? 'Yes' : 'No'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ color: SOK.textSec, fontSize: '0.875rem' }}>Dry Run Mode</span>
                    <span
                      className="badge"
                      style={{
                        backgroundColor: status.dryRun ? '#FEF3C7' : SOK.surfaceRaised,
                        color: status.dryRun ? '#92400E' : SOK.textMuted,
                      }}
                    >
                      {status.dryRun ? 'Yes' : 'No'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Rate Limits */}
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
                {status.rateLimits.email && (
                  <div className="mb-5">
                    <div className="flex items-center justify-between mb-2">
                      <span style={{ color: SOK.textSec, fontSize: '0.8125rem', fontWeight: 500 }}>
                        Email
                      </span>
                      <span
                        className="text-sm font-semibold"
                        style={{ color: SOK.neutral }}
                      >
                        {status.rateLimits.email.remaining}/{status.rateLimits.email.limit}
                      </span>
                    </div>
                    {/* Track */}
                    <div
                      style={{
                        width: '100%',
                        height: '0.5rem',
                        background: SOK.borderSoft,
                        borderRadius: '9999px',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${progressPct(status.rateLimits.email.remaining, status.rateLimits.email.limit)}%`,
                          height: '100%',
                          background: `linear-gradient(90deg, ${SOK.primary}, ${SOK.primaryB})`,
                          borderRadius: '9999px',
                          transition: 'width 400ms ease',
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* WhatsApp rate bar */}
                {status.rateLimits.whatsapp && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span style={{ color: SOK.textSec, fontSize: '0.8125rem', fontWeight: 500 }}>
                        WhatsApp
                      </span>
                      <span
                        className="text-sm font-semibold"
                        style={{ color: SOK.neutral }}
                      >
                        {status.rateLimits.whatsapp.remaining}/{status.rateLimits.whatsapp.limit}
                      </span>
                    </div>
                    <div
                      style={{
                        width: '100%',
                        height: '0.5rem',
                        background: SOK.borderSoft,
                        borderRadius: '9999px',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${progressPct(status.rateLimits.whatsapp.remaining, status.rateLimits.whatsapp.limit)}%`,
                          height: '100%',
                          background: `linear-gradient(90deg, ${SOK.primary}, ${SOK.primaryB})`,
                          borderRadius: '9999px',
                          transition: 'width 400ms ease',
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
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
                  <div
                    key={feature}
                    className="flex items-center justify-between"
                    style={{
                      padding: '0.75rem 1rem',
                      borderRadius: '0.5rem',
                      border: `1px solid ${SOK.borderSoft}`,
                      background: SOK.surfaceRaised,
                      transition: 'border-color 200ms',
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLElement).style.borderColor = SOK.primary + '60';
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLElement).style.borderColor = SOK.borderSoft;
                    }}
                  >
                    <span
                      style={{
                        color: SOK.textSec,
                        fontSize: '0.8125rem',
                        fontWeight: 500,
                        textTransform: 'capitalize',
                      }}
                    >
                      {feature.replace(/([A-Z])/g, ' $1').trim()}
                    </span>
                    <span
                      className="badge"
                      style={{
                        backgroundColor: enabled ? '#D1FAE5' : '#F3F4F6',
                        color: enabled ? '#065F46' : '#6B7280',
                        fontSize: '0.6875rem',
                      }}
                    >
                      {enabled ? 'On' : 'Off'}
                    </span>
                  </div>
                ))}
              </div>
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
                  label: 'Send Test Email',
                  desc: 'Test email service configuration',
                  color: SOK.primary,
                },
                {
                  icon: Activity,
                  label: 'View Logs',
                  desc: 'Check recent agent activity',
                  color: '#8B5CF6',
                },
                {
                  icon: Database,
                  label: 'View Contacts',
                  desc: 'Manage prospects and leads',
                  color: '#0EA5E9',
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
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 150ms',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.background = SOK.surfaceMuted;
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
