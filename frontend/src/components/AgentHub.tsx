'use client';
import { useState, useCallback } from 'react';
import { Zap, BarChart3, PenTool, Briefcase } from 'lucide-react';
import BulkSourcingModal from './agents/BulkSourcingModal';
import MarketingModal from './agents/MarketingModal';
import ContentModal from './agents/ContentModal';
import FundingModal from './agents/FundingModal';
import AgentResultPanel from './agents/AgentResultPanel';
import { agentConfig } from '@/agent.config';

const agentDefs = [
  { key: 'bulk-sourcing', label: 'Bulk Sourcing', icon: Zap },
  { key: 'sales-marketing', label: 'Marketing', icon: BarChart3 },
  { key: 'content-creation', label: 'Content', icon: PenTool },
  { key: 'funding', label: 'Funding Pitch', icon: Briefcase },
];

interface AgentRun {
  key: string;
  result: any;
}

interface StreamingState {
  phase: string;
  progress: number;
  message: string;
}

interface Props {
  onProductsUpdated?: () => void;
}

export default function AgentHub({ onProductsUpdated }: Props) {
  const agentsEnabled = !agentConfig || agentConfig.features.agentsEnabled !== false;
  const [modalOpen, setModalOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<AgentRun | null>(null);
  const [streaming, setStreaming] = useState<StreamingState | null>(null);

  const handleRun = useCallback(
    async (key: string, payload: any) => {
      if (!agentsEnabled) return;
      setModalOpen(null);
      setLoading(key);
      setLastRun(null);
      setStreaming({ phase: 'starting', progress: 0, message: 'Initializing...' });

      try {
        // Map agent keys to loop endpoints
        const loopMap: Record<string, string> = {
          'bulk-sourcing': 'bulk-sourcing',
          'sales-marketing': 'sales-marketing',
          'content-creation': 'content-creation',
          'funding': 'funding-pitch',
        };
        const loopName = loopMap[key] ?? key;
        const endpoint = `/api/agents/loops/${loopName}`;

        // Simple POST request - wait for full response
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload || {}),
        });

        if (!response.ok) {
          throw new Error(`HTTP error ${response.status}`);
        }

        const data = await response.json();
        const result = data.result || data;

        // Update streaming state based on result steps
        if (result.steps) {
          const stepKeys = Object.keys(result.steps);
          const currentStep = stepKeys[stepKeys.length - 1] || 'complete';
          setStreaming({
            phase: currentStep,
            progress: 100,
            message: 'Complete',
          });
        }

        setLastRun({ key, result: { success: result.success, ...result } });
        setStreaming(null);
        setLoading(null);

        if (key === 'bulk-sourcing' && result.success && onProductsUpdated) {
          onProductsUpdated();
        }
      } catch (e: any) {
        setStreaming(null);
        setLoading(null);
        setLastRun({ key, result: { error: e.message } });
      }
    },
    [agentsEnabled, onProductsUpdated]
  );

  const openModal = (key: string) => {
    if (agentsEnabled) setModalOpen(key);
  };
  const closeModal = () => setModalOpen(null);
  const closeResult = () => setLastRun(null);
  const retryRun = () => {
    if (lastRun) {
      openModal(lastRun.key);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-800 mb-4">Autonomous Agents</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {agentDefs.map((agent) => (
          <button
            key={agent.key}
            onClick={() => openModal(agent.key)}
            disabled={!agentsEnabled || loading === agent.key}
            className={`p-4 rounded-xl border transition-all text-left ${
              loading === agent.key
                ? 'border-indigo-400 bg-indigo-50 shadow-inner'
                : 'border-gray-100 hover:border-indigo-200 hover:shadow-md bg-gray-50'
            } ${!agentsEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <agent.icon className="w-5 h-5 text-indigo-500 mb-2" />
            <p className="font-medium text-sm text-gray-700">{agent.label}</p>
            {loading === agent.key && (
              <div className="mt-2 flex items-center gap-1 text-xs text-indigo-500">
                {streaming ? (
                  <span>{streaming.message} ({Math.round(streaming.progress)}%)</span>
                ) : (
                  <span className="animate-pulse">Running...</span>
                )}
              </div>
            )}
            {loading === agent.key && streaming && (
              <div className="mt-2 w-full bg-gray-200 rounded-full h-1.5">
                <div
                  className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(streaming.progress, 100)}%` }}
                />
              </div>
            )}
          </button>
        ))}
      </div>

      {lastRun && (
        <AgentResultPanel agentKey={lastRun.key} result={lastRun.result} onClose={closeResult} onRetry={retryRun} />
      )}

      <BulkSourcingModal
        open={modalOpen === 'bulk-sourcing'}
        onClose={closeModal}
        onRun={(payload) => handleRun('bulk-sourcing', payload)}
      />
      <MarketingModal
        open={modalOpen === 'sales-marketing'}
        onClose={closeModal}
        onRun={(payload) => handleRun('sales-marketing', payload)}
      />
      <ContentModal
        open={modalOpen === 'content-creation'}
        onClose={closeModal}
        onRun={(payload) => handleRun('content-creation', payload)}
      />
      <FundingModal
        open={modalOpen === 'funding'}
        onClose={closeModal}
        onRun={(payload) => handleRun('funding', payload)}
      />
    </div>
  );
}
