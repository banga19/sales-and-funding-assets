/**
 * OutreachContext
 *
 * Shared state for the Outreach panel:
 *  • list of contacts (with persona, status, and metadata)
 *  • in-flight sending set (per contact id)
 *  • last message string (success / error feedback)
 *
 * All API calls are fully asynchronous with per-request timeouts and
 * retry-with-backoff so the UI is never blocked by a single slow
 * downstream call.
 */

import { createContext, useContext, useEffect, useState, useRef, useCallback, type ReactNode } from 'react';
import type { EmailLogEntry } from '../services/outreachApi';
import { fetchOutreachContacts, fetchEmailLogs, sendContactOutreach } from '../services/outreachApi';
import { apiClient } from '../api/client';
import { retryWithBackoff } from '../utils/asyncHelpers';

// ─── State ─────────────────────────────────────────────────────────────────────

interface OutreachState {
  contacts:        any[];
  emailLogs:       EmailLogEntry[];
  sendingIds:      Set<string>;
  loading:         boolean;
  logsLoading:     boolean;
  contactsError:   string | null;
  logsError:       string | null;
  lastMessage:     string | null;
}

interface OutreachContextValue extends OutreachState {
  loadContacts:     () => Promise<void>;
  retryContacts:    () => Promise<void>;
  loadEmailLogs:    () => Promise<void>;
  refreshEmailLogs: () => Promise<void>;
  sendOutreach:     (contactId: string, dryRun?: boolean) => Promise<{ ok: boolean; message: string }>;
  clearMessage:     () => void;
}

const defaultState: OutreachState = {
  contacts:      [],
  emailLogs:     [],
  sendingIds:    new Set(),
  loading:       false,
  logsLoading:   false,
  contactsError: null,
  logsError:     null,
  lastMessage:   null,
};

// ─── Context ──────────────────────────────────────────────────────────────────

const OutreachContext = createContext<OutreachContextValue>({
  ...defaultState,
  loadContacts:     async () => {},
  retryContacts:    async () => {},
  loadEmailLogs:    async () => {},
  refreshEmailLogs: async () => {},
  sendOutreach:     async () => ({ ok: false, message: 'Not initialised.' }),
  clearMessage:     () => {},
});

// ─── Provider ──────────────────────────────────────────────────────────────────

