/**
 * ApiClient — single Axios instance for all backend calls.
 *
 * Environment variables (Vite-safe, via import.meta.env):
 *   VITE_API_BASE_URL  — full URL (prod) or empty string (dev, Vite proxy handles routing)
 *   VITE_API_TIMEOUT   — request timeout in ms (default 10 000)
 *
 * Dev workflow:
 *   Frontend (localhost:3001)
 *     └─ Vite proxy  /api/*  ──────────────────►  Backend (localhost:3000/api/*)
 *
 * Production workflow:
 *   Frontend (Vercel / static host)
 *     └─ axios        /api/*  ──────────────────►  Backend (/api proxy path)
 *                                                (VITE_API_BASE_URL must be a full URL)
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

  // Health check
  async getHealth() {
    const response = await this.client.get('/health');
    return response.data;
  }

  // Agent status
  async getStatus() {
    const response = await this.client.get('/status');
    return response.data;
  }

  // Trigger agent action
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
