/**
 * OutreachPanel (overhauled, self-contained)
 *
 * Tabbed interface (Contacts / Email Logs) using a single lazy require()
 * for the OutreachContext. Contacts are auto-loaded on first mount;
 * email logs are fetched lazily on tab switch.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Mail, Loader2, Send, RefreshCw, Inbox, Eye, X, Tag } from 'lucide-react';
import { SOK } from '@/design-tokens';
import { useOutreach } from '@/context/OutreachContext';
import { useEmailPanel } from '@/context/EmailPanelContext';

type Tab = 'contacts' | 'logs';

type ContactType = 'prospect' | 'investor' | 'partner' | 'funding';

/** Category badge colours */
const TYPE_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  prospect:  { bg: '#DBEAFE', text: '#1D4ED8',  label: 'Prospect'  },
  investor:  { bg: '#FEF3C7', text: '#92400E',  label: 'Investor'  },
  partner:   { bg: '#D1FAE5', text: '#065F46',  label: 'Partner'   },
  funding:   { bg: '#EDE9FE', text: '#4C1D95',  label: 'Funding'   },
};

/** Horizontal pill tab */
function TabButton({ active, onClick, icon, label, badge }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; badge?: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all`}
      style={{ background: active ? '#fff' : 'transparent', boxShadow: active ? '0 1px 3px rgba(0,0,0,.08)' : 'none', color: active ? SOK.neutral : SOK.textSec }}
    >
      {icon}
      {label}
      {badge}
    </button>
  );
}

function ContactRow({ contact, sending, onSend }: { contact: any; sending: boolean; onSend: (contact: any) => void }) {
  const ct = (contact.type || contact.stage || 'prospect') as ContactType;
  const ts = TYPE_STYLE[ct] || TYPE_STYLE.prospect;

  return (
    <div className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 transition-colors">
      <div>
        <p className="font-medium text-sm text-gray-800">{contact.name}</p>
        <p className="text-xs text-gray-400">{contact.email}{contact.company ? ` · ${contact.company}` : ''}</p>
      </div>
      <div className="flex items-center gap-2">
        <span
          className="text-xs font-medium px-2 py-0.5 rounded-full capitalize flex items-center gap-1"
          style={{ background: ts.bg, color: ts.text }}
          title={ts.label}
        >
          <Tag className="w-3 h-3" />{ts.label}
        </span>
        <button
          onClick={() => { void onSend(contact); }}
          disabled={sending}
          className="flex items-center gap-1 px-3 py-1.5 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50"
          style={{ background: sending ? SOK.borderSoft : SOK.primary }}
        >
          {sending && <Loader2 className="w-3 h-3" style={{ animation: 'sok-spin 1s linear infinite' }} />}
          {sending ? 'Sending' : 'Send'}
        </button>
      </div>
    </div>
  );
}

export default function OutreachPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('contacts');
  const [emailsFetched, setEmailsFetched] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const contactsContactsLoaded = useRef(false);

  const ctx = useOutreach();
  const {
    contacts:        rawContacts,
    emailLogs:       rawLogs,
    sendingIds,
    loading,
    logsLoading,
    error,
    lastMessage,
    loadContacts,
    loadEmailLogs,
    clearMessage,
  } = ctx;

  const { openEmailPanel } = useEmailPanel();

  const contacts = Array.isArray(rawContacts) ? rawContacts : [];
  const logs     = Array.isArray(rawLogs    ) ? rawLogs     : [];

  // Auto-fetch contacts on mount (single-shot sentinel)
  useEffect(() => {
    if (!contactsContactsLoaded.current) { contactsContactsLoaded.current = true; void loadContacts(); }
  }, []);

  // Fetch email logs on first tab switch
  useEffect(() => {
    if (activeTab === 'logs' && !emailsFetched) {
      setEmailsFetched(true);
      void loadEmailLogs();
    }
  }, [activeTab, emailsFetched, loadEmailLogs]);

  const handleSend = useCallback((contact: { id: string; email?: string; name?: string }) => {
    // Open the email composer instead of silently sending
    void openEmailPanel({ recipients: contact.email ? [contact.email] : undefined });
  }, [openEmailPanel]);

  const contactList = contacts.filter((c: any) =>
    typeFilter === 'all' ? true : (c.type || 'prospect') === typeFilter,
  );
  const logList      = logs;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-800 mb-4">Automated Outreach</h2>

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg mb-4 w-fit">
        <TabButton
          active={activeTab === 'contacts'}
          onClick={() => { setActiveTab('contacts'); void loadContacts(); }}
          icon={<Inbox className="w-4 h-4" />}
          label="Contacts"
        />
        <TabButton
          active={activeTab === 'logs'}
          onClick={() => setActiveTab('logs')}
          icon={<Eye className="w-4 h-4" />}
          label="Email Logs"
        />
      </div>

      {/* Type filter — only on Contacts tab */}
      {activeTab === 'contacts' && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-xs text-gray-400 mr-1">Filter:</span>
          {(['all','prospect','investor','partner','funding'] as const).map((t) => {
            const counts = contacts.reduce((acc: Record<string, number>, c: any) => {
              const key = c.type || 'prospect';
              acc[key] = (acc[key] || 0) + 1;
              return acc;
            }, {});
            const n = t === 'all' ? contacts.length : (counts[t] || 0);
            return (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className="text-xs font-medium px-2.5 py-1 rounded-full transition-all"
                style={{
                  background: typeFilter === t ? SOK.primary : '#F3F4F6',
                  color:      typeFilter === t ? '#fff'     : '#6B7280',
                  cursor: n === 0 && t !== 'all' ? 'not-allowed' : 'pointer',
                  opacity: n === 0 && t !== 'all' ? 0.4 : 1,
                }}
              >
                {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}
                <span className="ml-1 opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Contacts tab */}
      {activeTab === 'contacts' && (
        <>
          {lastMessage && (
            <div style={{ padding: '0.5rem 1rem', borderBottom: `1px solid ${SOK.borderSoft}`, fontSize: '0.8125rem', color: SOK.textSec, display: 'flex', justifyContent: 'space-between' }}>
              <span>{lastMessage}</span>
              <button onClick={clearMessage} style={{ background: 'none', border: 'none', cursor: 'pointer', color: SOK.textMuted }}>✕</button>
            </div>
          )}
          {loading && contactList.length === 0 ? (
            <div className="flex items-center justify-center py-10 text-gray-400">
              <Loader2 className="w-5 h-5 mr-2 animate-spin" style={{ color: SOK.primary }} /> Loading contacts…
            </div>
          ) : contactList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-gray-400 text-sm gap-3">
              <Inbox className="w-10 h-10 opacity-30" />
              <p className="text-center" style={{ color: '#888899' }}>No contacts yet. They will appear once added to the database.</p>
              <button onClick={() => { void loadContacts(); }} style={{
                display: 'inline-flex', alignItems: 'center',
                gap: '0.375rem', padding: '0.5rem 1.25rem',
                borderRadius: '0.5rem', border: 'none', cursor: 'pointer',
                background: '#605BE5', color: '#fff',
                fontSize: '0.8125rem', fontWeight: 500,
              }}>
                <RefreshCw className="w-4 h-4" /> Reload
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              {contactList.map((c: any) => (
                <ContactRow
                  key={c.id}
                  contact={c}
                  sending={sendingIds.has?.(c.id) ?? false}
                  onSend={() => handleSend(c)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Email Logs tab */}
      {activeTab === 'logs' && (
        logsLoading ? (
          <div className="flex items-center justify-center py-10 text-gray-400">
            <Loader2 className="w-5 h-5 mr-2 animate-spin" style={{ color: SOK.primary }} /> Loading email logs…
          </div>
        ) : logList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-gray-400 text-sm gap-3">
            <Mail className="w-10 h-10 opacity-30" />
            <p style={{ color: '#888899' }}>No email logs yet. Sent emails will appear here.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {logList.map((log: any) => (
              <div key={log.id} className="flex items-center justify-between p-3 rounded-xl border border-gray-100">
                <div>
                  <p className="font-medium text-sm text-gray-800">{log.subject}</p>
                  <p className="text-xs text-gray-400">To: {log.to} · {new Date(log.sentAt).toLocaleDateString()}</p>
                </div>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${log.status === 'sent' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                  {log.status}
                </span>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
