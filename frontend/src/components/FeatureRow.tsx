/**
 * FeatureRow
 *
 * Memoised feature toggle row.
 *
 * Render optimisation:
 *  • Wrapped in React.memo — only re-renders when the `enabled` prop changes.
 *    Hover / pressed state is fully local to this component and never reaches the parent.
 *  • Supports optional onToggle callback — call it on click for live toggle.
 */

import React from 'react';
import { SOK } from '../design-tokens';

interface FeatureRowProps {
  feature:   string;
  enabled:   boolean;
  loading?:  boolean;
  onToggle?: (nextState: boolean) => void;
}

const rowBase: React.CSSProperties = {
  padding:      '0.75rem 1rem',
  borderRadius: '0.5rem',
  border:       `1px solid ${SOK.borderSoft}`,
  background:   SOK.surfaceRaised,
  transition:   'border-color 200ms, background-color 200ms, opacity 200ms',
  cursor:       'pointer',
  display:      'flex',
  alignItems:   'center',
  justifyContent: 'space-between',
  userSelect:   'none',
};

const badgeStyle: React.CSSProperties = {
  fontSize: '0.6875rem',
};

export const FeatureRow = React.memo(function FeatureRow({
  feature, enabled, loading = false, onToggle,
}: FeatureRowProps) {
  const [pressed, setPressed] = React.useState(false);

  const rowStyle: React.CSSProperties = {
    ...rowBase,
    opacity:   loading ? 0.55 : 1,
    cursor:    onToggle ? 'pointer' : 'default',
    borderColor: pressed ? `${SOK.primary}80` : hoveredBorder(
      onToggle ? `${SOK.primary}60` : SOK.borderSoft, pressed,
    ),
    background: pressed ? 'rgba(96,91,229,0.04)' : SOK.surfaceRaised,
  };

  function hoveredBorder(normal: string, override: boolean): string {
    return override ? normal : SOK.borderSoft;
  }

  const [hovered, setHovered] = React.useState(false);

  function handleClick(): void {
    if (loading || !onToggle) return;
    setPressed(true);
    onToggle(!enabled);
    setTimeout(() => setPressed(false), 300);
  }

  const badgeColor: React.CSSProperties = {
    ...badgeStyle,
    backgroundColor: enabled ? '#D1FAE5' : '#F3F4F6',
    color:           enabled ? '#065F46' : '#6B7280',
    transition:      'background-color 200ms',
  };

  return (
    <div
      style={{
        ...rowStyle,
        borderColor: hovered && onToggle
          ? `${SOK.primary}60`
          : pressed ? `${SOK.primary}80` : SOK.borderSoft,
        background: pressed
          ? 'rgba(96,91,229,0.04)'
          : hovered && onToggle
            ? `${SOK.surfaceRaised}dd`
            : SOK.surfaceRaised,
      }}
      onClick={handleClick}
      onMouseEnter={() => onToggle && setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false); }}
      role={onToggle ? 'switch' : undefined}
      aria-checked={enabled}
      tabIndex={onToggle ? 0 : -1}
      onKeyDown={e => { if (onToggle && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); handleClick(); } }}
    >
      <span
        style={{
          color:         SOK.textSec,
          fontSize:      '0.8125rem',
          fontWeight:    500,
          textTransform: 'capitalize',
        }}
        title={feature}
      >
        {feature.replace(/([A-Z])/g, ' $1').trim()}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        {loading && (
          <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" style={{ color: SOK.primary }}>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        )}
        <span className="badge" style={badgeColor}>
          {enabled ? 'On' : 'Off'}
        </span>
      </div>
    </div>
  );
});