export function OutreachProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OutreachState>(defaultState);
  /* Two independent refs so `retryContacts` and `loadEmailLogs` can always
     re-fire even after a successful first load. */
  const contactsLoadedRef   = useRef(false);
  const contactsLoadingRef  = useRef(false); // prevents concurrent loadContacts races
  const emailLogsFetchedRef = useRef(false);

  // ── Contacts ────────────────────────────────────────────────────────────────

  const loadContacts = useCallback(async () => {
    if (contactsLoadingRef.current) return;
    contactsLoadingRef.current = true;
    contactsLoadedRef.current = true;
    setState(prev => ({ ...prev, loading: true, contactsError: null }));
    try {
      await retryWithBackoff(
        async () => {
          await fetchOutreachContacts(
            (update) => setState(prev => ({ ...prev, ...update })),
          );
        },
        3,
        (attempt, err) => console.warn(`[Outreach] contacts attempt ${attempt} failed:`, err),
      );
    } catch (err: any) {
      setState(prev => ({
        ...prev,
        loading:       false,
        contactsError: err?.message ?? 'Failed to load contacts.',
      }));
    } finally {
      contactsLoadingRef.current = false;
    }
  }, []);

  /** Explicit retry / refresh — always re-fetches regardless of prior state. */
  const retryContacts = useCallback(async () => {
    if (contactsLoadingRef.current) return;
    contactsLoadingRef.current = true;
    contactsLoadedRef.current = true;
    setState(prev => ({ ...prev, loading: true, contactsError: null }));
    try {
      await retryWithBackoff(
        async () => {
          await fetchOutreachContacts(
            (update) => setState(prev => ({ ...prev, ...update })),
          );
        },
        3,
        (attempt, err) => console.warn(`[Outreach] contacts retry attempt ${attempt} failed:`, err),
      );
    } catch (err: any) {
      setState(prev => ({
        ...prev,
        loading:       false,
        contactsError: err?.message ?? 'Failed to load contacts.',
      }));
    } finally {
      contactsLoadingRef.current = false;
    }
  }, []);

  // ── Email Logs ──────────────────────────────────────────────────────────────

  const loadEmailLogs = useCallback(async () => {
    if (emailLogsFetchedRef.current) return;
    emailLogsFetchedRef.current = true;

    setState(prev => ({ ...prev, logsLoading: true, logsError: null }));

    // Step 1: outreach API with retry + timeout
    try {
      await retryWithBackoff(
        async () => {
          await fetchEmailLogs((update) => setState(prev => ({ ...prev, ...update })));
        },
        3,
        (attempt, err) => console.warn(`[Outreach] email-logs attempt ${attempt} failed:`, err),
      );
    } catch (err: any) {
      // Logs are best-effort — surface the error but don't block DB hydration
      setState(prev => ({
        ...prev,
        logsLoading: false,
        logsError:   err?.message ?? 'Failed to load email logs.',
      }));
    }

    // Step 2 (independent, non-blocking): hydrate from DB-backed agent endpoint
    (async () => {
      try {
        const resp: any    = await apiClient.get('/agents/email-logs?limit=200');
        const dbLogs: any[] = Array.isArray(resp?.data) ? resp.data : [];
        if (dbLogs.length > 0) {
          setState(prev => {
            const seen = new Set(prev.emailLogs.map(l => l.id));
            const unique = dbLogs
              .map((l: any): EmailLogEntry => ({
                id:          l.id,
                contactId:   l.contact_id,
                contactName: '',
                to:          l.to_email,
                subject:     l.subject,
                body:        l.body_preview || '',
                status:      l.status === 'sent' || l.status === 'dry-run' ? l.status : 'failed',
                error:       l.error_message,
                sentAt:      l.sent_at,
              }))
              .filter((l: EmailLogEntry) => !seen.has(l.id));
            return { ...prev, emailLogs: [...prev.emailLogs, ...unique] };
          });
        }
        setState(prev => ({ ...prev, logsLoading: false }));
      } catch {
        // DB email-logs endpoint may not exist yet — silently ignore
        setState(prev => ({ ...prev, logsLoading: false }));
      }
    })();
  }, []);

  /** Re-fetch email logs regardless of fetched sentinel (used by the Refresh button). */
  const refreshEmailLogs = useCallback(async () => {
    emailLogsFetchedRef.current = false;
    setState(prev => ({ ...prev, logsLoading: true, logsError: null }));
    await loadEmailLogs();
  }, [loadEmailLogs]);

  // ── Quick Send ──────────────────────────────────────────────────────────────

  const sendOutreach = useCallback(async (contactId: string, dryRun = false) => {
    // Mark this contact as in-flight
    setState(prev => {
      const next = new Set(prev.sendingIds);
      next.add(contactId);
      return { ...prev, sendingIds: next };
    });

    let ok: boolean;
    let message: string;
    {
      const { ok: rOk, message: rMsg } = await sendContactOutreach(contactId, dryRun, (update) =>
        setState(prev => ({ ...prev, ...update })),
      );
      ok      = rOk;
      message = rMsg;
    }

    setState(prev => {
      const next = new Set(prev.sendingIds);
      next.delete(contactId);
      return { ...prev, sendingIds: next, lastMessage: ok ? message : `Error: ${message}` };
    });

    // Auto-refresh contacts to see updated counts
    contactsLoadingRef.current = false;
    contactsLoadedRef.current   = false;
    loadContacts();

    return { ok, message };
  }, [loadContacts]);

  const clearMessage = useCallback(() => setState(prev => ({ ...prev, lastMessage: null })), []);

  // ── Auto-load on mount ─────────────────────────────────────────────────────

  useEffect(() => { void loadContacts(); }, [loadContacts]);

  const value: OutreachContextValue = {
    ...state,
    loadContacts,
    retryContacts,
    loadEmailLogs,
    refreshEmailLogs,
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
