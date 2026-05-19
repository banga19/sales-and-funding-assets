import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/api/client';
import { RefreshCw, Terminal } from 'lucide-react';

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

export default function AgentLogsPanel() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { logs: entries } = await apiClient.getLogs(200);
      setLogs(entries ?? []);
    } catch (err) {
      setError('Failed to load logs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchLogs(); }, [fetchLogs]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">Recent agent activity</span>
        <button
          onClick={fetchLogs}
          className="inline-flex items-center gap-1 px-3 py-1 text-xs text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-4 bg-gray-200 rounded w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="text-sm text-red-500 bg-red-50 p-3 rounded-lg">{error}</div>
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-gray-400">
          <Terminal className="w-8 h-8 mb-2" />
          <p className="text-sm">No log entries available</p>
          <p className="text-xs">Send a test email or run a scrape to generate logs</p>
        </div>
      ) : (
        <div className="bg-gray-900 text-green-400 p-4 rounded-lg font-mono text-xs max-h-96 overflow-y-auto">
          {logs.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              {`[${line.timestamp}] [${line.level}] ${line.message}`}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
