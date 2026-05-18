-- Schema for Sokogate Agent System

CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT,
    parent_id TEXT,
    FOREIGN KEY (parent_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    name TEXT,
    contact_info TEXT,
    location TEXT,
    rating REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT,
    description TEXT,
    price REAL,
    currency TEXT,
    supplier_id TEXT,
    category_id TEXT,
    url TEXT,
    image_url TEXT,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
    FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS market_leads (
    id TEXT PRIMARY KEY,
    company_name TEXT,
    contact_person TEXT,
    email TEXT,
    phone TEXT,
    product_interest TEXT,
    status TEXT DEFAULT 'new',
    notes TEXT,
    enriched_data JSONB,
    tier TEXT DEFAULT 'T1',
    type TEXT DEFAULT 'prospect',
    source TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS marketing_campaigns (
    id TEXT PRIMARY KEY,
    title TEXT,
    channel TEXT,
    content TEXT,
    status TEXT DEFAULT 'draft',
    launched_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS funding_leads (
    id TEXT PRIMARY KEY,
    investor_name TEXT,
    type TEXT,
    amount_range TEXT,
    status TEXT DEFAULT 'identified',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Feature Flags Table — durable runtime toggle state
-- Overrides the ENV default for the named feature key.
-- Each row: (key, value:bool, updated_at)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS feature_flags (
    key            TEXT PRIMARY KEY,
    value          BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_feature_flags_updated ON feature_flags(updated_at DESC);

