import axios, { AxiosInstance, AxiosError } from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000/api';
const API_TIMEOUT = parseInt(process.env.REACT_APP_API_TIMEOUT || '10000', 10);

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_URL,
      timeout: API_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor — inject JWT token
    this.client.interceptors.request.use(
      (config: any) => {
        if (typeof localStorage !== 'undefined') {
          const token = localStorage.getItem('token');
          if (token) config.headers.Authorization = `Bearer ${token}`;
        }
        console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error: AxiosError) => {
        console.error('[API] Request error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor — handle auth errors + attempt silent refresh
    this.client.interceptors.response.use(
      (response: any) => {
        console.log(`[API] Response ${response.status}:`, response.data);
        return response;
      },
      async (error: AxiosError) => {
        console.error('[API] Response error:', error.response?.data || error.message);
        if (error.response?.status === 401 && !error.config._retry) {
          error.config._retry = true;
          try {
            if (typeof localStorage !== 'undefined') {
              const refreshToken = localStorage.getItem('refreshToken');
              if (!refreshToken) throw new Error('No refresh token');
              const { data } = await this.client.post('/auth/refresh', { refreshToken });
              localStorage.setItem('token', data.accessToken ?? data.token);
              error.config.headers.Authorization = `Bearer ${data.accessToken ?? data.token}`;
              return this.client.request(error.config);
            }
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
