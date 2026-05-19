import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import Papa from 'papaparse';
import {
  UserPlus,
  Mail,
  Phone,
  Building,
  Upload,
  Plus,
  Send,
  Clock,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { useEmailPanel } from '@/context/EmailPanelContext';
import { toast } from 'react-hot-toast';

interface Contact {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  outreach_status?: string;
  last_contacted?: string | null;
  emails_sent?: number;
  tier?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
}

/** Normalise any contact response shape into the frontend Contact shape. */
function normalise(raw: any): Contact {
  const c = raw.contact ?? raw; // unwrap { contact: … } if present
  return {
    id:               c.id,
    name:             c.name ?? c.contact_name ?? '',
    email:            c.email ?? '',
    phone:            c.phone ?? '',
    company:          c.company ?? '',
    outreach_status:  c.outreach_status ?? 'none',
    last_contacted:   c.last_contacted ?? c.last_contact_date ?? null,
    emails_sent:      c.emails_sent ?? 0,
    tier:             c.tier,
    status:           c.status,
    created_at:       c.created_at ?? c.createdAt,
    updated_at:       c.updated_at ?? c.updatedAt,
  };
}

export default function ContactsPanel() {
  const { openEmailPanel } = useEmailPanel();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualContact, setManualContact] = useState({ name: '', email: '', phone: '', company: '' });
  const [saving, setSaving] = useState(false);
  const [selectedEmails, setSelectedEmails] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchContacts = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await axios.get('/contacts', { params: { pageSize: 500 } });

      // ── Normalise response ──────────────────────────────────────────────────
      let list: Contact[];
      if (Array.isArray(data?.data)) {
        // New DB-backed shape:  { success, data: Contact[], total, … }
        list = data.data.map(normalise);
        setTotal(data.total ?? list.length);
      } else if (data instanceof Array) {
        list = data.map(normalise);
        setTotal(list.length);
      } else if (Array.isArray(data?.contacts)) {
        list = data.contacts.map(normalise);
        setTotal(data.total ?? list.length);
      } else {
        list = [];
        setTotal(0);
      }

      // Ensure outreach defaults are always present
      setContacts(list.map(c => ({
        ...c,
        outreach_status: c.outreach_status ?? 'none',
        emails_sent:     c.emails_sent     ?? 0,
        last_contacted:  c.last_contacted  ?? null,
      })));
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to load contacts';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchContacts(); }, []);

  // ── Manual add ──────────────────────────────────────────────────────────────
  const handleManualAdd = async () => {
    if (!manualContact.email || !manualContact.name) {
      toast.error('Name and email are required');
      return;
    }
    setSaving(true);
    try {
      await axios.post('/contacts', manualContact);
      toast.success('Contact saved successfully!');
      setManualContact({ name: '', email: '', phone: '', company: '' });
      setShowManualForm(false);
      fetchContacts();
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Failed to save contact';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  // ── Multi-select helpers ───────────────────────────────────────────────────────
  const toggleContactSelection = (email: string) => {
    setSelectedEmails(prev =>
      prev.includes(email) ? prev.filter(e => e !== email) : [...prev, email]
    );
  };

  const clearSelection = () => setSelectedEmails([]);

  // ── CSV import ──────────────────────────────────────────────────────────────
  const handleCSVUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const rows = results.data as any[];
        if (rows.length === 0) {
          toast.error('CSV file is empty');
          return;
        }
        const pick = (row: any, ...keys: string[]) => {
          for (const k of keys) {
            const val = row[k];
            if (val && String(val).trim()) return String(val).trim();
          }
          return '';
        };

        const mapped = rows
          .map((row) => ({
            name:     pick(row, 'name', 'Name', 'NAME', 'contact_name'),
            email:    pick(row, 'email', 'Email', 'EMAIL'),
            phone:    pick(row, 'phone', 'Phone', 'PHONE'),
            company:  pick(row, 'company', 'Company', 'COMPANY'),
          }))
          .filter((r) => r.email);

        if (mapped.length === 0) {
          toast.error('No valid contacts (email required) found in CSV');
          return;
        }

        try {
          const { data } = await axios.post('/contacts/bulk', { contacts: mapped });
          const count = typeof data?.imported === 'number' ? data.imported : mapped.length;
          toast.success(`Imported ${count} contact${count === 1 ? '' : 's'} successfully!`);
          fetchContacts();
        } catch (err: any) {
          const msg = err?.response?.data?.error || 'Import failed';
          toast.error(msg);
        }
      },
      error: () => toast.error('Failed to parse CSV file'),
    });

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-4">
      {/* Top actions */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowManualForm(!showManualForm)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {showManualForm ? 'Cancel' : 'Add Manually'}
          </button>
          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 cursor-pointer transition-colors">
            <Upload className="w-3.5 h-3.5" />
            Import CSV
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleCSVUpload}
              className="hidden"
            />
          </label>
        </div>
        <span className="text-xs text-gray-400">
          {total || contacts.length} contact{contacts.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Bulk send inquiry bar ──────────────────────────────────────────────── */}
      {selectedEmails.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
          <span className="text-sm text-green-700 font-medium">
            {selectedEmails.length} contact{selectedEmails.length !== 1 ? 's' : ''} selected
          </span>
          <button
            type="button"
            onClick={() => {
              openEmailPanel({ recipients: [...selectedEmails] });
              clearSelection();
            }}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
            Send Inquiry
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="px-2 py-1.5 text-xs text-green-600 hover:underline"
          >
            Clear
          </button>
        </div>
      )}

      {/* Manual add form */}
      {showManualForm && (
        <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-3">
          <h4 className="text-sm font-medium text-gray-700">New Contact</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              placeholder="Name *"
              value={manualContact.name}
              onChange={(e) => setManualContact(p => ({ ...p, name: e.target.value }))}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
            <input
              type="email"
              placeholder="Email *"
              value={manualContact.email}
              onChange={(e) => setManualContact(p => ({ ...p, email: e.target.value }))}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
            <input
              placeholder="Phone"
              value={manualContact.phone}
              onChange={(e) => setManualContact(p => ({ ...p, phone: e.target.value }))}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
            <input
              placeholder="Company"
              value={manualContact.company}
              onChange={(e) => setManualContact(p => ({ ...p, company: e.target.value }))}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <button
            type="button"
            onClick={handleManualAdd}
            disabled={saving || !manualContact.name || !manualContact.email}
            className="w-full py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save Contact'}
          </button>
        </div>
      )}

      {/* Contacts list */}
      {loading ? (
        <div className="animate-pulse space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-200 rounded-lg" />
          ))}
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-lg">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
          <button onClick={fetchContacts} className="ml-auto inline-flex items-center gap-1 underline text-xs">
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      ) : contacts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-gray-400">
          <UserPlus className="w-10 h-10 mb-2" />
          <p className="text-sm font-medium">No contacts yet</p>
          <p className="text-xs mb-3">Add a contact manually or import a CSV file.</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-200">
          {contacts.map(contact => (
            <li key={contact.id} className="py-3 flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-medium text-blue-700">
                  {(contact.name || contact.email || '?')[0].toUpperCase()}
                </span>
              </div>
              <div className="min-w-0 flex-1">
              <input
                type="checkbox"
                checked={selectedEmails.includes(contact.email ?? '')}
                onChange={() => contact.email && toggleContactSelection(contact.email)}
                className="mt-1 mr-2 w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                title="Select for bulk email"
              />
                <p className="text-sm font-medium text-gray-900 truncate">{contact.name || 'Unnamed'}</p>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500 mt-1">
                  {contact.email && (
                    <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{contact.email}</span>
                  )}
                  {contact.phone && (
                    <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{contact.phone}</span>
                  )}
                  {contact.company && (
                    <span className="flex items-center gap-1"><Building className="w-3 h-3" />{contact.company}</span>
                  )}
                </div>
                {/* Outreach status */}
                <div className="mt-1 flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1">
                    <Send className="w-3 h-3 text-gray-400" />
                    {contact.emails_sent || 0}
                  </span>
                  {contact.last_contacted && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-gray-400" />
                      {new Date(contact.last_contacted).toLocaleDateString()}
                    </span>
                  )}
                  <span className={`px-1.5 py-0.5 rounded-full text-xs ${
                    contact.outreach_status === 'replied' ? 'bg-green-100 text-green-700' :
                    contact.outreach_status === 'emailed' ? 'bg-blue-100 text-blue-700' :
                    contact.outreach_status === 'bounced' ? 'bg-red-100 text-red-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {contact.outreach_status === 'none' ? 'None' : contact.outreach_status}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
