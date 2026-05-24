'use client';
import { useState, useCallback, useRef } from 'react';
import { Zap, BarChart3, PenTool, Briefcase, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import BulkSourcingModal from './agents/BulkSourcingModal';
import MarketingModal from './agents/MarketingModal';
import ContentModal from './agents/ContentModal';
import FundingModal from './agents/FundingModal';
import AgentResultPanel from './agents/AgentResultPanel';
import { agentConfig } from '@/agent.config';

// ── Agent definitions ─────────────────────────────────────────────────────────

const AGENT_DEFS = [
  {
    key:         'bulk-sourcing',
    label:       'Bulk Sourcing',
    description: 'Scrape & AI-enrich catalog',
    icon:        Zap,
    color:       'indigo',
  },
  {
    key:         'sales-marketing',
    label:       'Marketing',
    description: 'Generate email, social & ads',
    icon:        BarChart3,
    color:       'violet',
  },
  {
    key:         'content-creation',
    label:       'Content',
    description: 'RAG blog, guide & profile',
    icon:        PenTool,
    color:       'blue',
  },
  {
    key:         'funding',
    label:       'Funding Pitch',
    description: 'Research investors & pitch',
    icon:        Briefcase,
    color:       'emerald',
  },
] as const;

type AgentKey = typeof AGENT_DEFS[number]['key'];

// ── Phase metadata ────────────────────────────────────────────────────────────

const PHASE_META: Record<string, { label: string; pct: number }> = {
  starting:          { label: 'Initialising…',          pct: 5  },
  scraping:          { label: 'Scraping catalog…',       pct: 20 },
  enriching:         { label: 'AI enrichment…',          pct: 55 },
  retrieving:        { label: 'Retrieving context…',     pct: 20 },
  generating:        { label: 'Generating content…',     pct: 55 },
  generating_images: { label: 'Generating images…',      pct: 70 },
  research:          { label: 'Researching investors…',  pct: 30 },
  synthesis:         { label: 'Synthesising pitch…',     pct: 60 },
  persisting:        { label: 'Saving results…',         pct: 85 },
  complete:          { label: 'Complete',                pct: 100 },
  error:             { label: 'Error',                   pct: 100 },
};

// ── Color helpers ─────────────────────────────────────────────────────────────

const COLOR_CLASSES: Record<string, { ring: string; bg: string; icon: string; bar: string }> = {
  indigo:  { ring: 'ring-indigo-400',  bg: 'bg-indigo-50',  icon: 'text-indigo-500',  bar: 'bg-indigo-500'  },
  violet:  { ring: 'ring-violet-400',  bg: 'bg-violet-50',  icon: 'text-violet-500',  bar: 'bg-violet-500'  },
  blue:    { ring: 'ring-blue-400',    bg: 'bg-blue-50',    icon: 'text-blue-500',    bar: 'bg-blue-500'    },
  emerald: { ring: 'ring-emerald-400', bg: 'bg-emerald-50', icon: 'text-emerald-500', bar: 'bg-emerald-500' },
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface StreamState {
  phase:    string;
  pct:      number;
  message:  string;
}

interface AgentRun {
  key:    AgentKey;
  result: any;
}

interface Props {
  onProductsUpdated?: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AgentHub({ onProductsUpdated }: Props) {
  const agentsEnabled = !agentConfig || agentConfig.features.agentsEnabled !== false;

  const [modalOpen, setModalOpen] = useState<AgentKey | null>(null);
  const [loading,   setLoading]   = useState<AgentKey | null>(null);
  const [stream,    setStream]    = useState<StreamState | null>(null);
  const [lastRun,   setLastRun]   = useState<AgentRun | null>(null);

  // Keep a ref to the latest stream state so the SSE reader closure always
  // sees the current value without stale-closure issues.
  const streamRef = useRef<StreamState | null>(null);

  const updateStream = useCallback((s: StreamState) => {
    streamRef.current = s;
    setStream(s);
  }, []);

  // ── Run handler ─────────────────────────────────────────────────────────────

  const handleRun = useCallback(async (key: AgentKey, payload: any) => {
    if (!agentsEnabled) return;
    setModalOpen(null);
    setLoading(key);
    setLastRun(null);
    updateStream({ phase: 'starting', pct: 5, message: 'Initialising…' });

    const loopMap: Record<AgentKey, string> = {
      'bulk-sourcing':   'bulk-sourcing',
      'sales-marketing': 'sales-marketing',
      'content-creation':'content-creation',
      'funding':         'funding-pitch',
    };

    try {
      const response = await fetch(`/api/agents/loops/${loopMap[key]}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body:    JSON.stringify(payload || {}),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader  = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer    = '';
      let finalData: any = null;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6));

              // Progress event — has a `phase` field
              if (data.phase) {
                const meta = PHASE_META[data.phase] ?? { label: data.phase, pct: 50 };
                updateStream({
                  phase:   data.phase,
                  pct:     meta.pct,
                  message: data.message || meta.label,
                });
              }

              // Complete / error event — has `success` field
              if (data.success !== undefined || data.error) {
                finalData = data;
                updateStream({ phase: data.error ? 'error' : 'complete', pct: 100, message: data.error ? 'Error' : 'Complete' });
              }
            } catch { /* malformed SSE line */ }
          }
        }
      }

      // Fallback: if no SSE complete event arrived, try parsing remaining buffer
      if (!finalData && buffer.trim()) {
        try { finalData = JSON.parse(buffer); } catch { finalData = { success: true }; }
      }

      const result = finalData?.result ?? finalData ?? { success: true };
      setLastRun({ key, result: { success: result.success, ...result } });
      setStream(null);
      setLoading(null);

      if (key === 'bulk-sourcing' && result.success) onProductsUpdated?.();
    } catch (e: any) {
      setLastRun({ key, result: { error: e.message, success: false } });
      setStream(null);
      setLoading(null);
    }
  }, [agentsEnabled, onProductsUpdated, updateStream]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">Autonomous Agents</h2>
          <p className="text-xs text-gray-400 mt-0.5">RAG-powered — retrieves live catalog context before every generation</p>
        </div>
        {!agentsEnabled && (
          <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-full">
            Disabled — enable in Agent Configuration
          </span>
        )}
      </div>

      {/* Agent cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {AGENT_DEFS.map(agent => {
          const isRunning = loading === agent.key;
          const c = COLOR_CLASSES[agent.color];
          const Icon = agent.icon;

          return (
            <button
              key={agent.key}
              onClick={() => agentsEnabled && !loading && setModalOpen(agent.key)}
              disabled={!agentsEnabled || !!loading}
              className={[
                'relative p-4 rounded-xl border text-left transition-all duration-200 focus:outline-none',
                isRunning
                  ? `${c.bg} ring-2 ${c.ring} border-transparent shadow-inner`
                  : loading
                    ? 'border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed'
                    : `border-gray-100 bg-gray-50 hover:${c.bg} hover:border-transparent hover:ring-1 hover:${c.ring} hover:shadow-md cursor-pointer`,
              ].join(' ')}
            >
              {/* Icon + label */}
              <div className="flex items-center gap-2 mb-2">
                {isRunning
                  ? <Loader2 className={`w-5 h-5 ${c.icon} animate-spin`} />
                  : <Icon className={`w-5 h-5 ${c.icon}`} />
                }
                <span className="font-semibold text-sm text-gray-800">{agent.label}</span>
              </div>

              <p className="text-xs text-gray-400 leading-snug mb-3">{agent.description}</p>

              {/* Progress bar + phase label */}
              {isRunning && stream ? (
                <>
                  <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden mb-1.5">
                    <div
                      className={`${c.bar} h-1.5 rounded-full transition-all duration-500 ease-out`}
                      style={{ width: `${stream.pct}%` }}
                    />
                  </div>
                  <p className={`text-xs font-medium ${c.icon} truncate`}>
                    {stream.message} {stream.pct < 100 ? `(${stream.pct}%)` : ''}
                  </p>
                </>
              ) : (
                <div className="flex items-center gap-1">
                  {lastRun?.key === agent.key && !loading && (
                    lastRun.result?.error
                      ? <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                      : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  )}
                  <span className="text-xs text-gray-400">
                    {lastRun?.key === agent.key && !loading
                      ? lastRun.result?.error ? 'Failed — click to retry' : 'Done — click to run again'
                      : 'Click to run'}
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Result panel */}
      {lastRun && !loading && (
        <AgentResultPanel
          agentKey={lastRun.key}
          result={lastRun.result}
          onClose={() => setLastRun(null)}
          onRetry={() => setModalOpen(lastRun.key)}
        />
      )}

      {/* Modals */}
      <BulkSourcingModal
        open={modalOpen === 'bulk-sourcing'}
        onClose={() => setModalOpen(null)}
        onRun={p => handleRun('bulk-sourcing', p)}
      />
      <MarketingModal
        open={modalOpen === 'sales-marketing'}
        onClose={() => setModalOpen(null)}
        onRun={p => handleRun('sales-marketing', p)}
      />
      <ContentModal
        open={modalOpen === 'content-creation'}
        onClose={() => setModalOpen(null)}
        onRun={p => handleRun('content-creation', p)}
      />
      <FundingModal
        open={modalOpen === 'funding'}
        onClose={() => setModalOpen(null)}
        onRun={p => handleRun('funding', p)}
      />
    </div>
  );
}
