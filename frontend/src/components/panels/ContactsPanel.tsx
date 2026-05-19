import { useState, useEffect } from 'react';
import { apiClient } from '@/api/client';
import { UserPlus, Mail, Phone, Building } from 'lucide-react';

interface Contact {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
}

export default function ContactsPanel() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    apiClient.getContacts({ pageSize: 200 })
      .then((res: any) => setContacts(Array.isArray(res.contacts) ? res.contacts : res ?? []))
      .catch(() => setError('Failed to load contacts'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="animate-pulse space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 bg-gray-200 rounded-lg" />
          ))}
        </div>
      ) : error ? (
        <div className="text-sm text-red-500 bg-red-50 p-3 rounded-lg">{error}</div>
      ) : contacts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-400">
          <UserPlus className="w-10 h-10 mb-3" />
          <p className="text-sm font-medium mb-1">No contacts yet</p>
          <p className="text-xs mb-4">Contacts will appear here once added to the database</p>
          <button className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors">
            Import Contacts
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-gray-200">
          {contacts.map((contact: Contact) => (
            <li key={contact.id} className="py-3 flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-medium text-blue-700">
                  {(contact.name || contact.email || '?')[0].toUpperCase()}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900 truncate">{contact.name || 'Unnamed'}</p>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500 mt-1">
                  {contact.email && (
                    <span className="flex items-center gap-1">
                      <Mail className="w-3 h-3" /> {contact.email}
                    </span>
                  )}
                  {contact.phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="w-3 h-3" /> {contact.phone}
                    </span>
                  )}
                  {contact.company && (
                    <span className="flex items-center gap-1">
                      <Building className="w-3 h-3" /> {contact.company}
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
