/**
 * AbortController helpers for data-fetching hooks.
 *
 * Why not go through cancelableFetch?
 *   apiClient.getProducts(page, pageSize) and apiClient.getScrapeStatus()
 *   do not accept AbortSignal in their own signatures — wrapping them in
 *   a stubbed "(signal?) => ..." cast works at runtime but produces duplicate
 *   TS errors and subtle runtime confusion.
 *
 * This file exposes three job-safe primitives:
 *   1. cancelInFlight()  — abort any request the hook is currently in
 *   2. controller      — shared singleton; cancel() forbids outstanding calls
 *   3. signal()        — fresh AbortSignal for each new request cycle
 */

import { apiClient } from './client';
import type { ScrapeStatusResponse } from '../types';

let activeController: AbortController | null = null;

/** Abort whatever request is currently in-flight. After this call no older
 *  response can race against a newer one. */
export function cancelInFlight(): void {
  if (activeController) { activeController.abort(); activeController = null; }
}

/** Return a brand-new AbortSignal attached to the shared controller.
 *  Call cancelInFlight() to revoke it. */
function registerSignal(): AbortSignal {
  activeController = new AbortController();
  return activeController.signal;
}

/** Typed aliases — AbortSignal passed directly to axios via the `signal`
 *  option. All results are awaited by the consuming hooks. */
export const api = {
  getHealth:         (signal?: AbortSignal) => (apiClient.get as any)('/health',         { signal }),
  getStatus:         (signal?: AbortSignal) => (apiClient.get as any)('/status',         { signal }),
  getProducts:       (signal?: AbortSignal) => (apiClient.get as any)('/products',       { signal }),
  getScrapeStatus:   (signal?: AbortSignal) => (apiClient.get as any)('/products/scrape/status', { signal }),
  getLogs:           (signal?: AbortSignal) => (apiClient.get as any)('/agent/logs',      { signal }),
  getContacts:       (signal?: AbortSignal) => (apiClient.get as any)('/contacts',        { signal }),
  triggerScrape:     (signal?: AbortSignal) => (apiClient.post as any)('/products/scrape', { mode: 'foreground' }, { signal }),
  triggerTestEmail:  (signal?: AbortSignal) => (apiClient.post as any)('/agent/email/test',  {}, { signal }),
};

// Made with Bob
