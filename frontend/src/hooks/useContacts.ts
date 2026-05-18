/**
 * useContacts
 *
 * Manages fetching and displaying contacts/prospects with toggleable
 * inline expansion. The contacts list is fetched only once on first
 * open (lazy-load) and cached — subsequent re-opens reuse cached data.
 *
 * Optimisation recommendations for the View Contacts feature:
 *   • Add a /api/contacts/pipeline endpoint on the backend to expose just
 *     the pipeline count without the full contact list (cheaper).
 *   • Consider server-side pagination for >100 contacts.
 *   • Consider a SWR / React-Query flattening layer so opening the panel
 *     after a backend push update refetches automatically.
 */

import { useState, useCallback, useRef } from 'react';
import { api } from '../api/cancelableFetch';
import type { Contact } from '../types';

export interface ContactsState {
  open:           boolean;
  contacts:       Contact[] | null;
  loading:        boolean;
  error:          string | null;
  toggle:         () => void;
  close:          () => void;
  fetchContacts:  () => Promise<void>;
}

export function useContacts(): ContactsState {
  const [open,        setOpen]        = useState(false);
  const [contacts,    setContacts]    = useState<Contact[] | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  /* useRef acts as a one-shot sentinel — once the contacts are fetched we
     never issue the GET /contacts call again unless the user explicitly closes
     and re-opens the panel (resetting the ref). */
  const fetchedRef = useRef(false);

  const fetchContacts = useCallback(async () => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    setLoading(true);
    setError(null);
    try {
      const resp: any = await api.getContacts();
      setContacts(resp?.data ?? []);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err?.message ?? 'Failed to load contacts.');
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const toggle = useCallback(() => {
    if (!open && !fetchedRef.current) {
      // Panel opening for the first time — trigger fetch (no await needed)
      void fetchContacts();
    }
    setOpen(prev => !prev);
  }, [open, fetchContacts]);

  const close = useCallback(() => setOpen(false), []);

  return { open, contacts, loading, error, toggle, close, fetchContacts };
}

// Made with Bob
