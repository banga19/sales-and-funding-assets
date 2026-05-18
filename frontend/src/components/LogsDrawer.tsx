/**
 * LogsDrawer
 *
 * Slides in from the right (fixed overlay) and fetches agent log entries
 * from GET /api/logs. The list shows timestamp · level · message rows with
 * no full reload needed.
 */

import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';

interface LogEntry {
  id: string;
  level: string;
  message: string;
  sentAt: string;
}

export default function LogsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) { setLogs([]); return; }
    setLoading(true);
    fetch('/api/logs')
      .then(r => r.json())
      .then(data => {
        setLogs(Array.isArray(data) ? data : []);
      })
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const levelColor = (lvl: string) => {
    switch (lvl) {
      case 'error': return 'text-red-600 bg-red-50';
      case 'warn':  return 'text-amber-600 bg-amber-50';
      default:      return 'text-gray-600 bg-gray-50';
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
          <h3 className="text-base font-semibold text-gray-800">Agent Logs</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
              <span className="text-sm">Fetching logs…</span>
            </div>
          ) : logs.length === 0 ? (
            <p className="text-center py-12 text-gray-400 text-sm">No log entries available.</p>
          ) : (
            <div className="space-y-2">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="p-3 rounded-xl border border-gray-100 hover:border-gray-200 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[0.625rem] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${levelColor(log.level)}`}>
                      {log.level}
                    </span>
                    <span className="text-[0.6875rem] text-gray-400">
                      {new Date(log.sentAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-xs text-gray-700 leading-relaxed">{log.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
