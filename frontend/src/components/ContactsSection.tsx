/**
 * ContactsSection
 *
 * Displays the contacts/prospects panel beneath the Quick Actions card.
 * Receives its data as props — no internal fetching logic.
 *
 * Performance notes for the contacts view:
 *  • On the backend, add /api/contacts/pipeline/stats to return only
 *    per-stage counts and the total count — useful for the empty-state badge
 *    without pulling every record or moving to a true paginated API.
 *  • When contacts exceeds 50–100 records consider server-side pagination for
 *    the full list and infinite-scroll; the grid is virtualised only on the
 *    client dom today which compounds layout cost with volume.
 */

import React from 'react';
import { Loader2, Users, X, UserPlus } from 'lucide-react';
import { SOK } from '../design-tokens';
import type { Contact } from '../types';

interface ContactsSectionProps {
  open:      boolean;
  contacts:  Contact[] | null;
  loading:   boolean;
  error:     string | null;
  onClose:   () => void;
}

const contactCard: React.CSSProperties = {
  border:       `1px solid ${SOK.borderSoft}`,
  borderRadius: '0.5rem',
  padding:      '1rem',
  transition:   'border-color 200ms',
};

export const ContactsSection = React.memo(function ContactsSection({
  open, contacts, loading, error, onClose,
}: ContactsSectionProps) {
  if (!open) return null;

  return (
    <section className="mb-8">
      <div className="card" style={{ padding: '1.5rem', position: 'relative' }}>
        {/* ── Header row ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h2
            className="section-title"
            style={{ fontFamily: "'Poppins', 'Segoe UI', sans-serif", color: SOK.neutral, marginBottom: 0 }}
          >
            <Users className="w-5 h-5" style={{ marginRight: '0.5rem', color: '#0EA5E9', display: 'inline' }} />
            View Contacts
          </h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem' }}
            aria-label="Close contacts panel"
          >
            <X className="w-5 h-5" style={{ color: SOK.textMuted }} />
          </button>
        </div>

        {/* ── Loading ── */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <Loader2 className="w-8 h-8 mx-auto animate-spin" style={{ color: SOK.primary }} />
            <p style={{ color: SOK.textMuted, fontSize: '0.875rem', marginTop: '0.5rem' }}>
              Loading contacts&hellip;
            </p>
          </div>
        )}

        {/* ── Error ── */}
        {error && !loading && (
          <p style={{ color: SOK.error, fontSize: '0.875rem' }}>{error}</p>
        )}

        {/* ── Contacts grid ── */}
        {!loading && !error && contacts && contacts.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.75rem' }}>
            {contacts.map((contact: Contact) => (
              <ContactCard key={contact.id} contact={contact} />
            ))}
          </div>
        )}

        {/* ── Empty state ── */}
        {!loading && !error && (!contacts || contacts.length === 0) && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '3rem 1.5rem',
            background: '#FAFAFF', borderRadius: '0.75rem',
            border: '1px dashed #E5E5FF',
          }}>
            <UserPlus className="w-12 h-12 mb-3" style={{ color: '#888899', opacity: 0.5 }} />
            <p style={{ fontWeight: 500, color: '#070707', fontSize: '0.9375rem', marginBottom: '0.25rem' }}>No contacts yet</p>
            <p style={{ fontSize: '0.8125rem', color: '#888899', marginBottom: '1.25rem', textAlign: 'center', maxWidth: '20rem' }}>
              Contacts will appear here once added to the database via CSV import or manual entry.
            </p>
            <button
              onClick={onClose}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
                padding: '0.5rem 1.25rem', borderRadius: '0.5rem',
                border: 'none', cursor: 'pointer',
                background: '#605BE5', color: '#fff',
                fontSize: '0.8125rem', fontWeight: 500,
              }}
            >
              <UserPlus className="w-4 h-4" /> Import Contacts
            </button>
          </div>
        )}
      </div>
    </section>
  );
});

/* ── Stateless, trimmed-down contact card (memoised) ── */

const stageBadgeStyles: Record<string, { bg: string; color: string }> = {
  qualified: { bg: '#D1FAE5', color: '#065F46' },
  converted: { bg: '#D1FAE5', color: '#065F46' },
};

interface ContactCardProps {
  contact: Contact;
}

function ContactCard({ contact }: ContactCardProps) {
  const s = stageBadgeStyles[contact.stage] ?? { bg: SOK.surfaceRaised, color: SOK.textMuted };

  return (
    <div
      style={{
        ...contactCard,
        cursor: 'default',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = `${SOK.primary}70`; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = SOK.borderSoft; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <span style={{ fontWeight: 600, color: SOK.neutral, fontSize: '0.9375rem' }}>
          {contact.name}
        </span>
        <span
          style={{
            fontSize:      '0.6875rem',
            fontWeight:    500,
            padding:       '0.125rem 0.5rem',
            borderRadius:  '9999px',
            background:    s.bg,
            color:         s.color,
          }}
        >
          {contact.stage}
        </span>
      </div>
      <p style={{ fontSize: '0.8125rem', color: SOK.textSec, marginBottom: '0.25rem' }}>
        {contact.email}
      </p>
      {contact.company && (
        <p style={{ fontSize: '0.8125rem', color: SOK.textMuted }}>{contact.company}</p>
      )}
    </div>
  );
}
// Made with Bob
