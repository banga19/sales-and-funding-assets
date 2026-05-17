# Sokogate Agent System Architecture

## Overview
A multi-agent system designed to scrape product data from sokogate.com, analyze it for sales and marketing opportunities, and identify potential funding/investment leads.

## Agent Roles
1.  **Researcher (Sourcing Agent):** Scrapes sokogate.com for product and supplier data.
2.  **Strategist (Sales & Marketing):** Analyzes data to find leads and create marketing content.
3.  **Strategist (Funding):** Identifies investment and funding opportunities.
4.  **Engineer:** System architecture, database management, and technical integrations.

## Database Schema (Turso)

### `categories`
Stores product categories.
- `id` (TEXT, PK): Unique identifier.
- `name` (TEXT): Category name.
- `parent_id` (TEXT, FK): Reference to parent category.

### `suppliers`
Stores supplier information.
- `id` (TEXT, PK): Unique identifier.
- `name` (TEXT): Supplier name.
- `contact_info` (TEXT): Contact details.
- `location` (TEXT): Supplier location.
- `rating` (REAL): Supplier rating.
- `created_at` (DATETIME): Timestamp.

### `products`
Stores product details scraped from Sokogate.
- `id` (TEXT, PK): Unique identifier.
- `name` (TEXT): Product name.
- `description` (TEXT): Product description.
- `price` (REAL): Current price.
- `currency` (TEXT): Price currency.
- `supplier_id` (TEXT, FK): Link to `suppliers`.
- `category_id` (TEXT, FK): Link to `categories`.
- `url` (TEXT): Original product URL.
- `image_url` (TEXT): Product image URL.
- `status` (TEXT): 'active' or 'discontinued'.
- `created_at` (DATETIME): Timestamp.
- `updated_at` (DATETIME): Last update timestamp.

### `market_leads`
Potential sales leads identified from the data.
- `id` (TEXT, PK): Unique identifier.
- `company_name` (TEXT): Target company.
- `contact_person` (TEXT): Contact name.
- `email` (TEXT): Contact email.
- `phone` (TEXT): Contact phone.
- `product_interest` (TEXT): Product they might be interested in.
- `status` (TEXT): 'new', 'contacted', 'converted'.
- `notes` (TEXT): Additional context.

### `marketing_campaigns`
Records of marketing efforts.
- `id` (TEXT, PK): Unique identifier.
- `title` (TEXT): Campaign title.
- `channel` (TEXT): e.g., 'email', 'social_media'.
- `content` (TEXT): Campaign copy.
- `status` (TEXT): 'draft', 'launched', 'completed'.
- `launched_at` (DATETIME): Launch timestamp.

### `funding_leads`
Potential investment sources or funding requirements.
- `id` (TEXT, PK): Unique identifier.
- `investor_name` (TEXT): Name of investor or institution.
- `type` (TEXT): 'VC', 'Angel', 'Loan', 'Grant'.
- `amount_range` (TEXT): Expected funding amount.
- `status` (TEXT): 'identified', 'contacted', 'secured'.

## Data Flow
1.  **Researcher** scrapes `sokogate.com` -> Populates `products`, `suppliers`, and `categories`.
2.  **Strategist (Sales)** queries `products` -> Identifies patterns -> Populates `market_leads`.
3.  **Strategist (Marketing)** queries `products` and `market_leads` -> Generates content -> Populates `marketing_campaigns`.
4.  **Strategist (Funding)** queries overall business activity/potential -> Populates `funding_leads`.

## Integration Points
- **Web Scraper:** Interface for Researcher to feed data into Turso.
- **Lead Generation Logic:** Scripts to analyze product trends.
- **Marketing Automation:** (Future) Integration with email/social media APIs.
