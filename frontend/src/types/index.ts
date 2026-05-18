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
    productScraping: boolean;
    playwrightScraper: boolean;
    agentsEnabled: boolean;
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
  channel: 'email';
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

// ─── Product Types ──────────────────────────────────────────────────────────────

export interface ProductSpecification {
  key:   string;
  value: string;
}

export interface Product {
  id:             string;
  name:           string;
  description:    string;
  price:          string;
  category:       string;
  images:         string[];
  specifications: ProductSpecification[];
  inStock:        boolean;
  sourceUrl:      string;
  scrapedAt:      string;
  createdAt:      string;
  updatedAt:      string;
}

export interface ProductListResponse {
  data:      Product[];
  total:     number;
  page:      number;
  pageSize:  number;
  categories: string[];
  scrapedAt: string | null;
}

export interface ScrapeTriggerResponse {
  success:   boolean;
  message:   string;
  status:    string;
  baseUrl:   string;
  maxPages:  number;
}

export interface ScrapeStatusResponse {
  success:      boolean;
  phase:        'idle' | 'discovering' | 'scraping' | 'complete' | 'error';
  message:      string;
  productCount: number;
  scrapedAt:    string | null;
  runId:        string | null;
}

// Made with Bob
