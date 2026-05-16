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
    whatsapp: boolean;
    claude: boolean;
  };
}

// Agent Status Types
export interface AgentStatus {
  enabled: boolean;
  dryRun: boolean;
  features: {
    whatsapp: boolean;
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
    whatsapp: {
      remaining: number;
      limit: number;
    } | null;
  };
}

// Contact Types
export type ContactType = 'prospect' | 'investor' | 'partner';
export type ContactStage = 'new' | 'contacted' | 'engaged' | 'qualified' | 'converted' | 'lost';

export interface Contact {
  id: string;
  type: ContactType;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  title?: string;
  stage: ContactStage;
  lastContactDate?: string;
  nextFollowupDate?: string;
  notes?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

// Message Types
export interface Message {
  id: string;
  contactId: string;
  channel: 'email' | 'whatsapp';
  direction: 'inbound' | 'outbound';
  content: string;
  subject?: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  sentAt: string;
  metadata?: Record<string, any>;
}

// Metrics Types
export interface Metrics {
  totalContacts: number;
  activeContacts: number;
  emailsSent: number;
  emailsOpened: number;
  emailsReplied: number;
  whatsappSent: number;
  whatsappReplied: number;
  meetingsScheduled: number;
  conversions: number;
  responseRate: number;
  conversionRate: number;
}

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
