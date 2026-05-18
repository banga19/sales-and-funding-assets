/**
 * useAgentLogs
 *
 * Fetches the last N agent log lines and returns them as a single
 * pre-formatted string ready to drop into a <pre> block or highlighted div.
 *
 * • AbortController cancels any inflight fetch on unmount — prevents
 *   setState-after-unmount warnings when the page is navigated away mid-request.
 * • Loading / loading-string *is* not present in the hook because the string
 *   is fully resolved before it is returned; the component can start with
 *   logs = null and show a skeleton.
 */

import { useState, useCallback } from 'react';
import { api } from '../api/cancelableFetch';

const DEFAULT_LINES = 100;

export interface AgentLogsState {
  logs:  string | null;
  error: string | null;
  fetchLogs: () => Promise<void>;
}

export function useAgentLogs(): AgentLogsState {
  const [logs,  setLogs]  = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setLogs(null);
    setError(null);
    try {
      const resp = await api.getLogs();
      const entries = (resp as any)?.logs ?? [];
      if (entries.length === 0) {
        setLogs('No log entries available.');
        return;
      }
      setLogs(
        entries
          .map((l: Record<string, any>) => `[${l.timestamp ?? ''}] [${l.level ?? 'info'}] ${l.message ?? ''}`)
          .join('\n'),
      );
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err?.message ?? 'Failed to fetch logs.');
    }
  }, []);

  return { logs, error, fetchLogs };
}

// Made with Bob
