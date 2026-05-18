/**
 * AgentPanel
 *
 * Autonomous agent dashboard section — four buttons trigger the
 * /api/agents/* sub-agent endpoints.
 *
 * Visibility is controlled by the `agentsEnabled` feature flag.
 * Parent passes an `enabled` prop and optionally `className`.
 */

import React, { useState } from 'react';
import { SOK } from '../design-tokens';

interface AgentPanelProps {
  enabled?: boolean;
  className?: string;
}

interface AgentResult {
  success: boolean;
  productsSaved?: number;
  enriched?: boolean;
  pagesCrawled?: number;
  assets?:   Array<{ product: string; type: string }>;
  type?:     string;
  title?:    string;
  body?:     string;
  keywords?: string[];
  pitchSummary?: string;
  contactsLinked?: number;
  prospects?: any[];
  error?:    string;
  message?:  string;
}

const BUTTONS = [
  {
    label: 'Bulk Product Sourcing',
    endpoint: '/api/agents/bulk-sourcing',
    payload:  { pages: 3, enrichWithAI: true },
    labelKey: 'Bulk Sourcing',
    color:    '#4338CA',
  },
  {
    label: 'Generate Marketing Campaign',
    endpoint: '/api/agents/sales-marketing',
    payload:  { productIds: ['sample_id'], targetChannel: 'all' },
    labelKey: 'Marketing',
    color:    '#065F46',
  },
  {
    label: 'Create Blog Content',
    endpoint: '/api/agents/content-creation',
    payload:  { type: 'blog' as const, keywords: ['B2B e-commerce'] },
    labelKey: 'Content',
    color:    '#92400E',
  },
  {
    label: 'Generate Funding Pitch',
    endpoint: '/api/agents/funding',
    payload:  { investorProfile: 'vc', companyDetails: { name: 'Ultimo Trading', sector: 'B2B e-commerce', region: 'East & West Africa' } },
    labelKey: 'Funding',
    color:    '#7C3AED',
  },
];

export default function AgentPanel({ enabled = true, className }: AgentPanelProps) {
  const [result,     setResult]     = useState<string>('');
  const [agentLabel, setAgentLabel] = useState('');
  const [loading,    setLoading]    = useState(false);

  if (!enabled) return null;

  const runAgent = async (endpoint: string, payload: Record<string, any>, label: string) => {
    setAgentLabel(label);
    setLoading(true);
    setResult('');
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data: AgentResult = await res.json();
      setResult(JSON.stringify(data, null, 2));
    } catch (e: any) {
      setResult(`Error: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className={className} style={{ marginTop: '2rem' }}>
      <h2
        className="section-title"
        style={{ fontFamily: "'Poppins','Segoe UI',sans-serif", color: SOK.neutral }}
      >
        Autonomous Agents
      </h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '1rem',
        }}
      >
        {BUTTONS.map((btn) => (
          <AgentButton
            key={btn.labelKey}
            label={btn.label}
            bg={btn.color}
            loading={loading && agentLabel === btn.labelKey}
            onClick={() => runAgent(btn.endpoint, btn.payload, btn.labelKey)}
          />
        ))}
      </div>
      {result && (
        <div
          style={{
            marginTop: '1rem',
            background: SOK.surfaceMuted,
            padding: '1rem',
            borderRadius: '0.5rem',
            maxHeight: '16rem',
            overflow: 'auto',
          }}
        >
          <pre
            style={{
              margin: 0,
              fontSize: '0.8125rem',
              color: SOK.textSec,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {result}
          </pre>
        </div>
      )}
    </section>
  );
}

interface AgentButtonProps {
  label:    string;
  bg:       string;
  loading:  boolean;
  onClick:  () => void;
}

function AgentButton({ label, bg, loading, onClick }: AgentButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        width:       '100%',
        padding:     '1rem 1.25rem',
        borderRadius: '0.75rem',
        border:      'none',
        cursor:      loading ? 'wait' : 'pointer',
        background:  loading ? SOK.borderSoft : bg,
        color:       loading ? SOK.textMuted : '#FFFFFF',
        fontSize:    '0.875rem',
        fontWeight:  600,
        textAlign:   'left',
        transition:  'background-color 200ms, opacity 200ms',
        opacity:     loading ? 0.65 : 1,
      }}
    >
      {loading ? 'Running…' : label}
    </button>
  );
}

// Made with Bob
