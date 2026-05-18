/**
 * OutreachContext
 *
 * Shared state for the Outreach panel:
 *  • list of contacts (with persona, status, and metadata)
 *  • in-flight sending set (per contact id)
 *  • last message string (success / error feedback)
 *  • one-shot load function (guarded by a useRef sentinel)
 */

import { createContext, useContext, useEffect, useState, useRef, useCallback, type ReactNode } from 'react';
import type { EmailLogEntry } from '../services/outreachApi';
import { fetchOutreachContacts, fetchEmailLogs, sendContactOutreach } from '../services/outreachApi';

// ─── State ─────────────────────────────────────────────────────────────────────

interface OutreachState {
  contacts:    any[];
  emailLogs:   EmailLogEntry[];
  sendingIds:  Set<string>;
  loading:     boolean;
  logsLoading: boolean;
  error:       string | null;
  lastMessage: string | null;
}

interface OutreachContextValue extends OutreachState {
  loadContacts:  () => Promise<void>;
  loadEmailLogs: () => Promise<void>;
  sendOutreach:  (contactId: string, dryRun?: boolean) => Promise<{ ok: boolean; message: string }>;
  clearMessage:  () => void;
}

const defaultState: OutreachState = {
  contacts:    [],
  emailLogs:   [],
  sendingIds:  new Set(),
  loading:     false,
  logsLoading: false,
  error:       null,
  lastMessage: null,
};

// ─── Context ──────────────────────────────────────────────────────────────────

const OutreachContext = createContext<OutreachContextValue>({
  ...defaultState,
  loadContacts:  async () => {},
  loadEmailLogs: async () => {},
  sendOutreach:  async () => ({ ok: false, message: 'Not initialised.' }),
  clearMessage:  () => {},
});

// ─── Provider ──────────────────────────────────────────────────────────────────

export function OutreachProvider({ children }: { children: ReactNode }) {
  const [state, setState]   = useState<OutreachState>(defaultState);
  const fetchedRef         = useRef(false); // contacts load guard
  const logsFetched        = useRef(false); // email logs load guard

  const loadContacts = useCallback(async () => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    setState(prev => ({ ...prev, loading: true, error: null }));
    await fetchOutreachContacts((update) => setState(prev => ({ ...prev, ...update })));
  }, []);

  const loadEmailLogs = useCallback(async () => {
    if (logsFetched.current) return;
    logsFetched.current = true;
    setState(prev => ({ ...prev, logsLoading: true }));
    await fetchEmailLogs((update) => setState(prev => ({ ...prev, ...update })));
  }, []);

  const sendOutreach = useCallback(async (contactId: string, dryRun = false) => {
    setState(prev => {
      const next = new Set(prev.sendingIds);
      next.add(contactId);
      return { ...prev, sendingIds: next };
    });

    const { ok, message } = await sendContactOutreach(contactId, dryRun, (update) =>
      setState(prev => ({ ...prev, ...update })),
    );

    setState(prev => {
      const next = new Set(prev.sendingIds);
      next.delete(contactId);
      return { ...prev, sendingIds: next, lastMessage: ok ? message : `Error: ${message}` };
    });

    return { ok, message };
  }, []);

  const clearMessage = useCallback(() => setState(prev => ({ ...prev, lastMessage: null })), []);

  // Auto-load on mount
  useEffect(() => { void loadContacts(); }, [loadContacts]);

  const value: OutreachContextValue = {
    ...state,
    loadContacts,
    loadEmailLogs,
    sendOutreach,
    clearMessage,
  };

  return (
    <OutreachContext.Provider value={value}>
      {children}
    </OutreachContext.Provider>
  );
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

export const useOutreach = () => useContext(OutreachContext);
