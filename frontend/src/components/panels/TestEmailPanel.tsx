import { useState, useEffect, useCallback, useMemo } from 'react';
import { apiClient } from '@/api/client';
import {
  Send, Eye, EyeOff, AlertCircle, CheckCircle2, X,
  Package, Truck, BadgeCheck,
} from 'lucide-react';
import { useEmailPanel, type EmailPanelProduct } from '@/context/EmailPanelContext';

interface Contact {
  id: string;
  name: string;
  email: string;
  company: string;
}

// ─── B2B Email Templates ────────────────────────────────────────────────────────

const EMAIL_TEMPLATES: Record<string, { subject: string; body: string }> = {
  product_inquiry: {
    subject: '🔥 Trending {{product_name}} – Lightweight, Fast Shipping, Low MOQ from Sokogate',
    body: `Hi {{first_name}},

I noticed your company {{company}} operates in the {{product_category}} space. I wanted to share a trending product sourced directly from Sokogate.com -- Africa's leading B2B cross-border marketplace.

📦 Product: {{product_name}}
💰 Unit Price: {{currency}}{{price}} | MOQ: {{moq}} units
⚖️ Weight: {{weight}}g (lightweight -- air freight friendly)
✈️ Air Delivery: {{air_delivery}} | 🚢 Sea: {{sea_delivery}}
🏭 Verified Supplier: {{supplier}}

Why this product moves fast:
• Lightweight at {{weight}}g -- minimises shipping cost per unit
• Low MOQ of {{moq}} units -- test the market without overcommitting
• Trending score {{trending_score}}/100 -- proven demand

Would you be interested in receiving samples or a full catalogue? I can arrange factory-direct pricing with volume discounts.

Best regards,
{{sender_name}}
Sokogate Sales & Funding Agent`,
  },
  follow_up: {
    subject: 'Following up on our conversation about {{product_name}}',
    body: `Hi {{first_name}},

Just wanted to follow up on my last message regarding the {{product_name}} from Sokogate.

Quick recap:
• Price: {{currency}}{{price}} / unit | MOQ: {{moq}}
• Air delivery: {{air_delivery}} days | Sea: {{sea_delivery}} days
• Verified supplier with track record

Would you like me to share a formal quotation or arrange a sample order?

Happy to jump on a quick call at your convenience.

Best,
{{sender_name}}
Sokogate Sales & Funding Agent`,
  },
  funding_pitch: {
    subject: 'Funding opportunity: Sokogate B2B sourcing partnership for {{company}}',
    body: `Dear {{first_name}},

Sokogate is expanding its strategic distribution network supporting importers across Kenya and East Africa. Our verified product catalog includes {{product_name}} and {{product_category}} ranges ideal for high-volume retail turnover.

We offer:
• Margin-protective wholesale pricing
• 7–15 day air freight, 45–75 day sea freight from Guangzhou
• M-Pesa, Wave, Orange Money, Airtel payment channels
• Verified suppliers with established track records

I'd love to schedule a 15-minute call to discuss how Sokogate can support your growth targets.

Regards,
{{sender_name}}
Sokogate Sales & Funding Agent`,
  },
};

export default function TestEmailPanel() {
  const { config: panelConfig } = useEmailPanel();
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

  // Pre-fill from EmailPanelContext (recipients + product)
  useEffect(() => {
    if (panelConfig.recipients) {
      setRecipients(prev => {
        const merged = [...prev];
        for (const email of panelConfig.recipients!) {
          if (!merged.includes(email)) merged.push(email);
        }
        return merged;
      });
    }

    if (panelConfig.product) {
      const p = panelConfig.product as EmailPanelProduct;
      const tmpl = EMAIL_TEMPLATES.product_inquiry;
      setSubject(tmpl.subject
        .replace('{{product_name}}', p.title)
        .replace('{{price}}', p.price.toFixed(2))
        .replace('{{moq}}', String(p.moq))
        .replace('{{weight}}', String(p.weight))
        .replace('{{air_delivery}}', p.airDelivery)
        .replace('{{sea_delivery}}', p.seaDelivery)
        .replace('{{supplier}}', p.supplier)
        .replace('{{product_category}}', p.category)
        .replace('{{trending_score}}', String(p.trendingScore ?? 90)));
      setBody(tmpl.body
        .replace('{{first_name}}', 'there')
        .replace('{{company}}', 'your company')
        .replace('{{product_name}}', p.title)
        .replace('{{currency}}', '$')
        .replace('{{price}}', p.price.toFixed(2))
        .replace('{{moq}}', String(p.moq))
        .replace('{{weight}}', String(p.weight))
        .replace('{{air_delivery}}', p.airDelivery)
        .replace('{{sea_delivery}}', p.seaDelivery)
        .replace('{{supplier}}', p.supplier)
        .replace('{{product_category}}', p.category)
        .replace('{{trending_score}}', String(p.trendingScore ?? 90))
        .replace('{{sender_name}}', senderName));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelConfig.recipients, panelConfig.product]);

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

  // Replace placeholders with actual values — enriched B2B variant
  const replacePlaceholders = useCallback(
    (text: string, contact?: Contact) => {
      const firstName = contact?.name?.split(' ')[0] || 'there';
      return text
        .replace(/\{\{first_name\}\}/g, firstName)
        .replace(/\{\{company\}\}/g, contact?.company || 'your company')
        .replace(/\{\{product_name\}\}/g, 'trending B2B product')
        .replace(/\{\{product_category\}\}/g, 'electronics')
        .replace(/\{\{sender_name\}\}/g, senderName)
        .replace(/\{\{price\}\}/g, '15.40')
        .replace(/\{\{moq\}\}/g, '10')
        .replace(/\{\{weight\}\}/g, '250')
        .replace(/\{\{air_delivery\}\}/g, '7-15 days')
        .replace(/\{\{sea_delivery\}\}/g, '45-75 days')
        .replace(/\{\{supplier\}\}/g, 'Sokogate Verified Supplier')
        .replace(/\{\{trending_score\}\}/g, '90')
        .replace(/\{\{#tiers\}\}[\s\S]*?\{\{\/tiers\}\}/g, '')
        .replace(/\{\{min_qty\}\}/g, '10')
        .replace(/\{\{max_qty\}\}/g, '30')
        .replace(/\{\{unit_price\}\}/g, '15.40')
        .replace(/\{\{discount_percent\}\}/g, '8');
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
          {'Placeholders: {{first_name}} {{company}} {{product_name}} {{product_category}} {{price}} {{moq}} {{weight}} {{air_delivery}} {{sea_delivery}} {{supplier}} {{trending_score}} {{sender_name}}'}
        </p>

      {/* Send Button */}
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
