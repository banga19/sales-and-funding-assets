import { useState, useCallback, useEffect } from 'react';
import { Send, Eye, Loader2, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { SOK } from '@/design-tokens';

interface Tracker {
  filename: string;
  category: string;
  label: string;
}

interface EntryPreview {
  index: number;
  companyName: string;
  toEmail: string | null;
  subject: string;
  tier: string;
  decision: { verdict: string; reason: string };
}

interface PreviewData {
  batchFile: string;
  categoryLabel: string;
  totalEntries: number;
  sendable: number;
  quarantined: number;
  blocked: number;
  noEmail: number;
  entries: EntryPreview[];
}

interface SendResult {
  companyName: string;
  toEmail?: string;
  sendStatus: string;
  messageId?: string;
  error?: string;
}

const API = '/api/agents/batch-send';

export default function BatchSendPanel() {
  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResults, setSendResults] = useState<SendResult[] | null>(null);
  const [isDryRun, setIsDryRun] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/trackers`);
        const data = await res.json();
        if (data.success && data.trackers) {
          setTrackers(data.trackers);
          if (data.trackers.length > 0) {
            setSelectedFile(data.trackers[0].filename);
          }
        }
      } catch { /* ignore */ }
    })();
  }, []);

  const handlePreview = useCallback(async () => {
    if (!selectedFile) return;
    setLoading(true);
    setError('');
    setPreview(null);
    setSendResults(null);
    try {
      const res = await fetch(`${API}/preview?batchFile=${encodeURIComponent(selectedFile)}`);
      const data = await res.json();
      if (data.success) {
        setPreview(data);
      } else {
        setError(data.error || 'Preview failed');
      }
    } catch {
      setError('Failed to load preview');
    } finally {
      setLoading(false);
    }
  }, [selectedFile]);

  const handleSendAll = useCallback(async () => {
    if (!selectedFile) return;
    setSending(true);
    setError('');
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchFile: selectedFile, overrideNhod: false }),
      });
      const data = await res.json();
      if (data.success || data.sent > 0) {
        setSendResults(data.results || []);
        setIsDryRun(!!data.dryRun);
      } else {
        setIsDryRun(false);
        setError(data.error || 'Send failed');
      }
    } catch {
      setIsDryRun(false);
      setError('Failed to send batch');
    } finally {
      setSending(false);
    }
   }, [selectedFile]);

  const verdictColor = (v: string) => {
    switch (v) {
      case 'send': return { bg: '#D1FAE5', text: '#065F46' };
      case 'soft-quarantine': return { bg: '#FEF3C7', text: '#92400E' };
      case 'nhod': return { bg: '#FEE2E2', text: '#991B1B' };
      default: return { bg: '#F3F4F6', text: '#6B7280' };
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="text-xs font-medium text-gray-500 mb-1 block">Batch File</label>
          <select
            value={selectedFile}
            onChange={(e) => { setSelectedFile(e.target.value); setPreview(null); setSendResults(null); }}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
          >
            {trackers.length === 0 && <option value="">Loading...</option>}
            {trackers.map((t) => (
              <option key={t.filename} value={t.filename}>{t.label}</option>
            ))}
          </select>
        </div>
        <button
          onClick={handlePreview}
          disabled={loading || !selectedFile}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white transition disabled:opacity-50"
          style={{ background: SOK.primary }}
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
          Preview
        </button>
      </div>

      {error && (
        <div className="text-sm p-3 rounded-lg bg-red-50 border border-red-200 text-red-700">{error}</div>
      )}

      {preview && !sendResults && (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700">
              {preview.sendable} Sendable
            </span>
            {preview.blocked > 0 && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-50 text-red-700">
                {preview.blocked} Blocked
              </span>
            )}
            {preview.quarantined > 0 && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700">
                {preview.quarantined} Quarantined
              </span>
            )}
            {preview.noEmail > 0 && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                {preview.noEmail} No Email
              </span>
            )}
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
              {preview.totalEntries} Total
            </span>
          </div>

          <div className="border border-gray-100 rounded-lg divide-y divide-gray-50 max-h-60 overflow-y-auto">
            {preview.entries.map((entry) => {
              const vc = verdictColor(entry.decision.verdict);
              return (
                 <div key={`${entry.toEmail || ''}|${entry.companyName || 'unknown'}|${entry.index}`} className="flex items-center justify-between px-3 py-2 text-sm">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-800 truncate">{entry.companyName}</p>
                    <p className="text-xs text-gray-400 truncate">{entry.toEmail || '\u2014'}</p>
                  </div>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full ml-2 shrink-0"
                    style={{ background: vc.bg, color: vc.text }}>
                    {entry.decision.verdict}
                  </span>
                </div>
              );
            })}
          </div>

          <button
            onClick={handleSendAll}
            disabled={sending || preview.sendable === 0}
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition disabled:opacity-40 w-full justify-center"
            style={{ background: SOK.primary }}
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {sending ? 'Sending...' : `Send All (${preview.sendable})`}
          </button>
        </div>
      )}

      {sendResults && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-700">
              {isDryRun ? 'Dry-Run Preview' : 'Send Results'}
            </h4>
            <button onClick={() => { setSendResults(null); setPreview(null); setError(''); setIsDryRun(false); }}
              className="text-xs text-indigo-500 hover:underline">Clear</button>
          </div>
          <div className="flex gap-2 flex-wrap mb-2">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700">
              {isDryRun ? 'Dry-run' : 'Sent'}: {sendResults.filter(r => r.sendStatus === 'sent' || (!isDryRun && r.sendStatus === 'dry-run')).length}
            </span>
            {sendResults.filter(r => r.sendStatus === 'failed').length > 0 && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-50 text-red-700">
                {sendResults.filter(r => r.sendStatus === 'failed').length} Failed
              </span>
            )}
            {sendResults.filter(r => r.sendStatus === 'skipped').length > 0 && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700">
                {sendResults.filter(r => r.sendStatus === 'skipped').length} Skipped
              </span>
            )}
          </div>
          <div className="border border-gray-100 rounded-lg divide-y divide-gray-50 max-h-72 overflow-y-auto">
            {sendResults.map((r, i) => {
              const statusColor = r.sendStatus === 'sent'
                ? 'bg-emerald-50 text-emerald-600'
                : r.sendStatus === 'failed'
                  ? 'bg-red-50 text-red-600'
                  : r.sendStatus === 'dry-run'
                    ? 'bg-blue-50 text-blue-600'
                    : 'bg-amber-50 text-amber-600';
              const statusIcon = r.sendStatus === 'sent'
                ? <CheckCircle className="w-4 h-4 text-emerald-500" />
                : r.sendStatus === 'failed'
                  ? <XCircle className="w-4 h-4 text-red-500" />
                  : r.sendStatus === 'dry-run'
                    ? <Eye className="w-4 h-4 text-blue-500" />
                    : <AlertTriangle className="w-4 h-4 text-amber-400" />;
              return (
                <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    {statusIcon}
                    <div>
                      <p className="font-medium text-gray-800 truncate">{r.companyName}</p>
                      <p className="text-xs text-gray-400 truncate">{r.toEmail || '\u2014'}</p>
                    </div>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ml-2 shrink-0 ${statusColor}`}>
                    {r.sendStatus}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
