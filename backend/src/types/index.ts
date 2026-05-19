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
  // ── Outreach-specific fields ────────────────────────────────────────────────
  persona?: string;                    // e.g. "b2b_customer", "investor", "procurement_manager"
  status?: string;                     // "new" | "researched" | "email_sent" | "failed"
  research?: Record<string, any>;
  lastContactDate?: string;
  nextFollowupDate?: string;
  outreach_status?: 'none' | 'emailed' | 'replied' | 'bounced';
  emails_sent?: number;
  last_contacted?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// Message
export interface Message {
  id: string;
  contactId: string;
  channel: 'email';
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
    nvidia: boolean;
   };
 }

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
    email: { remaining: number; limit: number };
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
  weightGrams?:      number | null;
  trendingScore?:    number | null;
  b2bSuitable?:      boolean | null;
  originCountry?:    string | null;
  shippingEst?:      string | null;
  subcategory?:      string | null;
  sourceId?:         string | null;
  // ─── B2B extensions ──────────────────────────────────────────────────────────
  moq?:              number | null;             // minimum order quantity (units)
  airDeliveryDays?:  string | null;             // e.g. "7-15"
  seaDeliveryDays?:  string | null;             // e.g. "45-75"
  supplierName?:     string | null;
  supplierVerified?: boolean | null;
  galleryUrls?:      string[];
  specs?:            Record<string, string> | null;
  b2bPriceTier?:     Array<{
    id?:              string;
    min_qty:          number;
    max_qty:          number | null;
    unit_price:       number;
    discount_percent: number;
  }> | null;
  sourcePlatform?:   string | null;             // e.g. "sokogate.com"
  volumeCbm?:        number | null;
  translationMap?:   Record<string, string> | null;
}

// Made with Bob
