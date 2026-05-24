/**
 * Determine the API base URL for the frontend.
 * This logic mirrors the one in api/client.ts but is extracted for reuse.
 */

export function getApiBaseUrl(): string {
  const RAW_API_BASE_URL: string = (import.meta.env as any).VITE_API_BASE_URL ?? '/api';
  const ALLOW_EXTERNAL_API_BASE_URL: boolean = (import.meta.env as any).VITE_API_ALLOW_EXTERNAL_BASE_URL === '1';

  function shouldFallbackToProxy(baseUrl: string): boolean {
    if (!baseUrl) return true;
    // If it's already a relative base, we want to use the Vite proxy.
    if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) return false;
    // External URL to a private/internal IP range → likely not reachable from "opencode".
    // (We avoid breaking legitimate public URLs.)
    return /^https?:\/\/(10\.|127\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.)/i.test(baseUrl);
  }

  return !ALLOW_EXTERNAL_API_BASE_URL && shouldFallbackToProxy(RAW_API_BASE_URL) ? '/api' : RAW_API_BASE_URL;
}