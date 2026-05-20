-- Migration 001: Initial schema
-- Creates the schema_migrations table for tracking applied migrations

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  applied_at TIMESTAMP DEFAULT NOW()
);

-- DOWN
DROP TABLE IF EXISTS schema_migrations;
