import { useState, useEffect, useCallback, useMemo } from 'react';
import { apiClient } from '@/api/client';
import {
  Send,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  X,
} from 'lucide-react';

interface Contact {
  id: string;
  name: string;
  email: string;
  company: string;
}

const EMAIL_TEMPLATES = {
  product_inquiry: {
    subject: 'Inquiry: {{product_name}} \u2013 Fast Delivery & Wholesale Pricing',
    body: `Hi {{first_name}},

I'm reaching out from Sokogate. We've sourced trending {{product_category}} products that are lightweight and high\u2010demand for your market.

Would you be interested in reviewing our latest catalogue? We offer quick shipping and competitive B2B pricing.

Looking forward to hearing from you.

Best regards,
{{sender_name}}`,
  },
  follow_up: {
    subject: 'Following up on our previous conversation',
    body: `Hi {{first_name}},

Just wanted to follow up on my last message about the {{product_name}} line.

Let me know if you'd like samples or a price quote. I'm happy to jump on a call.

Best,
{{sender_name}}`,
  },
  funding_pitch: {
    subject: 'Funding opportunity: Sokogate supplier partnership',
    body: `Dear {{first_name}},

Sokogate is offering funding partnerships for B2B importers of high\u2010velocity products. We've identified {{product_name}} as a strong candidate for your market.

Can we schedule a quick call to discuss how this could work for you?

Regards,
{{sender_name}}`,
  },
};

