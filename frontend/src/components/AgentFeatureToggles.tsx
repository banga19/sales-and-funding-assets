/**
 * AgentFeatureToggles
 *
 * Dedicated feature toggle panel for the four Autonomous Agent sub-features:
 *   Autonomous Agents (master)
 *   Bulk Sourcing
 *   Marketing
 *   Content
 *   Funding Pitch
   *
   * Backend:
   *  GET  /api/agent/features  → agent.routes.getFeatureFlags  (DB-backed)
   *  PUT  /api/agent/features/:key  → agent.routes.setFeatureFlag  (persists { value: bool })
   *
   * Client:
   *  apiClient.toggleFeature sends { value: boolean } — matches the backend's
   *  `const { value }` destructure in agent.routes.ts.
   *
   * Behaviour:
 *  • Fetches initial states from GET /agent/features on mount.
 *  • Sends PUT /agent/features/:name with { value: boolean } on every toggle.
 *  • Optimistic UI update — reverts on any server error.
 *  • Per-toggle spinner while the request is in flight.
 *  • Confirms and reverts on failure — never leaves the UI in a half-flipped state.
 *  • Accesses react-hot-toast for success/error toast messages (already on the page).
 *  • Fully a11y: role="switch", aria-checked, keyboard-aware.
 */

import React, { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { toast } from 'react-hot-toast';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

// ── Shared canonical key map (single source of truth) ─────────────────────────
const UI_TO_BACKEND: Record<string, string> = {
  autonomousAgents: 'agentsEnabled',
  bulkSourcing:     'productSourcing',
  marketing:        'salesOutreach',
  content:          'salesOutreach',
  fundingPitch:     'fundingOutreach',
};
const BACKEND_TO_UI: Record<string, string> = Object.fromEntries(
  Object.entries(UI_TO_BACKEND).map(([k, v]) => [v, k]),
);

function toBackendKey(uiKey: string): string { return UI_TO_BACKEND[uiKey] ?? uiKey; }
function toUiKey(bKey: string): string    { return BACKEND_TO_UI[bKey] ?? bKey; }

interface Features {
  autonomousAgents: boolean;
  bulkSourcing: boolean;
  marketing: boolean;
  content: boolean;
  fundingPitch: boolean;
}

const FEATURE_LABELS: Record<keyof Features, string> = {
  autonomousAgents: 'Autonomous Agents',
  bulkSourcing:     'Bulk Sourcing',
  marketing:        'Marketing',
  content:          'Content',
  fundingPitch:     'Funding Pitch',
};

const FEATURE_DESCRIPTIONS: Record<keyof Features, string> = {
  autonomousAgents: 'Master switch for all autonomous agent activity',
  bulkSourcing:     'Crawl sokogate.com, extract & enrich product data at scale',
  marketing:        'Generate email sequences, social posts, and ad campaigns',
  content:          'Create blog articles, product guides, and company profiles',
  fundingPitch:     'Research investors and generate tailored pitch / outreach emails',
};

function mapBackendToUi(raw: Record<string, any>): Features {
  const ui: Record<string, boolean> = {};
  for (const [bKey, v] of Object.entries(raw)) {
    if (v === undefined || v === null) continue;
    const uiKey = toUiKey(bKey) ?? bKey;
    (ui as any)[uiKey] = !!v;
  }
  return {
    autonomousAgents: ui.autonomousAgents ?? false,
    bulkSourcing:     ui.bulkSourcing     ?? false,
    marketing:        ui.marketing        ?? false,
    content:          ui.content          ?? false,
    fundingPitch:     ui.fundingPitch     ?? false,
  };
}

export default function AgentFeatureToggles() {
  const [features, setFeatures] = useState<Features>({
    autonomousAgents: false,
    bulkSourcing:     false,
    marketing:        false,
    content:          false,
    fundingPitch:     false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<Record<string, boolean>>({});

  // ── Fetch all feature states from the backend on mount ────────────────────
  useEffect(() => {
    let cancelled = false;
    const fetchFeatures = async () => {
      try {
        setLoading(true);
        setError(null);
        const featureFlags = await apiClient.getFeatureFlags();
        if (!cancelled && featureFlags?.features) {
          setFeatures(mapBackendToUi(featureFlags.features));
        }
      } catch (err: any) {
        if (!cancelled) {
          const msg = err.response?.data?.error || err.message || 'Unknown error';
          setError(msg);
          toast.error('Could not load agent feature configuration');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchFeatures();
    return () => { cancelled = true; };
  }, []);

  // ── Optimistic update helper ──────────────────────────────────────────────
  const handleToggle = async (feature: keyof Features) => {
    const newValue = !features[feature];
    // Optimistic: flip immediately
    setFeatures(prev => ({ ...prev, [feature]: newValue }));
    setToggling(prev => ({ ...prev, [feature]: true }));

    try {
      // Translate UI key → backend key (autonomousAgents → agentsEnabled, etc.)
      const backendKey = toBackendKey(feature);
      const result = await apiClient.toggleFeature(backendKey, newValue);
      toast.success(`${FEATURE_LABELS[feature]} ${newValue ? 'enabled' : 'disabled'}`);
    } catch (err: any) {
      // Network / HTTP error — revert to previous state
      setFeatures(prev => ({ ...prev, [feature]: !newValue }));
      const msg = err.response?.data?.error || err.message || 'Network error';
      toast.error(`Failed to update ${FEATURE_LABELS[feature]}: ${msg}`);
    } finally {
      setToggling(prev => ({ ...prev, [feature]: false }));
    }
  };

  // ── States ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        className="flex flex-col items-center justify-center py-10 gap-3"
        role="status"
        aria-label="Loading agent features"
      >
        <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
        <span className="text-sm text-gray-400">Loading agent features…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-between bg-red-50 p-4 rounded-xl border border-red-200">
        <div className="flex items-center gap-2">
          <XCircle className="w-5 h-5 text-red-500 shrink-0" />
          <span className="text-sm text-red-700">{error}</span>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="text-xs font-semibold text-red-700 underline whitespace-nowrap ml-3 hover:no-underline"
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Rendered toggle list ──────────────────────────────────────────────────
  return (
    <div
      className="space-y-4"
      role="group"
      aria-label="Autonomous agent feature toggles"
    >
      {(Object.keys(features) as (keyof Features)[]).map(feature => {
        const isOn     = features[feature];
        const spinning = !!toggling[feature];
        const label    = FEATURE_LABELS[feature];
        const desc     = FEATURE_DESCRIPTIONS[feature];

        return (
          <div
            key={feature}
            className={`
              flex items-start justify-between gap-4 p-4 rounded-xl border transition-all duration-200
              ${isOn
                ? 'bg-indigo-50/60 border-indigo-200'
                : 'bg-gray-50/60 border-gray-200 hover:border-gray-300'
              }
            `}
          >
            {/* Text side */}
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <div className="mt-0.5 shrink-0">
                {isOn
                  ? <CheckCircle2 className="w-4 h-4 text-indigo-500" />
                  : <XCircle className="w-4 h-4 text-gray-300" />
                }
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className="text-sm font-semibold truncate"
                  style={{ color: isOn ? '#4338CA' : '#6B7280' }}
                >
                  {label}
                </p>
                <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
                  {desc}
                </p>
              </div>
            </div>

            {/* Toggle switch */}
            <button
              type="button"
              onClick={() => handleToggle(feature)}
              disabled={spinning}
              className={`
                relative inline-flex h-6 w-11 shrink-0 items-center rounded-full
                transition-colors duration-200 focus:outline-none focus:ring-2
                focus:ring-indigo-400 focus:ring-offset-1
                ${spinning ? 'opacity-60 cursor-wait' : 'cursor-pointer'}
                ${isOn ? 'bg-indigo-600' : 'bg-gray-300'}
              `}
              role="switch"
              aria-checked={isOn}
              aria-label={`Toggle ${label}`}
              title={`${isOn ? 'Disable' : 'Enable'} ${label}`}
            >
              {spinning ? (
                <Loader2 className="absolute left-1 h-4 w-4 text-white animate-spin" />
              ) : (
                <span
                  className={`
                    inline-block h-4 w-4 transform rounded-full
                    bg-white shadow-sm transition-transform duration-200
                    ${isOn ? 'translate-x-6' : 'translate-x-1'}
                  `}
                  aria-hidden="true"
                />
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
