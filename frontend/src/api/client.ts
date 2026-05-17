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

// RUNTIME_ENV is injected by vite.config.ts via the `define` block above.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const API_BASE_URL: string = (import.meta.env as any).VITE_API_BASE_URL ?? '/api';
const API_TIMEOUT: number = parseInt((import.meta.env as any).VITE_API_TIMEOUT ?? '10000', 10);

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
        console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error: AxiosError) => {
        console.error('[API] Request error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor — handle auth errors + refresh tokens
    this.client.interceptors.response.use(
      (response) => {
        console.log(`[API] Response ${response.status}:`, response.data);
        return response;
      },
      async (error: AxiosError) => {
        console.error('[API] Response error:', error.response?.data || error.message);
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
  async getHealth() {
    const response = await this.client.get('/health');
    return response.data;
  }

  // Agent status   →  GET /status   (baseURL=/api  →  /api/status)
  async getStatus() {
    const response = await this.client.get('/status');
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
   * Trigger a crawl of sokogate.com. Returns immediately with a 202 Accepted.
   * Poll GET /products to watch progress.
   */
  async triggerScrape(baseUrl?: string, maxPages?: number): Promise<any> {
    const body: Record<string, any> = {};
    if (baseUrl)  body.baseUrl  = baseUrl;
    if (maxPages) body.maxPages = maxPages;
    return this.client.post('/products/scrape', body);
  }

  /** GET /products  – full in-memory product catalogue */
  async getProducts(page: number = 1, pageSize: number = 20): Promise<any> {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    return this.client.get(`/products?${params}`);
  }

  /** GET /products/scrape/status  – live scrape progress */
  async getScrapeStatus(): Promise<any> {
    return this.client.get('/products/scrape/status');
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
}

export const apiClient = new ApiClient();
export default apiClient;

// Made with Bob
