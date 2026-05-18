// Health Check Types
export interface HealthCheck {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  checks: {
    database: {
      healthy: boolean;
      error?: string;
    };
    email: boolean;
    nvidia: boolean;
  };
}

// Agent Status Types
export interface AgentStatus {
  enabled: boolean;
  dryRun: boolean;
  features: {
    email: boolean;
    autoFollowup: boolean;
    autoScheduling: boolean;
    sentimentAnalysis: boolean;
    objectionHandling: boolean;
  };
  rateLimits: {
    email: {
      remaining: number;
      limit: number;
    };
  };
}

// Contact Types
export type ContactType = 'prospect' | 'investor' | 'partner';

// Trigger Action Types
export interface TriggerActionRequest {
  action: string;
  contact_id: string;
}

export interface TriggerActionResponse {
  success: boolean;
  message: string;
  note?: string;
}

// API Error Types
export interface ApiError {
  error: string;
  message?: string;
  path?: string;
}

// Made with Bob
