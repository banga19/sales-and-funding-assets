import { apiClient } from '../api/client';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface OutreachState {
  contacts:    any[];
  emailLogs:   any[];
  sendingIds:  Set<string>;
  loading:     boolean;
  logsLoading: boolean;
  error:       string | null;
}

export type EmailLogEntry = {
  id:          string;
  contactId:   string;
  contactName: string;
  to:          string;
  subject:     string;
  body:        string;
  status:      'sent' | 'failed' | 'dry-run';
  error?:      string;
  sentAt:      string;
};

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
    const raw: any = await apiClient.get<any>('/contacts?pageSize=200');
    const items: any[] = Array.isArray(raw?.data) ? raw.data : [];
    onStateUpdate?.({ contacts: items, loading: false });
  } catch (err: any) {
    onStateUpdate?.({ error: err?.message ?? 'Failed to load contacts.', loading: false });
  }
}

/** GET /api/outreach/logs — fetch email logs (backend returns plain JSON array) */
export async function fetchEmailLogs(
  onStateUpdate?: (update: Partial<OutreachState>) => void,
): Promise<void> {
  try {
    // apiClient.get() unwraps response.data — outreach endpoint returns raw array
    const resp: any = await apiClient.get<any[]>('/outreach/logs');
    onStateUpdate?.({
      emailLogs:    Array.isArray(resp) ? (resp as any[]) : [],
      logsLoading:  false,
    });
  } catch {
    // best-effort: agent DB-backed endpoint will fill gaps
    onStateUpdate?.({ logsLoading: false });
  }
}
