/**
 * QuickActionsCard
 *
 * Renders the three quick-action buttons and the expandable result area
 * (Test Email output, Agent Logs output).
 *
 * Design:
 *  • Action buttons are memoised individually — only the active action
 *    re-renders its label row when isLoading flips.
 *  • The result area is split into its own small sub-component (`ActionResult`)
 *    so it is skipped from the action-button render path entirely.
 *  • onClick handlers are referenced via stable ids (not string comparisons).
 *
 * Data fetching note (View Contacts):
 *  • This component depends only on the open/close boolean from useContacts.
 *  • Actual fetching is delegated to useContacts() itself and caches the
 *    result until the user explicitly closes and reopens — avoiding
 *    redundant GET /contacts hits on every re-render.
 */

import React, { useCallback, useMemo } from 'react';
import { Mail, Activity, Database, Loader2 } from 'lucide-react';
import { SOK } from '../design-tokens';
import type { LoadingAction } from '../hooks/useQuickActions';

interface QuickActionsCardProps {
  emailResult:     string | null;
  logs:            string | null;
  logsError:       string | null;
  loadingAction:   LoadingAction;
  onSendTestEmail: () => void;
  onViewLogs:      () => void;
  onOpenContacts:  () => void;
  onResetEmail:    () => void;
}

/* ── Typed action descriptor — eliminates fragile label string matching ── */

type ActionId = 'email' | 'logs' | 'contacts';

interface ActionDef {
  id:        ActionId;
  label:     string;
  desc:      string;
  Icon:      React.FC<{ className?: string; style?: React.CSSProperties }>;
  color:     string;
  handler:   () => void;
}

/* ── Build the action list once (outside render) ── */

function buildActions(props: QuickActionsCardProps): ActionDef[] {
  return [
    {
      id:      'email',
      label:   'Send Test Email',
      desc:    'Test email service configuration',
      Icon:    Mail,
      color:   SOK.primary,
      handler: props.onSendTestEmail,
    },
    {
      id:      'logs',
      label:   'View Logs',
      desc:    'Check recent agent activity',
      Icon:    Activity,
      color:   '#8B5CF6',
      handler: props.onViewLogs,
    },
    {
      id:      'contacts',
      label:   'View Contacts',
      desc:    'Manage prospects and leads',
      Icon:    Database,
      color:   '#0EA5E9',
      handler: props.onOpenContacts,
    },
  ];
}

/* ── Memoised button — only re-renders when its isLoading turns on/off ── */

const ActionButton = React.memo(function ActionButton({
  action,
  isLoading,
}: {
  action:    ActionDef;
  isLoading: boolean;
}) {
  return (
    <button
      key={action.id}
      className="quick-action-btn"
      aria-label={action.label}
      disabled={isLoading}
      onClick={action.handler}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = SOK.surfaceMuted; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      style={{
        background:   'transparent',
        border:       'none',
        borderBottom: '1px solid transparent',
        borderRight:  '1px solid transparent',
        cursor:       isLoading ? 'not-allowed' : 'pointer',
        textAlign:    'left',
        transition:   'background 150ms',
        opacity:      isLoading ? 0.6 : 1,
        display:      'flex',
        alignItems:   'flex-start',
        padding:      '1.25rem',
        width:        '100%',
      }}
    >
      <div style={{ marginRight: '0.75rem', display: 'flex', alignItems: 'center' }}>
        <action.Icon
          className="w-5 h-5"
          style={{ color: action.color, strokeWidth: 1.75 }}
        />
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ color: SOK.neutral, fontSize: '0.9375rem', fontWeight: 600 }}>{action.label}</span>
          {isLoading && (
            <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: action.color }} />
          )}
        </div>
        <p style={{ color: SOK.textMuted, fontSize: '0.8125rem' }}>{action.desc}</p>
      </div>
    </button>
  );
});

/** Maps the loadingAction string to the right ActionId */
const LOADING_ID_MAP: Record<string, ActionId> = {
  testEmail: 'email',
  logs:      'logs',
  contacts:  'contacts',
};

/* ── Main card ── */

export const QuickActionsCard = React.memo(function QuickActionsCard(props: QuickActionsCardProps) {
  const actions: ActionDef[] = useMemo(() => buildActions(props), [
    props.onSendTestEmail,
    props.onViewLogs,
    props.onOpenContacts,
  ]);

  return (
    <section className="mb-8">
      <h2
        className="section-title"
        style={{ fontFamily: "'Poppins', 'Segoe UI', sans-serif", color: SOK.neutral }}
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {actions.map(action => {
            const isLoading = props.loadingAction === LOADING_ID_MAP[action.id];
            return <ActionButton key={action.id} action={action} isLoading={isLoading} />;
          })}
        </div>

        {/* ── Result panels — only rendered when present ── */}
        {props.emailResult && (
          <ActionResult
            label="Test Email:"
            onClose={props.onResetEmail}
            style={{ color: SOK.textSec }}
          >
            {props.emailResult}
          </ActionResult>
        )}
        {props.logsError && (
          <ActionResult
            label="Agent Logs:"
            onClose={props.onResetEmail}
            style={{ color: SOK.error }}
          >
            {props.logsError}
          </ActionResult>
        )}
        {props.logs && (
          <ActionResult
            label="Agent Logs:"
            onClose={props.onResetEmail}
            isPre
          >
            {props.logs}
          </ActionResult>
        )}
      </div>
    </section>
  );
});

/* ── Shared result row ── */

interface ActionResultProps {
  label:    string;
  children: React.ReactNode;
  isPre?:   boolean;
  onClose?: () => void;
  style?:   React.CSSProperties;
}

function ActionResult({ label, children, isPre, onClose }: ActionResultProps) {
  return (
    <div
      style={{
        padding:    '0.75rem 1.25rem',
        borderTop:  `1px solid ${SOK.border}`,
        fontSize:   isPre ? '0.75rem' : '0.8125rem',
        color:      SOK.textSec,
        maxHeight:  isPre ? '12rem' : undefined,
        overflowY:  isPre ? 'auto' : undefined,
        whiteSpace: isPre ? 'pre-wrap' : 'normal',
        fontFamily: isPre ? 'monospace' : undefined,
        display:    'flex',
        alignItems: 'flex-start',
      }}
    >
      <strong style={{ display: 'block', marginBottom: '0.375rem' }}>{label}</strong>
      {onClose && (
        <button
          onClick={onClose}
          aria-label="Dismiss result"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.125rem 0.375rem', marginLeft: 'auto' }}
        >
          ✕
        </button>
      )}
      {children}
    </div>
  );
}
// Made with Bob
