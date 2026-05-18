/**
 * outreachApi — thin typed wrapper over the backend outreach endpoints.
 *
 * Uses the same Axios apiClient as the rest of the frontend (agent proxy at
 * localhost:3002 for /api/*). Contacts list comes from the existing
 * /api/contacts route and outreach actions post to /api/outreach/send.
 */

import { apiClient } from '../api/client';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface EmailLogEntry {
  id:          string;
  contactId:   string;
  contactName: string;
  to:          string;
  subject:     string;
  body:        string;
  status:      'sent' | 'failed';
  error?:      string;
  sentAt:      string;
}

export interface OutreachState {
  contacts:    any[];
  emailLogs:   EmailLogEntry[];
  sendingIds:  Set<string>;
  loading:     boolean;
  logsLoading: boolean;
  error:       string | null;
}

// ─── API calls ──────────────────────────────────────────────────────────────────

/** POST /api/outreach/send — trigger a single-contact outreach */
export async function sendContactOutreach(
  contactId: string,
  dryRun = false,
  onStateUpdate?: (update: Partial<OutreachState>) => void,
): Promise<{ ok: boolean; message: string }> {
  try {
    const resp: any = await apiClient.post('/outreach/send', { contactId, dryRun });
    return { ok: Boolean(resp?.success), message: resp?.message ?? 'Done.' };
  } catch (err: any) {
    return {
      ok: false,
      message: err?.response?.data?.error ?? err?.message ?? 'Request failed.',
    };
  }
}

/** GET /api/contacts — list all contacts (unwrap Axios response) */
export async function fetchOutreachContacts(
  onStateUpdate?: (update: Partial<OutreachState>) => void,
): Promise<void> {
  try {
    // apiClient generic methods unwrap response.data; contacts route returns { data, total, ... }
    const raw: any = await apiClient.get<any>('/contacts?pageSize=200');
    const items: any[] = Array.isArray(raw?.data) ? raw.data : [];
    onStateUpdate?.({ contacts: items, loading: false });
  } catch (err: any) {
    onStateUpdate?.({ error: err?.message ?? 'Failed to load contacts.', loading: false });
  }
}

/** GET /api/outreach/logs — fetch email logs from backend outreach store */
export async function fetchEmailLogs(
  onStateUpdate?: (update: Partial<OutreachState>) => void,
): Promise<void> {
  try {
    const resp: any = await apiClient.get<any[]>('/outreach/logs');
    onStateUpdate?.({
      emailLogs: Array.isArray(resp) ? resp : [],
      logsLoading: false,
    });
  } catch {
    // best-effort endpoint
    onStateUpdate?.({ logsLoading: false });
  }
}
