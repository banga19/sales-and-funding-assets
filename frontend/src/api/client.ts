/**
 * ApiClient — single Axios instance for all API calls.
 *
 * Routes served by the Agent at localhost:3002:
 *   GET  /api/health        → health with per-check status (503 = partial failure)
 *   GET  /api/status        → agent config: features, rateLimits, uptime
 *   POST /api/agent/trigger → manual action trigger
 *   GET  /api/agent/status
 *   GET  /api/agent/meeting/stats
 *   POST /api/agent/outreach/trigger
 *   GET  /api/agent/outreach/stats
 *   POST /api/agent/outreach/pause/:id
 *   POST /api/agent/outreach/resume/:id
 *   POST /api/agent/followup/trigger
 *   GET  /api/agent/followup/stats
 *   POST /api/agent/meeting/suggest/:id
 *   POST /api/agent/meeting/confirm/:id
 *   POST /api/agent/meeting/reminders/trigger
 *   GET  /api/agent/metrics
 *   GET  /api/agent/metrics/summary
 *   POST /api/agent/metrics/sync
 *   GET  /api/agent/conversations/:id
 *   GET  /api/agent/scheduled-actions
 *
 * Routes served by the Backend at localhost:3000:
 *   GET  /health            → bare health (no /api prefix)
 *   GET  /status            → basic status (no features, no rateLimits)
 *   GET  /api/contacts      → contact CRUD, pipeline stages, messages
 *   GET  /api/metrics       → metrics for a date range
 *   GET  /api/metrics/summary
 *   POST /api/metrics/sync
 *
 * Vite dev proxy (frontend/vite.config.ts → server.proxy['/api']):
 *   /api/*  → http://localhost:3002  (Agent — the fully-featured endpoint)
 *
 * Production:
 *   VITE_API_BASE_URL must be a full URL, e.g.
 *     https://api.sokogate.com   (baseURL='/')  or
 *     https://api.sokogate.com/api  (baseURL='/api')
 *
 *   When baseURL='/api'  →  axios.get('/status') resolves to
 *   https://api.sokogate.com/api/status
 */

import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import type { ProductListResponse, ScrapeStatusResponse } from '../types';

