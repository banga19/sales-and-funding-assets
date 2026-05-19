import React, { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { toast } from 'react-hot-toast';
import { Loader2, Zap, Database, Megaphone, FileText, Target } from 'lucide-react';

// ── UI key → canonical backend key mapping ────────────────────────────────────
const UI_TO_BACKEND: Record<string, string> = {
  autonomousAgents: 'agentsEnabled',
  bulkSourcing:     'productSourcing',
  marketing:        'salesOutreach',
  content:          'salesOutreach',
  fundingPitch:     'fundingOutreach',
};

function toBackendKey(uiKey: string): string {
  return UI_TO_BACKEND[uiKey] ?? uiKey;
}

interface Features {
  autonomousAgents: boolean;
  bulkSourcing: boolean;
  marketing: boolean;
  content: boolean;
  fundingPitch: boolean;
}

interface ApiResult {
  success: boolean;
  features?: Record<string, boolean>;
  feature?: string;
  enabled?: boolean;
  error?: string;
}

const FEATURE_META: Record<keyof Features, { label: string; icon: React.ElementType; description: string }> = {
  autonomousAgents: {
    label: 'Autonomous Agents',
    icon: Zap,
    description: 'Master switch for all autonomous agent activity',
  },
  bulkSourcing: {
    label: 'Bulk Sourcing',
    icon: Database,
    description: 'Crawl sokogate.com, extract & enrich product data at scale',
  },
  marketing: {
    label: 'Marketing',
    icon: Megaphone,
    description: 'Generate email sequences, social posts, and ad campaigns',
  },
  content: {
    label: 'Content',
    icon: FileText,
    description: 'Create blog articles, product guides, and company profiles',
  },
  fundingPitch: {
    label: 'Funding Pitch',
    icon: Target,
    description: 'Research investors and generate tailored pitch / outreach emails',
  },
};

export default function AgentControlPanel() {
  const [features, setFeatures] = useState<Features>({
    autonomousAgents: false,
    bulkSourcing: false,
    marketing: false,
    content: false,
    fundingPitch: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<Record<string, boolean>>({});

  const fetchFeatures = async () => {
    try {
      setLoading(true);
      setError(null);
      const flags = await apiClient.getFeatureFlags();
      if (flags?.features) {
        setFeatures({
          autonomousAgents: !!(flags.features.agentsEnabled || flags.features.autonomousAgents),
          bulkSourcing:     !!(flags.features.productSourcing || flags.features.bulkSourcing),
          marketing:        !!(flags.features.salesOutreach || flags.features.marketing),
          content:          !!(flags.features.salesOutreach || flags.features.content),
          fundingPitch:     !!(flags.features.fundingOutreach || flags.features.fundingPitch),
        });
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error || err.message || 'Unknown error';
      setError(msg);
      toast.error('Could not load agent feature configuration');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchFeatures(); }, []);

  const handleToggle = async (feature: keyof Features) => {
    // Block sub-feature toggles when the master is off
    if (feature !== 'autonomousAgents' && !features.autonomousAgents) return;

    const newValue = !features[feature];

    // Optimistic update
    setFeatures(prev => ({ ...prev, [feature]: newValue }));
    setToggling(prev => ({ ...prev, [feature]: true }));
    try {
      const backendKey = toBackendKey(feature);
      const result = (await apiClient.toggleFeature(backendKey, newValue)) as { success?: boolean; feature?: string; enabled?: boolean; error?: string };
      if (result?.success) {
        toast.success(`${FEATURE_META[feature].label} ${newValue ? 'enabled' : 'disabled'}`);

        // When master is turned off, server resets all sub-features — sync UI
        if (feature === 'autonomousAgents' && !newValue) {
          setFeatures(prev => ({
            ...prev,
            bulkSourcing: false,
            marketing: false,
            content: false,
            fundingPitch: false,
          }));
        } else if (feature === 'autonomousAgents' && newValue) {
          fetchFeatures();
        }
      } else {
        setFeatures(prev => ({ ...prev, [feature]: !newValue }));
        toast.error(result?.error || 'Update failed');
      }
    } catch (err: any) {
      setFeatures(prev => ({ ...prev, [feature]: !newValue }));
      const msg = err?.response?.data?.error || err.message;
      toast.error(`Failed to update: ${msg}`);
    } finally {
      setToggling(prev => ({ ...prev, [feature]: false }));
    }
  };

  if (error && !features.autonomousAgents) {
    return (
      <div className="bg-red-50 p-4 rounded-xl border border-red-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-red-700">{error}</span>
        </div>
        <button onClick={fetchFeatures} className="underline text-xs text-red-700">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Master Switch Card */}
      <div className={`p-4 rounded-xl border-2 transition-colors ${
        features.autonomousAgents ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-gray-50'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
              features.autonomousAgents ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 text-gray-400'
            }`}>
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-semibold text-gray-900">{FEATURE_META.autonomousAgents.label}</h4>
              <p className="text-xs text-gray-500 mt-0.5">{FEATURE_META.autonomousAgents.description}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleToggle('autonomousAgents')}
            disabled={toggling.autonomousAgents}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
              features.autonomousAgents ? 'bg-blue-600' : 'bg-gray-300'
            } ${toggling.autonomousAgents ? 'opacity-70 cursor-wait' : 'focus:ring-2 focus:ring-blue-400 focus:ring-offset-1 focus:outline-none'}`}
            role="switch"
            aria-checked={features.autonomousAgents}
          >
            {toggling.autonomousAgents ? (
              <Loader2 className="absolute left-1 h-4 w-4 text-white animate-spin" />
            ) : (
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                features.autonomousAgents ? 'translate-x-6' : 'translate-x-1'
              }`} />
            )}
          </button>
        </div>
      </div>

      {/* Sub-feature toggles */}
      <div className="space-y-3">
        {(['bulkSourcing', 'marketing', 'content', 'fundingPitch'] as Array<keyof Features>).map(feature => {
          const meta = FEATURE_META[feature];
          const disabled = !features.autonomousAgents;
          const isOn = features[feature] && features.autonomousAgents;
          const Icon = meta.icon;

          return (
            <div
              key={feature}
              className={`flex items-center justify-between p-3 rounded-lg transition-colors ${
                disabled
                  ? 'bg-gray-50 opacity-60'
                  : isOn
                    ? 'bg-blue-50 border border-blue-100'
                    : 'bg-white border border-gray-200'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <Icon className={`w-5 h-5 flex-shrink-0 ${
                  disabled ? 'text-gray-300' : isOn ? 'text-blue-600' : 'text-gray-400'
                }`} />
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${disabled ? 'text-gray-400' : 'text-gray-900'}`}>
                    {meta.label}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">{meta.description}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleToggle(feature)}
                disabled={disabled || toggling[feature]}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                  isOn ? 'bg-blue-600' : 'bg-gray-300'
                } ${disabled || toggling[feature] ? 'opacity-70 cursor-not-allowed' : 'focus:ring-2 focus:ring-blue-400 focus:ring-offset-1 focus:outline-none'}`}
                role="switch"
                aria-checked={isOn}
              >
                {toggling[feature] ? (
                  <Loader2 className="absolute left-1 h-4 w-4 text-white animate-spin" />
                ) : (
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    isOn ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                )}
              </button>
            </div>
          );
        })}
      </div>

      {!features.autonomousAgents && (
        <p className="text-xs text-center text-gray-400 mt-2">
          All autonomous agents are paused. Turn on the master switch above to enable individual agents.
        </p>
      )}
    </div>
  );
}
