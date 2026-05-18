# Agents for Ultimo Trading Company Limited

This directory contains a suite of autonomous sub-agents designed for bulk product sourcing,
sales & marketing generation, content creation, and funding generation. All agents run within the
agent Express server at `localhost:3002` and can be triggered via API endpoints or the dashboard UI.

## Architecture

- Each sub-agent is an API route under `/api/agents/`.
- They can be invoked manually through the UI or scheduled externally.
- Agents share common resources: PostgreSQL database, NVIDIA AI API, and the Sokogate scraping engine.
- Results are persisted in the database and surfaced in the frontend.

## Sub-Agents

### 1. Bulk Product Sourcing
- **Endpoint:** `POST /api/agents/bulk-sourcing`
- **Description:** Crawls multiple pages of sokogate.com, extracts product data in bulk, and stores it in `scraped_products`. Optionally enriches descriptions using NVIDIA AI.
- **Parameters:**
  - `pages` (number, default 3): Number of listing pages to crawl.
  - `enrichWithAI` (boolean): If true, use NVIDIA API to rewrite and improve product descriptions.

### 2. Sales & Marketing Generation
- **Endpoint:** `POST /api/agents/sales-marketing`
- **Description:** Generates a complete marketing campaign for a given product or product category. Uses NVIDIA API to produce email sequences, social media posts, ad copy, and a landing page draft.
- **Parameters:**
  - `productIds` (string[]): Array of product IDs to base the campaign on.
  - `targetChannel` (string): "email" | "social" | "ads" | "all".
- **Response:** Returns an array of generated assets, each saved as a `marketing_assets` record.

### 3. Content Creation
- **Endpoint:** `POST /api/agents/content-creation`
- **Description:** Creates blog articles, product guides, or company profiles. Input can be a topic, a set of product references, or a persona brief.
- **Parameters:**
  - `type` ("blog" | "product_guide" | "company_profile").
  - `keywords` (string[]).
  - `productIds` (optional, for guides).
- **Response:** Stores generated content in `content_pieces` and returns it.

### 4. Funding Generation
- **Endpoint:** `POST /api/agents/funding`
- **Description:** Researches potential investors, generates a tailored pitch deck summary and email outreach sequence. Uses the contact database and NVIDIA API.
- **Parameters:**
  - `investorProfile` (string): "angel" | "vc" | "bank" | "government".
  - `companyDetails` (object): Company info to include in the pitch.
- **Response:** Creates `investor_prospects` records and launches an outreach pipeline.

## Configuration
Agent settings (API keys, default parameters) are stored in `agent/src/config/agent.config.ts` and can be overridden per request.
The `agentsEnabled` feature flag in `feature_flags` controls whether the Agent Panel is visible in the frontend UI.

## Scheduling & Bulk Execution
For truly autonomous operation, agents can be triggered by external cron jobs calling the same API endpoints.
This file acts as documentation for any external orchestrator (e.g., GitHub Actions, custom scheduler) to know what endpoints to call and with which parameters.

// Made with Bob
