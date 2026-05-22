/**
 * OutreachPanel — optimised
 *
 * Automated Outreach uses three tabs:
 *   Contacts    — filtered contact list with Quick-Send per row
 *   Email Logs  — sent/failed email history with refreshed status
 *   Batch Send  — tracker-file → preview → send-all pipeline
 *
 * Improvements over previous version:
 *  · Filter bar now wraps the pill count rows and uses the brand accent for the active filter.
 *  · ContactRow types contact details into structured rows (name | role | meta)
 *    instead of the inline "email · company" string.
 *  · Type badge uses the new compact style aligned to the contact detail rather than oversized icon.
 *  · Email Logs uses multi-field rows — subject, recipient slice, date + time, status — so
 *    a row is scannable at a glance without mental parsing.
 *  · Status/Toast / Empty states unified across both tabs.
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  Mail, Loader2, Send, RefreshCw, Inbox, Eye, X,
  ChevronDown, Check, Layers, Search, AlertTriangle,
  CheckCircle, XCircle, Clock,
} from 'lucide-react';
import { SOK } from '@/design-tokens';
import { useOutreach } from '@/context/OutreachContext';
import { useEmailPanel } from '@/context/EmailPanelContext';
import BatchSendPanel from './BatchSendPanel';

/* ── Types ──────────────────────────────────────────────────────────────────── */

type Tab = 'contacts' | 'logs' | 'batch';
type ContactType = 'prospect' | 'investor' | 'partner' | 'funding';

interface Contact {
  id: string;
  type: ContactType;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  title?: string;
  stage: string;
  lastContactDate?: string;
  nextFollowupDate?: string;
  notes?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

interface EmailLog {
  id: string;
  subject: string;
  to: string;
  sentAt: string;
  status: string;
  previewUrl?: string;
  metadata?: Record<string, any>;
}

/* ── Brand tokens for category badges ──────────────────────────────────────── */

const TYPE_STYLE: Record<ContactType, { bg: string; text: string }> = {
  prospect: { bg: '#DBEAFE', text: '#1D4ED8' },
  investor: { bg: '#FEF3C7', text: '#92400E' },
  partner:  { bg: '#D1FAE5', text: '#065F46' },
  funding:  { bg: '#EDE9FE', text: '#4C1D95' },
};

type VerdictKey = 'send' | 'soft-quarantine' | 'nhod' | 'block' | 'no-email';
const VERDICT_STYLE: Record<VerdictKey, { bg: string; text: string }> = {
  send:           { bg: '#D1FAE5', text: '#065F46' },
  'soft-quarantine': { bg: '#FEF3C7', text: '#92400E' },
  nhod:           { bg: '#FEE2E2', text: '#991B1B' },
  block:          { bg: '#E5E7EB', text: '#374151' },
  'no-email':     { bg: '#F3F4F6', text: '#6B7280' },
};

/* ── Shared helpers ─────────────────────────────────────────────────────────── */

function statusPillStatus(status: string) {
  const s = status.toLowerCase();
  if (s === 'sent' || s === 'delivered' || s === 'read') return 'ok';
  return 'err';
}

/* ═══════════════════════════════════════════════════════════════════════════════
   TAB BUTTON — pill-shaped with optional badge
   ═══════════════════════════════════════════════════════════════════════════════ */

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: string | number;
}

