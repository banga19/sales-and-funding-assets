/**
 * OutreachPanel (overhauled, self-contained)
 *
 * Tabbed interface (Contacts / Email Logs) using a single lazy require()
 * for the OutreachContext. Contacts are auto-loaded on first mount;
 * email logs are fetched lazily on tab switch.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Mail, Loader2, Send, RefreshCw, Inbox, Eye, X } from 'lucide-react';
import { SOK } from '@/design-tokens';

type Tab = 'contacts' | 'logs';

/** Lazy-bridge: import OutreachContext only after this file is parsed */
function useOutreachBridge(): any {
  let ctx: any;
  try {
    ctx = require('@/context/OutreachContext').useOutreach();
  } catch { ctx = { contacts: [], emailLogs: [], sendingIds: new Set(), loading: false, logsLoading: false, error: null, loadContacts: () => {}, loadEmailLogs: () => {}, sendOutreach: async () => ({ ok: false, message: '' }), clearMessage: () => {} }; }
  return ctx;
}

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

function ContactRow({ contact, sending, onSend }: { contact: any; sending: boolean; onSend: (id: string) => void }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 transition-colors">
      <div>
        <p className="font-medium text-sm text-gray-800">{contact.name}</p>
        <p className="text-xs text-gray-400">{contact.email}{contact.company ? ` · ${contact.company}` : ''}</p>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full capitalize">{contact.type || contact.stage}</span>
        <button
          onClick={() => { void onSend(contact.id); }}
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
  const contactsContactsLoaded = useRef(false);

  const ctx = useOutreachBridge();
  const {
    contacts:        rawContacts,
    emailLogs:       rawLogs,
    sendingIds,
    loading,
    logsLoading,
    logsError,
    error,
    lastMessage,
    loadContacts,
    loadEmailLogs,
    sendOutreach,
    clearMessage,
  } = ctx;

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

  const handleSend = useCallback(async (id: string) => {
    await sendOutreach(id);
  }, [sendOutreach]);

  const contactList = contacts;
  const logList      = logs;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-800 mb-4">Automated Outreach</h2>

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg mb-6 w-fit">
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
            <div className="text-center py-8 text-gray-400 text-sm">
              <Inbox className="w-8 h-8 mx-auto mb-3 opacity-30" />
              No contacts yet. They will appear once added to the database.
              <button onClick={() => { void loadContacts(); }} style={{ marginTop: '1rem', display: 'inline-flex', alignItems: 'center', gap: '0.375rem', padding: '0.375rem 1rem', borderRadius: '0.375rem', border: `1px solid ${SOK.border}`, background: SOK.surfaceRaised, fontSize: '0.8125rem', color: SOK.primary, cursor: 'pointer' }}>
                <RefreshCw className="w-3 h-3" /> Retry
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              {contactList.map((c: any) => (
                <ContactRow
                  key={c.id}
                  contact={c}
                  sending={sendingIds.has?.(c.id) ?? false}
                  onSend={handleSend}
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
          <div className="text-center py-8 text-gray-400 text-sm">
            <Mail className="w-8 h-8 mx-auto mb-3 opacity-30" />
            No email logs yet. Sent emails will appear here.
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
