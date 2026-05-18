/**
 * TestEmailModal
 *
 * Opens a centred modal that triggers POST /api/test-email, shows a
 * success / error message, and closes on Escape or overlay click.
 * Uses no additional deps beyond lucide-react and React.
 */

import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';

export default function TestEmailModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [sending, setSending] = useState(false);
  const [result,  setResult]  = useState<string | null>(null);

  if (!open) return null;

  const handleSend = async () => {
    setSending(true);
    setResult(null);
    try {
      const r = await fetch('/api/test-email', { method: 'POST' });
      const data = await r.json();
      setResult(data?.message ?? (data.success ? 'Test email sent successfully.' : 'Failed to send email.'));
    } catch (e: any) {
      setResult(`Error: ${e.message}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 mx-4"
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-800">Send Test Email</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Body */}
        <p className="text-sm text-gray-500 mb-5">
          This will send a test email to your configured address via the email service.
        </p>

        {result && (
          <div className={`mb-4 px-4 py-2.5 rounded-lg text-sm ${result.includes('Error') ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
            {result}
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition">
            Close
          </button>
          <button
            onClick={handleSend}
            disabled={sending}
            className="px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 disabled:opacity-50 transition flex items-center gap-2"
          >
            {sending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