function TabButton({ active, onClick, icon, label, badge }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`
        relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
        transition-all duration-150 select-none
        ${active
          ? 'bg-white text-sok-neutral shadow-sm'
          : 'text-sok-text-muted hover:text-sok-neutral'
        }
      `}
      aria-selected={active}
      role="tab"
      type="button"
    >
      {icon}
      <span>{label}</span>
      {badge != null && (
        <span
          className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full text-[0.625rem] font-bold"
          style={{
            background: active ? SOK.primary : 'rgba(96,91,229,0.10)',
            color: active ? '#fff' : SOK.primary,
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   SPLIT SEND BUTTON — two-button compound control (primary left · dropdown right)
   ═══════════════════════════════════════════════════════════════════════════════ */

function SplitSendButton({
  sending,
  sentCount,
  onQuickSend,
  onCompose,
}: {
  sending: boolean;
  sentCount?: number | null;
  onQuickSend: () => void;
  onCompose: () => void;
}) {
  const [open, setOpen]   = useState(false);
  const wrapperRef        = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Collapse dropdown while sending
  useEffect(() => { if (sending) setOpen(false); }, [sending]);

  return (
    <div ref={wrapperRef} className="send-split relative inline-flex" style={{ display: 'inline-flex' }}>
      {/* ── Primary: Quick-Send ──────────────────────────────────── */}
      <button
        onClick={onQuickSend}
        disabled={sending}
        title="Quick-Send (AI-powered)"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-l-lg text-white text-xs font-semibold
                   transition-all duration-150 disabled:opacity-50"
        style={{ background: sending ? SOK.borderSoft : SOK.primary }}
      >
        {sending
          ? <Loader2 className="w-3.5 h-3.5" style={{ animation: 'sok-spin 1s linear infinite' }} />
          : <Send className="w-3.5 h-3.5" />
        }
        {sending ? 'Sending…' : 'Quick Send'}
      </button>

      {/* ── Dropdown toggle ──────────────────────────────────────── */}
      <button
        onClick={() => { if (!sending) setOpen(!open); }}
        disabled={sending}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex items-center justify-center px-2 py-1.5 border-l rounded-r-lg
                   bg-white text-sok-primary text-xs transition-all
                   disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ borderColor: SOK.borderSoft }}
      >
        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* ── Dropdown menu ────────────────────────────────────────── */}
      {open && (
        <ul
          role="listbox"
          className="absolute right-0 top-full mt-1 w-44 rounded-lg border bg-white shadow-lg
                     ring-1 ring-black/5 py-1 text-xs text-gray-700 z-50"
          style={{ borderColor: SOK.borderSoft }}
        >
          {sentCount != null && sentCount > 0 && (
            <li className="px-3 py-1.5 flex items-center gap-1.5 text-gray-400 border-b"
                style={{ borderColor: SOK.borderSoft }}>
              <Check className="w-3 h-3" />
              {sentCount} sent previously
            </li>
          )}
          <li>
            <button
              role="option"
              onClick={() => { setOpen(false); void onCompose(); }}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center gap-2 transition-colors"
            >
              <Mail className="w-3.5 h-3.5" />
              Compose Email
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   FILTER BAR — all-type pills with live counts, separated from tab strip
   ═══════════════════════════════════════════════════════════════════════════════ */

function FilterBar({
  contacts, typeFilter, setTypeFilter, searchQuery, setSearchQuery,
}: {
  contacts: Contact[];
  typeFilter: string;
  setTypeFilter: (v: string) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
}) {
  // Compute per-type counts once
  const counts = useMemo(() => {
    const acc: Record<ContactType, number> = { prospect: 0, investor: 0, partner: 0, funding: 0 };
    for (const c of contacts) {
      const key = c.type || 'prospect';
      acc[key] = (acc[key] || 0) + 1;
    }
    return acc;
  }, [contacts]);

  const totalCount = contacts.length;
  const activeCount = typeFilter === 'all' ? totalCount : (counts[typeFilter as ContactType] || 0);

  const pills: { key: string; label: string }[] = [
    { key: 'all',    label: 'All'       },
    { key: 'prospect', label: 'Prospect'  },
    { key: 'investor', label: 'Investor'  },
    { key: 'partner',  label: 'Partner'   },
    { key: 'funding',  label: 'Funding'   },
  ];

  return (
    <div className="flex flex-col gap-3 py-2">
      {/* ── Search + filter label row ── */}
      <div className="flex items-center gap-3 flex-wrap">
        {!pills.find(p => p.key === typeFilter && p.key !== 'all') && typeFilter === 'all' ? (
          <span className="text-xs font-medium text-sok-text-muted tracking-wide uppercase">Filter contacts</span>
        ) : null}

        {/* Search input */}
        <div className="relative flex-1 min-w-[12rem] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-sok-text-muted pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border transition-colors
                       focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
            style={{
              borderColor: SOK.borderSoft,
              background: 'var(--sok-surface)',
              color: SOK.neutral,
            }}
          />
        </div>

        {/* Count summary (read-only, right-aligned) */}
        <span className="text-xs text-sok-text-muted ml-auto">
          <span className="font-semibold text-sok-neutral">{activeCount}</span>&nbsp;of {totalCount}
        </span>
      </div>

      {/* ── Filter pills ── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {pills.map(({ key, label }) => {
          const n = key === 'all' ? totalCount : (counts[key as ContactType] || 0);
          const isActive = typeFilter === key;
          const isDimmed = n === 0 && key !== 'all';

          return (
            <button
              key={key}
              disabled={isDimmed}
              onClick={() => setTypeFilter(key)}
              className={`
                text-xs font-medium px-2.5 py-1 rounded-full transition-all duration-150
                ${isActive
                  ? 'text-white shadow-sm'
                  : 'text-gray-500 bg-gray-100 hover:bg-gray-200'
                }
                ${isDimmed ? 'opacity-30 cursor-not-allowed' : ''}
              `}
              style={isActive ? { background: SOK.primary } : undefined}
            >
              {label}
              <span
                className="ml-1 opacity-75"
                style={isActive ? { color: '#fff' } : { color: SOK.textMuted }}
              >
                {n}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   CONTACT ROW — three-column layout: identity + category | detail meta | action
   ═══════════════════════════════════════════════════════════════════════════════ */

function ContactRow({
  contact, sending, onCompose, onQuickSend,
}: {
  contact: Contact;
  sending: boolean;
  onCompose: () => void;
  onQuickSend: () => void;
}) {
  const contactType = (contact.type || 'prospect') as ContactType;
  const ts          = TYPE_STYLE[contactType] || TYPE_STYLE.prospect;
  // Email counts injected by backend contact row (not part of the Contact type)
  const sentCount = typeof (contact as any).emails_sent === 'number' ? (contact as any).emails_sent : undefined;

  // Format last-contact date relative to now for quick scanning
  const lastContactLabel = useMemo(() => {
    if (!contact.lastContactDate) return null;
    const d = new Date(contact.lastContactDate);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }, [contact.lastContactDate]);

  return (
    <div
      className="
        grid grid-cols-[1fr_auto] md:grid-cols-[1fr_minmax(10rem,14rem)_auto]
        items-center gap-x-4 gap-y-2 p-3.5
        rounded-xl border border-gray-100 transition-colors
        hover:bg-gray-50 hover:border-indigo-100
      "
    >
      {/* ─ Column 1 — Name + Company ─ */}
      <div className="min-w-0 flex flex-col gap-0.5" style={{ minWidth: 0 }}>
        <span className="text-sm font-semibold text-gray-800 truncate" title={contact.name}>
          {contact.name}
        </span>
        <span className="text-xs text-sok-text-muted flex items-center gap-1.5 truncate">
          <span className="shrink-0 text-gray-300">·</span>
          {contact.company || <em className="italic text-gray-300">No company</em>}
        </span>
      </div>

      {/* ─ Column 2 — Email + meta (hidden on narrow md-xs) ─ */}
      <div className="hidden md:flex flex-col gap-0.5 min-w-0">
        <span className="text-xs text-sok-text-secondary truncate" title={contact.email}>
          {contact.email}
        </span>
        {contact.title && (
          <span className="text-[0.6875rem] text-sok-text-muted flex items-center gap-1 truncate">
            {lastContactLabel && (
              <span className="inline-flex items-center gap-0.5 text-gray-300">
                <Clock className="w-2.5 h-2.5" /> {lastContactLabel}
              </span>
            )}
          </span>
        )}
      </div>

      {/* ─ Column 3 — Category badge + Send action ─ */}
      <div className="flex items-center gap-2 justify-end">
        <span
          className="text-[0.6875rem] font-semibold tracking-wide px-2 py-0.5 rounded-full shrink-0"
          style={{ background: ts.bg, color: ts.text }}
          title={contactType}
        >
          {contactType}
        </span>
        <SplitSendButton
          sending={sending}
          sentCount={sentCount}
          onQuickSend={onQuickSend}
          onCompose={onCompose}
        />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   EMPTY / LOADING / ERROR STATES
   ═══════════════════════════════════════════════════════════════════════════════ */

const cardSizes = [2, 3, 1];

function StatusBanner({ kind, title, detail, onRetry }: {
  kind: 'loading' | 'error' | 'empty'; title: string; detail: string; onRetry?: () => void;
}) {
  const bg   = kind === 'error' ? '#FEF2F2' : kind === 'empty' ? '#FAFAFF' : '#EEF2FF';
  const icon = kind === 'loading' ? Loader2 : kind === 'error' ? AlertTriangle : Inbox;
  const Icon = icon as any; // lucide uses `LucideIcon`, keeps TS happy here
  const orange = kind === 'error' ? '#EF4444' : kind === 'empty' ? '#888899' : SOK.primary;

  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-12 rounded-xl"
      style={{ background: bg }}
    >
      {Icon !== Loader2 ? (
        <Icon className="w-10 h-10 opacity-30" style={{ color: orange }} />
      ) : (
        <Loader2 className="w-10 h-10 animate-spin" style={{ color: orange }} />
      )}
      <p className="text-sm font-medium text-gray-700 text-center">{title}</p>
      <p className="text-xs text-sok-text-muted text-center" style={{ maxWidth: '22rem' }}>{detail}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity"
          style={{ background: '#605BE5', opacity: 0.9 }}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {kind === 'error' ? 'Retry' : 'Reload'}
        </button>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   EMAIL LOG ROW — scannable multi-field row
   ═══════════════════════════════════════════════════════════════════════════════ */

function LogRow({ log }: { log: EmailLog }) {
  const previewUrl = log.metadata?.previewUrl || log.previewUrl;
  const sentDate   = new Date(log.sentAt || 'now').toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
  const sentTime   = new Date(log.sentAt || 'now').toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit',
  });

  const isOk = statusPillStatus(log.status) === 'ok';

  return (
    <div
      className="
        grid grid-cols-[1fr_auto] md:grid-cols-[1fr_14rem_auto]
        items-start gap-x-4 gap-y-1.5 p-3.5
        rounded-xl border border-gray-100 transition-colors
        hover:bg-gray-50 hover:border-indigo-100
      "
    >
      {/* ─ Column 1 — Subject ─ */}
      <div className="min-w-0">
        <span className="text-sm font-medium text-gray-800 block truncate" title={log.subject}>
          {log.subject}
        </span>
        <span className="text-[0.6875rem] text-sok-text-muted block truncate">
          To: {log.to}
        </span>
      </div>

      {/* ─ Column 2 — Date + time (hidden on narrow) ─ */}
      <div className="hidden md:flex items-center gap-3 md:gap-4 shrink-0">
        <span className="text-[0.6875rem] text-sok-text-muted whitespace-nowrap flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {sentDate}
        </span>
        <span className="text-[0.6875rem] text-sok-text-muted whitespace-nowrap">{sentTime}</span>
      </div>

      {/* ─ Column 3 — actions + status ─ */}
      <div className="flex items-center gap-2 justify-end">
        {previewUrl && (
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[0.6875rem] font-medium px-2 py-0.5 rounded-full transition-opacity hover:opacity-80"
            style={{ background: '#DBEAFE', color: '#1D4ED8' }}
          >
            Preview
          </a>
        )}
        {isOk ? (
          <span className="text-[0.6875rem] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">
            ✓ {log.status}
          </span>
        ) : (
          <span className="text-[0.6875rem] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600">
            ✕ {log.status}
          </span>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   TOAST / NOTICE BANNER
   ═══════════════════════════════════════════════════════════════════════════════ */

function NoticeBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const isErr = message.startsWith('Error');
  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg text-xs mb-4"
      style={{
        background: isErr ? '#FEF2F2' : '#ECFDF5',
        borderColor: isErr ? '#FECACA' : '#A7F3D0',
        border: `1px solid ${isErr ? '#FECACA' : '#A7F3D0'}`,
        color: isErr ? '#991B1B' : '#065F46',
      }}
    >
      <span className="font-medium">{message}</span>
      <button
        onClick={onDismiss}
        className="p-0.5 rounded hover:opacity-70 text-[1rem]"
        style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', lineHeight: 1 }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   MAIN PANEL
   ═══════════════════════════════════════════════════════════════════════════════ */

export default function OutreachPanel() {
  const [activeTab,    setActiveTab]    = useState<Tab>('contacts');
  const [emailsFetched, setEmailsFetched] = useState(false);
  const [typeFilter,   setTypeFilter]   = useState<string>('all');
  const [searchQuery,  setSearchQuery]  = useState('');

  const ctx = useOutreach();
  const {
    contacts:  rawContacts,
    emailLogs: rawLogs,
    sendingIds,
    loading, logsLoading,
    contactsError, logsError,
    lastMessage,
    loadContacts, retryContacts,
    loadEmailLogs, refreshEmailLogs,
    clearMessage, sendOutreach,
  } = ctx;
  const { openEmailPanel } = useEmailPanel();

  /* ── Derived data ────────────────────────────────────────────────────────── */

  const contacts = (Array.isArray(rawContacts) ? rawContacts : []) as Contact[];
  const logs     = (Array.isArray(rawLogs)    ? rawLogs     : []) as EmailLog[];

  /* ── Search + filter applied to contact list ───────────────────────────────── */

  const filteredContacts = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return contacts.filter(c => {
      const typeOk = typeFilter === 'all' || (c.type || 'prospect') === typeFilter;
      const textOk = !q
        || c.name.toLowerCase().includes(q)
        || c.email.toLowerCase().includes(q)
        || (c.company || '').toLowerCase().includes(q);
      return typeOk && textOk;
    });
  }, [contacts, typeFilter, searchQuery]);

  /* ── Life-cycle ──────────────────────────────────────────────────────────── */

  useEffect(() => {
    void loadContacts();
  }, [loadContacts]);

  useEffect(() => {
    if (activeTab === 'logs' && !emailsFetched) {
      setEmailsFetched(true);
      void loadEmailLogs();
    }
  }, [activeTab, emailsFetched, loadEmailLogs]);

  /* ── Handlers ────────────────────────────────────────────────────────────── */

  const openComposer = useCallback(
    (contact: Contact) => { void openEmailPanel({ recipients: [contact.email] }); },
    [openEmailPanel],
  );

  const handleQuickSend = useCallback(
    (contact: Contact) => {
      if (!contact.id) return;
      void sendOutreach(contact.id, /* dryRun */ false);
    },
    [sendOutreach],
  );

  // Reset search when switching away from contacts tab
  useEffect(() => {
    if (activeTab !== 'contacts') setSearchQuery('');
  }, [activeTab]);

  /* ── Tab counts for badge ─────────────────────────────────────────────────── */

  const contactCount   = contacts.length;
  const logsCount      = logs.length;
  const batchTrackers  = 0; // BatchSendPanel fetches its own count; placeholder here.

  /* ── Render ──────────────────────────────────────────────────────────────── */

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <h2 className="text-lg font-semibold text-gray-800 mb-5">Automated Outreach</h2>

      {/* ── Tab strip ────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-5 w-fit" role="tablist">
        <TabButton
          active={activeTab === 'contacts'}
          onClick={() => { setActiveTab('contacts'); void loadContacts(); }}
          icon={<Inbox className="w-4 h-4" />}
          label="Contacts"
          badge={contactCount || undefined}
        />
        <TabButton
          active={activeTab === 'logs'}
          onClick={() => setActiveTab('logs')}
          icon={<Eye className="w-4 h-4" />}
          label="Email Logs"
          badge={logsCount || undefined}
        />
        <TabButton
          active={activeTab === 'batch'}
          onClick={() => setActiveTab('batch')}
          icon={<Layers className="w-4 h-4" />}
          label="Batch Send"
        />
      </div>

      {/* ════════════════════════════════════════════════════════════════════════
          CONTACTS TAB
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'contacts' && (
        <div className="flex flex-col gap-4">

          {/* ── Notice banner ── */}
          {lastMessage && (
            <NoticeBanner message={lastMessage} onDismiss={clearMessage} />
          )}

          {/* ── Filter bar ── */}
          <FilterBar
            contacts={contacts}
            typeFilter={typeFilter}
            setTypeFilter={setTypeFilter}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
          />

          {/* ── Loading / Error / Empty / List ── */}
          {loading && filteredContacts.length === 0 && (
            <StatusBanner
              kind="loading"
              title="Loading contacts…"
              detail="Fetching your contact database from the agent server."
            />
          )}

          {contactsError && filteredContacts.length === 0 && (
            <StatusBanner
              kind="error"
              title="Failed to load contacts"
              detail={contactsError}
              onRetry={() => void retryContacts()}
            />
          )}

          {!loading && !contactsError && filteredContacts.length === 0 && contacts.length > 0 && (
            <StatusBanner
              kind="empty"
              title="No matching contacts"
              detail="The current filter or search query returned zero results. Try broadening the filter."
              onRetry={() => { setTypeFilter('all'); setSearchQuery(''); }}
            />
          )}

          {!loading && !contactsError && contacts.length === 0 && (
            <StatusBanner
              kind="empty"
              title="No contacts yet"
              detail="Contacts will appear here once added to the database via CSV import or manual entry."
              onRetry={() => void retryContacts()}
            />
          )}

          {filteredContacts.length > 0 && (
            <div className="space-y-1.5">
              {filteredContacts.map(contact => (
                <ContactRow
                  key={contact.id}
                  contact={contact}
                  sending={sendingIds.has(contact.id)}
                  onCompose={() => openComposer(contact)}
                  onQuickSend={() => { void handleQuickSend(contact); }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          EMAIL LOGS TAB
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'logs' && (
        <div className="flex flex-col gap-4">
          {/* ── Header: title row + refresh button ── */}
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-gray-800">Email Sent History</span>
              <span className="text-xs text-sok-text-muted">
                {logsCount} item{logsCount !== 1 ? 's' : ''} recorded
              </span>
            </div>
            <button
              onClick={() => { void refreshEmailLogs(); }}
              disabled={logsLoading}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-opacity disabled:opacity-50"
              style={{ background: SOK.primary, color: '#fff' }}
            >
              <RefreshCw className="w-3.5 h-3.5" style={logsLoading ? { animation: 'sok-spin 1s linear infinite' } : undefined} />
              Refresh
            </button>
          </div>

          {/* ── Loading / Error / Empty / List ── */}
          {logsLoading && logs.length === 0 && (
            <StatusBanner
              kind="loading"
              title="Loading email logs…"
              detail="Fetching your sent email history from the agent server."
            />
          )}

          {logsError && logs.length === 0 && (
            <StatusBanner
              kind="error"
              title="Failed to load email logs"
              detail={logsError}
              onRetry={() => void refreshEmailLogs()}
            />
          )}

          {!logsLoading && !logsError && logs.length === 0 && (
            <StatusBanner
              kind="empty"
              title="No email logs yet"
              detail="Sent emails will appear here. Send an email from the Contacts tab to see it recorded."
            />
          )}

          {logs.length > 0 && (
            <div className="space-y-1.5">
              {logs.map(log => {
                const previewUrl = log.metadata?.previewUrl || log.previewUrl;
                const sentDate   = new Date(log.sentAt || 'now').toLocaleDateString(undefined, {
                  year: 'numeric', month: 'short', day: 'numeric',
                });
                const sentTime   = new Date(log.sentAt || 'now').toLocaleTimeString(undefined, {
                  hour: '2-digit', minute: '2-digit',
                });
                const isOk       = statusPillStatus(log.status) === 'ok';

                return (
                  <div
                    key={log.id}
                    className="grid grid-cols-[1fr_auto] md:grid-cols-[1fr_14rem_auto]
                               items-start gap-x-4 gap-y-1.5 p-3.5
                               rounded-xl border border-gray-100 transition-colors
                               hover:bg-gray-50 hover:border-indigo-100"
                  >
                    {/* Subject + recipient */}
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-gray-800 block truncate" title={log.subject}>
                        {log.subject}
                      </span>
                      <span className="text-[0.6875rem] text-sok-text-muted block truncate">
                        To: {log.to}
                      </span>
                    </div>

                    {/* Date + time (desktop only) */}
                    <div className="hidden md:flex items-center gap-3 shrink-0">
                      <span className="text-[0.6875rem] text-sok-text-muted flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {sentDate}
                      </span>
                      <span className="text-[0.6875rem] text-sok-text-muted">{sentTime}</span>
                    </div>

                    {/* Preview + status */}
                    <div className="flex items-center gap-2 justify-end">
                      {previewUrl && (
                        <a
                          href={previewUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[0.6875rem] font-medium px-2 py-0.5 rounded-full transition-opacity hover:opacity-75"
                          style={{ background: '#DBEAFE', color: '#1D4ED8' }}
                        >
                          Preview
                        </a>
                      )}
                      {isOk ? (
                        <span className="text-[0.6875rem] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">
                          ✓ {log.status}
                        </span>
                      ) : (
                        <span className="text-[0.6875rem] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600">
                          ✕ {log.status}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          BATCH SEND TAB
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'batch' && (
        <BatchSendPanel />
      )}
    </div>
  );
}