/**
 * Api base URL:
 * - Default: '/api' (Vite dev proxy) → avoids external network issues.
 * - Some environments may inject an external IP/host (e.g. http://172.65.x.x) which can
 *   cause Connect Timeout on restricted networks. To make environments resilient,
 *   we auto-fallback to '/api' unless explicitly allowed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

const API_BASE_URL: string = !ALLOW_EXTERNAL_API_BASE_URL && shouldFallbackToProxy(RAW_API_BASE_URL) ? '/api' : RAW_API_BASE_URL;

const API_TIMEOUT: number = parseInt((import.meta.env as any).VITE_API_TIMEOUT ?? '30000', 10);
const DEBUG: boolean = (import.meta.env as any).VITE_DEBUG === '1' || (import.meta.env as any).DEV === true;

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: API_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor — inject JWT token
    this.client.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        const token =
          typeof localStorage !== 'undefined'
            ? localStorage.getItem('token')
            : null;
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        if (DEBUG) console.debug(`[API] ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error: AxiosError) => {
        if (DEBUG) console.debug('[API] Request error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor — handle auth errors + refresh tokens
    this.client.interceptors.response.use(
      (response) => {
        if (DEBUG) console.debug(`[API] Response ${response.status}`);
        return response;
      },
      async (error: AxiosError) => {
        if (DEBUG) console.debug('[API] Response error:', error.response?.data || error.message);
        if (error.response?.status === 401 && !(error.config as any)?._retry) {
          (error.config as any)._retry = true;
          try {
            const refreshToken =
              typeof localStorage !== 'undefined'
                ? localStorage.getItem('refreshToken')
                : null;
            if (!refreshToken) throw new Error('No refresh token');
            const { data } = await this.client.post('/auth/refresh', { refreshToken });
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem('token', data.accessToken ?? data.token);
            }
            if (error.config?.headers) {
              error.config.headers.Authorization = `Bearer ${data.accessToken ?? data.token}`;
            }
            return this.client.request(error.config as InternalAxiosRequestConfig);
          } catch {
            if (typeof localStorage !== 'undefined') {
              localStorage.removeItem('token');
              localStorage.removeItem('refreshToken');
            }
            window.location.href = '/login';
          }
        }
        return Promise.reject(error);
      }
    );
  }

  // Health check  →  GET /health   (baseURL=/api  →  /api/health)
  async getHealth(signal?: AbortSignal): Promise<any> {
    const response = await this.client.get('/health', { signal });
    return response.data;
  }

  // Agent status   →  GET /status   (baseURL=/api  →  /api/status)
  async getStatus(signal?: AbortSignal): Promise<any> {
    const response = await this.client.get('/status', { signal });
    return response.data;
  }

  // Trigger agent action  →  POST /agent/trigger
  async triggerAction(action: string, contactId: string) {
    const response = await this.client.post('/agent/trigger', {
      action,
      contact_id: contactId,
    });
    return response.data;
  }

  // Agent-specific endpoints
  async getAgentStatus() {
    const response = await this.client.get('/agent/status');
    return response.data;
  }

  async triggerOutreach() {
    const response = await this.client.post('/agent/outreach/trigger');
    return response.data;
  }

  async triggerDailyOutreach() {
    const response = await this.client.post('/agents/daily-outreach', {});
    return response.data;
  }

  async getOutreachStats() {
    const response = await this.client.get('/agent/outreach/stats');
    return response.data;
  }

  async triggerFollowUp() {
    const response = await this.client.post('/agent/followup/trigger');
    return response.data;
  }

  async getFollowUpStats() {
    const response = await this.client.get('/agent/followup/stats');
    return response.data;
  }

  async getMetrics(startDate?: Date, endDate?: Date) {
    const params = new URLSearchParams();
    if (startDate) params.append('start', startDate.toISOString());
    if (endDate) params.append('end', endDate.toISOString());
    const response = await this.client.get(`/agent/metrics?${params.toString()}`);
    return response.data;
  }

  async getMetricsSummary(days: number = 30) {
    const response = await this.client.get(`/agent/metrics/summary?days=${days}`);
    return response.data;
  }

  async getConversation(contactId: string) {
    const response = await this.client.get(`/agent/conversations/${contactId}`);
    return response.data;
  }

  async getScheduledActions(status?: string, limit?: number) {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (limit) params.append('limit', limit.toString());
    const response = await this.client.get(`/agent/scheduled-actions?${params.toString()}`);
    return response.data;
  }

  async pauseOutreach(contactId: string, reason?: string) {
    const response = await this.client.post(`/agent/outreach/pause/${contactId}`, { reason });
    return response.data;
  }

  async resumeOutreach(contactId: string) {
    const response = await this.client.post(`/agent/outreach/resume/${contactId}`);
    return response.data;
  }

  async suggestMeeting(contactId: string) {
    const response = await this.client.post(`/agent/meeting/suggest/${contactId}`);
    return response.data;
  }

  async getMeetingStats() {
    const response = await this.client.get('/agent/meeting/stats');
    return response.data;
  }

  async syncMetrics() {
    const response = await this.client.post('/agent/metrics/sync');
    return response.data;
  }

// ─── Product Scraping ─────────────────────────────────────────────────────────
  /**
   * Trigger a crawl of sokogate.com. Uses foreground mode for synchronous execution.
   * Poll GET /products to watch progress.
   */
  async triggerScrape(baseUrl?: string, maxPages?: number): Promise<any> {
    const body: Record<string, any> = { mode: 'foreground' };
    if (baseUrl)  body.baseUrl  = baseUrl;
    if (maxPages) body.maxPages = maxPages;
    return this.client.post('/products/scrape', body);
  }

  /** GET /products  – full product catalogue */
  async getProducts(page: number = 1, pageSize: number = 20): Promise<ProductListResponse> {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    const response = await this.client.get<ProductListResponse>(`/products?${params}`);
    // Defensive: if the backend returned an error JSON instead of { data: Product[] }
    if (!Array.isArray(response.data?.data)) {
      console.warn('[ApiClient] /products unexpected response shape:', response.data);
      return { data: [], total: 0, page, pageSize, categories: [], scrapedAt: null };
    }
    return response.data;
  }

  /** GET /products/scrape/status  – live scrape progress */
  async getScrapeStatus(signal?: AbortSignal): Promise<ScrapeStatusResponse> {
    const response = await this.client.get<ScrapeStatusResponse>('/products/scrape/status', { signal });
    return response.data;
  }

  /** GET /products/:id  – single product detail */
  async getProduct(id: string): Promise<any> {
    return this.client.get(`/products/${id}`);
  }

  /** DELETE /products/:id  – remove a product from the store */
  async deleteProduct(id: string): Promise<any> {
    return this.client.delete(`/products/${id}`);
  }

  // Generic GET request
  async get<T = any>(endpoint: string): Promise<T> {
    const response = await this.client.get<T>(endpoint);
    return response.data;
  }

  // Generic POST request
  async post<T = any>(endpoint: string, data?: any): Promise<T> {
    const response = await this.client.post<T>(endpoint, data);
    return response.data;
  }

  // ─── Quick Actions ────────────────────────────────────────────────────────────

  /** POST /api/agent/email/send — send a personalized email to a single recipient */
  async sendEmail(to: string, subject: string, body: string): Promise<any> {
    return this.client.post('/agent/email/send', { to, subject, body });
  }

  /** PUT /api/agent/dry-run — toggle dry-run mode on the agent server */
  async toggleDryRun(dryRun: boolean): Promise<{ dryRun: boolean }> {
    return this.client.put('/agent/dry-run', { dryRun });
  }

  /** POST /api/agent/email/test — send a test email to confirm the email service works */
  async triggerTestEmail(to?: string, subject?: string): Promise<any> {
    const body: Record<string, any> = {};
    if (to)      body.to      = to;
    if (subject) body.subject = subject;
    return this.client.post('/agent/email/test', body);
  }

  /** GET /api/agent/logs — last N log lines from the agent */
  async getLogs(lines?: number): Promise<{ logs: any[]; total: number }> {
    const params = lines ? `?lines=${lines}` : '';
    return this.client.get(`/agent/logs${params}`);
  }

  /** GET /api/contacts — list all contacts / prospects */
  async getContacts(params?: { type?: string; stage?: string; search?: string; page?: number; pageSize?: number }): Promise<any> {
    const q = new URLSearchParams();
    if (params?.type)      q.set('type',      params.type);
    if (params?.stage)     q.set('stage',     params.stage);
    if (params?.search)    q.set('search',    params.search);
    if (params?.page)      q.set('page',      String(params.page));
    if (params?.pageSize)  q.set('pageSize',  String(params.pageSize));
    return this.client.get(`/contacts${q.toString() ? '?' + q.toString() : ''}`);
  }

  // Generic PUT request
  async put<T = any>(endpoint: string, data?: any): Promise<T> {
    const response = await this.client.put<T>(endpoint, data);
    return response.data;
  }

  // Generic DELETE request
  async delete<T = any>(endpoint: string): Promise<T> {
    const response = await this.client.delete<T>(endpoint);
    return response.data;
  }

  // ─── Feature Flags ─────────────────────────────────────────────────────────────

  /** GET /api/agent/features — returns effective flags (env + DB overlay) */
  async getFeatureFlags(): Promise<{ features: Record<string, boolean>; source: string }> {
    const response = await this.client.get('/agent/features');
    return response.data as { features: Record<string, boolean>; source: string };
  }

  /** PUT /api/agent/features/:key — persist one flag value (boolean) and return the new state */
  async toggleFeature(key: string, enabled: boolean): Promise<{ key: string; value: boolean; updated_at: string }> {
    // Sends { value: boolean } — matches the agent route's `const { value }` destructure.
    const response = await this.client.put(`/agent/features/${encodeURIComponent(key)}`, { value: enabled });
    return response.data as { key: string; value: boolean; updated_at: string };
  }
}

export const apiClient = new ApiClient();
export default apiClient;

// Made with Bob
