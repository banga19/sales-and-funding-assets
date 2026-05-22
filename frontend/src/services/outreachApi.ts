import { apiClient } from '../api/client';
import { withTimeout } from '../utils/asyncHelpers';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface OutreachState {
  contacts:    any[];
  emailLogs:   any[];
  sendingIds:  Set<string>;
  loading:     boolean;
  logsLoading: boolean;
  contactsError:  string | null;
  logsError:      string | null;
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

/** POST /api/outreach/send — fire-and-forget outreach (async, returns immediately) */
export async function sendContactOutreach(
  contactId: string,
  dryRun = false,
  onStateUpdate?: (update: Partial<OutreachState>) => void,
): Promise<{ ok: boolean; message: string }> {
  try {
    const resp: any = await withTimeout(
      () => apiClient.post('/outreach/send', { contactId, dryRun }),
      45_000,
    );
    // apiClient returns full Axios response — unwrap .data
    const body = resp?.data ?? resp;
    return { ok: Boolean(body?.success), message: body?.message ?? 'Email queued for sending.' };
  } catch (err: any) {
    return {
      ok: false,
      message: (err?.response?.data as any)?.error ?? err?.message ?? 'Request failed.',
    };
  }
}

/** GET /api/contacts — list all contacts (unwrap Axios response) */
export async function fetchOutreachContacts(
  onStateUpdate?: (update: Partial<OutreachState>) => void,
): Promise<void> {
  try {
    const raw: any = await withTimeout(
      () => apiClient.get<any>('/contacts?pageSize=200'),
      30_000,
    );
    const body = raw?.data ?? raw;
    const items: any[] = Array.isArray(body?.data) ? body.data : (Array.isArray(body) ? body : []);
    // Deduplicate by contact id to prevent React "duplicate key" warnings
    const seen = new Map<string, any>();
    for (const item of items) {
      const id = item?.id ?? item?.contact?.id;
      if (id && !seen.has(id)) seen.set(id, item);
    }
    onStateUpdate?.({ contacts: [...seen.values()], loading: false, contactsError: null });
  } catch (err: any) {
    onStateUpdate?.({ contactsError: err?.message ?? 'Failed to load contacts.', loading: false });
  }
}

/** GET /api/outreach/logs — fetch email logs (backend returns plain JSON array) */
export async function fetchEmailLogs(
  onStateUpdate?: (update: Partial<OutreachState>) => void,
): Promise<void> {
  try {
    const resp: any = await withTimeout(
      () => apiClient.get<any[]>('/outreach/logs'),
      30_000,
    );
    const body = resp?.data ?? resp;
    const logs: any[] = Array.isArray(body?.value) ? body.value : (Array.isArray(body) ? body : []);
    onStateUpdate?.({
      emailLogs:    logs,
      logsLoading:  false,
      logsError:    null,
    });
  } catch (err: any) {
    onStateUpdate?.({ logsError: err?.message ?? 'Failed to load email logs.', logsLoading: false });
  }
}
