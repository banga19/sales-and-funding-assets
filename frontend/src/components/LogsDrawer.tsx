import { useEffect, useState, useRef } from 'react';
import { X, Loader2, Activity, WifiOff } from 'lucide-react';

interface LogEntry {
  id: string;
  level: string;
  message: string;
  sentAt: string;
}

/**
 * Compute the WebSocket URL for the agent.
 * Uses the same host as the current window location (for dev) but allows override via env vars.
 * Protocol is derived from window.location.protocol (ws/wss).
 * Port and host can be overridden via VITE_WS_PORT and VITE_WS_HOST.
 */
const getWsUrl = (): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Allow override of host via env, else use window.location.hostname
  const host = import.meta.env.VITE_WS_HOST ?? window.location.hostname;
  const port = import.meta.env.VITE_WS_PORT ?? '3002';
  return `${protocol}//${host}:${port}/ws/agent`;
};

const WS_URL = getWsUrl(); // Note: This is computed at module load time, but uses import.meta.env (available) and window (not available in SSR, but we are in browser).
const MAX_LINES = 200;

export default function LogsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  /* ── Fetch initial snapshot via REST (fallback) ── */
  useEffect(() => {
    if (!open) { setLogs([]); /* ws closed in below effect */ return; }
    setWsError(null);

    // Snapshot from REST
    fetch('/api/logs')
      .then(r => r.json())
      .then((data) => {
        const entries: LogEntry[] = Array.isArray(data) ? data : [];
        setLogs(entries);
      })
      .catch(() => setLogs([]));
  }, [open]);

  /* ── WebSocket streaming ── */
  useEffect(() => {
    if (!open) {
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      setConnected(false);
      return;
    }

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);

      ws.onmessage = (e: MessageEvent) => {
        const msg: LogEntry = {
          id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          level: 'info',
          message: e.data,
          sentAt: new Date().toISOString(),
        };
        setLogs(prev => [...prev.slice(-MAX_LINES + 1), msg]);
      };

      ws.onerror = () => {
        setWsError('WebSocket connection failed. Showing last REST snapshot.');
      };

      ws.onclose = () => { setConnected(false); wsRef.current = null; };
    } catch {
      setWsError('WebSocket unavailable. Showing last REST snapshot.');
    }

    return () => {
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    };
  }, [open]); // Note: WS_URL is computed at module level, so if env vars change, we need to reload. Acceptable for dev.

  if (!open) return null;

  const levelBadge = (lvl: string) => {
    switch (lvl) {
      case 'error': return { cls: 'text-red-600 bg-red-50', label: 'ERR' };
      case 'warn':  return { cls: 'text-amber-600 bg-amber-50', label: 'WRN' };
      default:      return { cls: 'text-gray-600 bg-gray-50', label: 'INF' };
    }
  };

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[2px]" onClick={onClose} />

      {/* Drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col transform transition-transform duration-300 ease-in-out"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-gray-800">Agent Logs</h3>
            {connected ? (
              <span className="flex items-center gap-1 text-xs text-emerald-600" title="WebSocket live">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                live
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-gray-400" title="REST snapshot">
                <WifiOff className="w-3 h-3" /> snapshot
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {wsError && !connected && logs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
              <Activity className="w-8 h-8 text-amber-400" />
              <p className="text-sm text-center">{wsError}</p>
            </div>
          )}

          {logs.length === 0 && !wsError ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-4">
              <Activity className="w-10 h-10 opacity-30" />
              <p className="text-sm text-center">No log entries available yet. Logs will stream here in real time.</p>
              <button
                onClick={() => { window.location.reload(); }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white"
                style={{ background: '#605BE5' }}
              >
                Run a Test Task
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {logs.map((log) => {
                const { cls, label } = levelBadge(log.level);
                return (
                  <div key={log.id} className="p-3 rounded-xl border border-gray-100 hover:border-gray-200 transition-colors">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[0.625rem] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${cls}`}>
                        {label}
                      </span>
                      <span className="text-[0.6875rem] text-gray-400">
                        {new Date(log.sentAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-xs text-gray-700 leading-relaxed">{log.message}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}