export default function TestEmailPanel() {
  // Recipients
  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipientInput, setRecipientInput] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [showContactSuggestions, setShowContactSuggestions] = useState(false);

  // Email content
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [previewMode, setPreviewMode] = useState(false);

  // Sender info
  const [senderName, setSenderName] = useState('Sokogate Agent');

  // Status
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [mode, setMode] = useState<'dry_run' | 'live'>('dry_run');
  const [resultMessage, setResultMessage] = useState('');

  // Fetch contacts for autocomplete
  useEffect(() => {
    apiClient.getContacts({ pageSize: 500 }).then(res => {
      const items = Array.isArray(res?.data) ? res.data : [];
      setContacts(
        items.map((c: any) => ({
          id: String(c.id),
          name: c.name || 'Unknown',
          email: c.email || '',
          company: c.company || '',
        }))
      );
    }).catch(() => {});
  }, []);

  // Fetch current mode
  useEffect(() => {
    apiClient.getStatus().then(res => {
      setMode(res.dryRun ? 'dry_run' : 'live');
    }).catch(() => {});
  }, []);

  // Filter contacts as user types
  const filteredContacts = useMemo(() => {
    if (!recipientInput) return contacts.slice(0, 5);
    const search = recipientInput.toLowerCase();
    return contacts.filter(c =>
      c.email.toLowerCase().includes(search) ||
      c.name.toLowerCase().includes(search) ||
      c.company.toLowerCase().includes(search)
    ).slice(0, 5);
  }, [contacts, recipientInput]);

  // Add a recipient from contact selection or free-typed entry
  const addRecipient = (email: string) => {
    if (!email || !email.includes('@')) return;
    if (!recipients.includes(email)) {
      setRecipients(prev => [...prev, email]);
    }
    setRecipientInput('');
    setShowContactSuggestions(false);
  };

  // Remove a recipient chip
  const removeRecipient = (email: string) => {
    setRecipients(prev => prev.filter(r => r !== email));
  };

  // Apply a template
  const applyTemplate = (templateKey: keyof typeof EMAIL_TEMPLATES) => {
    const tmpl = EMAIL_TEMPLATES[templateKey];
    setSubject(tmpl.subject);
    setBody(tmpl.body);
  };

  // Replace placeholders with actual values
  const replacePlaceholders = useCallback(
    (text: string, contact?: Contact) => {
      const firstName = contact?.name?.split(' ')[0] || 'there';
      return text
        .replace(/\{\{first_name\}\}/g, firstName)
        .replace(/\{\{company\}\}/g, contact?.company || 'your company')
        .replace(/\{\{product_name\}\}/g, 'trending product')
        .replace(/\{\{product_category\}\}/g, 'electronics')
        .replace(/\{\{sender_name\}\}/g, senderName);
    },
    [senderName]
  );

  const previewContent = useMemo(() => {
    return replacePlaceholders(body).replace(/\n/g, '<br/>');
  }, [body, replacePlaceholders]);

  const handleSend = async () => {
    if (recipients.length === 0) return;
    setSending(true);
    setStatus('idle');
    setResultMessage('');

    try {
      if (mode === 'dry_run') {
        await new Promise(resolve => setTimeout(resolve, 600));
        setStatus('success');
        setResultMessage(`Simulated sending to ${recipients.length} recipient(s). (Dry Run mode)`);
        setRecipients([]);
        return;
      }

      const promises = recipients.map(async (email) => {
        const contact = contacts.find(c => c.email === email);
        const personalizedSubject = replacePlaceholders(subject, contact);
        const personalizedBody = replacePlaceholders(body, contact);
        return apiClient.sendEmail(email, personalizedSubject, personalizedBody);
      });

      await Promise.all(promises);
      setStatus('success');
      setResultMessage(`Email sent successfully to ${recipients.length} recipient(s).`);
      setRecipients([]);
    } catch (err) {
      setStatus('error');
      setResultMessage('Failed to send to some recipients. Check logs for details.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Mode indicator */}
      <div className="flex items-center justify-between bg-gray-50 p-2 rounded-lg">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span className={`w-2 h-2 rounded-full ${mode === 'live' ? 'bg-red-500' : 'bg-amber-500'}`} />
          {mode === 'dry_run'
            ? 'Dry Run \u2013 emails will be simulated'
            : 'Live \u2013 emails will be delivered'}
        </div>
        <button
          onClick={() => {
            const newMode = mode === 'dry_run' ? 'live' : 'dry_run';
            apiClient.toggleDryRun(newMode === 'dry_run').then(() => setMode(newMode)).catch(() => {});
          }}
          className="text-xs text-blue-600 hover:underline"
        >
          Switch to {mode === 'dry_run' ? 'Live' : 'Dry Run'}
        </button>
      </div>

      {/* Recipients */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
        <div className="flex flex-wrap items-center gap-2 p-2 border border-gray-300 rounded-lg focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500">
          {recipients.map(email => (
            <span key={email} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 text-sm rounded-full">
              {email}
              <button onClick={() => removeRecipient(email)} className="hover:text-red-500">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <input
            type="text"
            placeholder="Add email or select contact..."
            value={recipientInput}
            onChange={(e) => {
              setRecipientInput(e.target.value);
              setShowContactSuggestions(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && recipientInput) {
                e.preventDefault();
                addRecipient(recipientInput);
              }
            }}
            onFocus={() => setShowContactSuggestions(true)}
            onBlur={() => setTimeout(() => setShowContactSuggestions(false), 200)}
            className="flex-1 outline-none min-w-[120px] text-sm"
          />
        </div>

        {/* Contact Suggestions Dropdown */}
        {showContactSuggestions && recipientInput && filteredContacts.length > 0 && (
          <ul className="mt-1 border border-gray-200 rounded-lg bg-white shadow-lg max-h-48 overflow-y-auto z-10">
            {filteredContacts.map(contact => (
              <li
                key={contact.id}
                onMouseDown={() => addRecipient(contact.email)}
                className="px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm flex items-center gap-2"
              >
                <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-medium text-blue-700 truncate">
                  {contact.name ? contact.name.charAt(0).toUpperCase() : '?'}
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{contact.name || 'No name'}</p>
                  <p className="text-xs text-gray-500 truncate">{contact.email}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Templates */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Quick Templates</label>
        <div className="flex flex-wrap gap-2">
          {Object.entries(EMAIL_TEMPLATES).map(([key, tmpl]) => (
            <button
              key={key}
              onClick={() => applyTemplate(key as keyof typeof EMAIL_TEMPLATES)}
              className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors capitalize"
            >
              {key.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Subject */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Enter subject..."
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
        />
      </div>

      {/* Body */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium text-gray-700">Message</label>
          <button
            onClick={() => setPreviewMode(!previewMode)}
            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
          >
            {previewMode ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            {previewMode ? 'Edit' : 'Preview'}
          </button>
        </div>
        {previewMode ? (
          <div
            className="w-full min-h-[160px] p-3 border border-gray-300 rounded-lg bg-gray-50 text-sm"
            dangerouslySetInnerHTML={{ __html: previewContent }}
          />
        ) : (
          <textarea
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your message... Use {{first_name}} for personalization"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
          />
        )}
        <p className="mt-1 text-xs text-gray-400">
          Placeholders: {'{{first_name}} {{company}} {{product_name}} {{product_category}} {{sender_name}}'}
        </p>
      </div>

      {/* Sender Name */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Your Name (signature)</label>
        <input
          value={senderName}
          onChange={(e) => setSenderName(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
        />
      </div>

      {/* Send Button */}
      <button
        onClick={handleSend}
        disabled={sending || recipients.length === 0 || !subject.trim() || !body.trim()}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        <Send className="w-4 h-4" />
        {sending ? 'Sending...' : `Send to ${recipients.length || '0'} recipient(s)`}
      </button>

      {/* Status Messages */}
      {status === 'success' && resultMessage && (
        <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 p-3 rounded-lg">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          {resultMessage}
        </div>
      )}
      {status === 'error' && resultMessage && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-lg">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {resultMessage}
        </div>
      )}
    </div>
  );
}
