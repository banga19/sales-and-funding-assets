import { useState, useEffect } from 'react';
import { apiClient } from '@/api/client';
import { Send, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function TestEmailPanel() {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('Sokogate Agent Test');
  const [body, setBody] = useState('This is a test email from Sokogate Sales & Funding Agent.');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [mode, setMode] = useState<'live' | 'dry_run'>('dry_run');

  useEffect(() => {
    apiClient.getStatus().then(res => {
      setMode(res.dryRun ? 'dry_run' : 'live');
    }).catch(() => {});
  }, []);

  const handleSend = async () => {
    if (!to.trim()) return;
    setSending(true);
    setStatus('idle');
    try {
      await apiClient.triggerTestEmail(to, subject);
      setStatus('success');
      setTo(''); setSubject('Sokogate Agent Test'); setBody('');
    } catch (err) {
      setStatus('error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Mode indicator — fixed: reads from /status so mode is never undefined */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
        <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
        Mode: {mode === 'dry_run' ? 'Dry Run (emails simulated)' : 'Live'}
      </div>

      {/* Email Form */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
        <input
          type="email"
          placeholder="recipient@example.com"
          value={to}
          onChange={e => setTo(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
        <input
          value={subject}
          onChange={e => setSubject(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
        <textarea
          rows={4}
          value={body}
          onChange={e => setBody(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
        />
      </div>

      <button
        onClick={handleSend}
        disabled={sending || !to.trim()}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        <Send className="w-4 h-4" />
        {sending ? 'Sending...' : 'Send Test Email'}
      </button>

      {status === 'success' && (
        <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 p-3 rounded-lg">
          <CheckCircle2 className="w-4 h-4" />
          Email sent successfully (or simulated in Dry Run mode)
        </div>
      )}
      {status === 'error' && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-lg">
          <AlertCircle className="w-4 h-4" />
          Failed to send email. Check configuration and logs.
        </div>
      )}
    </div>
  );
}
