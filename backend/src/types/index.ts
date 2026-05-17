export type ContactType = 'prospect' | 'investor' | 'partner';
export type ContactStage = 'new' | 'contacted' | 'engaged' | 'qualified' | 'converted' | 'lost';

// ─── Shared Types ──────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

// Contact
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
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// Message
export interface Message {
  id: string;
  contactId: string;
  channel: 'email' | 'whatsapp';
  direction: 'inbound' | 'outbound';
  content: string;
  subject?: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  sentAt: string;
  metadata?: Record<string, unknown>;
}

// ─── API Response Types ─────────────────────────────────────────────────────────

export interface HealthCheck {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  checks: {
    database: { healthy: boolean; error?: string };
    email: boolean;
    whatsapp: boolean;
    claude: boolean;
  };
}

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
    email: { remaining: number; limit: number };
    whatsapp: { remaining: number; limit: number } | null;
  };
}

export interface TriggerActionResponse {
  success: boolean;
  message: string;
  note?: string;
}

export interface ApiError {
  error: string;
  message?: string;
}

// ─── Product Types ──────────────────────────────────────────────────────────────

export interface ProductSpecification {
  key:   string;
  value: string;
}

export interface Product {
  id:               string;
  name:             string;
  description:      string;
  price:            string;
  category:         string;
  images:           string[];
  specifications:   ProductSpecification[];
  inStock:          boolean;
  sourceUrl:        string;
  scrapedAt:        string;
  createdAt:        string;
  updatedAt:        string;
}

// Made with Bob
