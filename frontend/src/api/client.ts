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

    // Request interceptor
    this.client.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error: AxiosError) => {
        console.error('[API] Request error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => {
        console.log(`[API] Response ${response.status}:`, response.data);
        return response;
      },
      (error: AxiosError) => {
        console.error('[API] Response error:', error.response?.data || error.message);
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
