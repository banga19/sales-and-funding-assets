/**
 * useQuickActions
 *
 * Encapsulates the three quick-action handlers from the
 * "Quick Actions" card:
 *   1. Send Test Email  →  POST /agent/email/test
 *   2. View Logs        →  GET /agent/logs
 *   3. View Contacts    →  delegates to useContacts (toggle/close)
 *
 * Loading/error state is tracked per-action via a single string key
 * ('testEmail' | 'logs' | 'contacts' | null). This is the
 * "loading-action" state-machine pattern from the original App.tsx,
 * preserved and cleaned up here.
 */

import { useState, useCallback } from 'react';
import type { Contact } from '../types';

export type LoadingAction = 'testEmail' | 'logs' | 'contacts' | null;

export interface QuickActionsState {
  loadingAction:  LoadingAction;
  emailResult:    string | null;
  logs:           string | null;
  logsError:      string | null;
  fetchLogs:      () => Promise<void>;
  sendTestEmail:  () => Promise<void>;
  openContacts:   () => void;
  resetEmail:     () => void;
}

export function useQuickActions(
  contactsOpen:    boolean,
  toggleContacts:  () => void,
): QuickActionsState {
  const [loadingAction, setLoadingAction] = useState<LoadingAction>(null);
  const [emailResult,   setEmailResult]   = useState<string | null>(null);
  const [logs,          setLogs]          = useState<string | null>(null);
  const [logsError,     setLogsError]     = useState<string | null>(null);

  /* ── Send Test Email ─────────────────────────────────────────── */
  const sendTestEmail = useCallback(async () => {
    setEmailResult(null);
    setLoadingAction('testEmail');
    try {
      const resp: any = await (await import('../api/client')).apiClient.triggerTestEmail();
      setEmailResult(`Mode: ${resp?.mode ?? 'live'} | ${resp?.message}`);
    } catch (err: any) {
      setEmailResult('Error: ' + (err?.response?.data?.error ?? err?.message));
    } finally {
      setLoadingAction(null);
    }
  }, []);

  const resetEmail = useCallback(() => setEmailResult(null), []);

  /* ── View Logs ───────────────────────────────────────────────── */
  const fetchLogs = useCallback(async () => {
    setLogs(null);
    setLogsError(null);
    setLoadingAction('logs');
    try {
      const resp: any = await (await import('../api/client')).apiClient.getLogs(100);
      const entries = resp?.logs ?? [];
      if (entries.length === 0) {
        setLogs('No log entries available.');
      } else {
        setLogs(
          entries
            .map((l: Record<string, any>) => `[${l.timestamp}] [${l.level}] ${l.message}`)
            .join('\n'),
        );
      }
    } catch (err: any) {
      setLogsError('Error: ' + (err?.response?.data?.error ?? err?.message));
    } finally {
      setLoadingAction(null);
    }
  }, []);

  /* ── Open Contacts panel (lazy-fetch handled by useContacts hook) ── */
  const openContacts = useCallback(() => { toggleContacts(); }, [toggleContacts]);

  return {
    loadingAction,
    emailResult,
    logs,
    logsError,
    fetchLogs,
    sendTestEmail,
    openContacts,
    resetEmail,
  };
}

// Made with Bob
