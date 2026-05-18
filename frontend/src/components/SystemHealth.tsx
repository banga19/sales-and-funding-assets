/**
 * SystemHealth
 *
 * Shows a 3-cell status grid (Database · Email · NVIDIA AI) with coloured
 * dots and a single-press refresh button. Uses the agent proxy endpoint
 * GET /api/health which already exists in `agent/src/index.ts`.
 */

'use client';
import { useEffect, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';

interface Health {
  database: boolean;
  email: boolean;
  nvidiaAI: boolean;
  overall: boolean;
  timestamp: string;
}

export default function SystemHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchHealth = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      // Normalise keys: API returns `checks.database.healthy`, plan expects booleans
      const checks = data.checks ?? {};
      setHealth({
        database: !!checks.database?.healthy,
        email:    !!checks.email,
        nvidiaAI: !!checks.nvidia,
        overall:  data.status === 'healthy',
        timestamp: data.timestamp ?? new Date().toISOString(),
      });
    } catch {
      setHealth(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchHealth(); }, []);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-indigo-500" />
          <h2 className="text-lg font-semibold text-gray-800">System Health</h2>
        </div>
        <button
          onClick={fetchHealth}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          aria-label="Refresh health"
        >
          <RefreshCw className={`w-4 h-4 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="animate-pulse bg-gray-200 h-12 rounded-xl" />
          ))}
        </div>
      ) : health ? (
        <div className="grid grid-cols-3 gap-4">
          <StatusBadge label="Database" status={health.database} />
          <StatusBadge label="Email" status={health.email} />
          <StatusBadge label="NVIDIA AI" status={health.nvidiaAI} />
        </div>
      ) : (
        <p className="text-red-500 text-sm">Unable to fetch health data.</p>
      )}
    </div>
  );
}

function StatusBadge({ label, status }: { label: string; status: boolean }) {
  return (
    <div className="flex flex-col items-center p-3 bg-gray-50 rounded-xl">
      <span className={`w-2.5 h-2.5 rounded-full mb-1.5 transition-colors ${status ? 'bg-emerald-400' : 'bg-red-400'}`} />
      <span className="text-xs font-medium text-gray-600">{label}</span>
    </div>
  );
}
