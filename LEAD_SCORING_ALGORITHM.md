# Lead Scoring Algorithm for Sokogate Agent

## 1. Objective
To prioritize and score potential market leads extracted from Sokogate.com, allowing the sales team to focus on high-intent and high-value opportunities.

## 2. Input Parameters
The algorithm utilizes the following data points from the `products` and `suppliers` tables:
- **`S_rating` (Supplier Rating):** 0.0 to 5.0 (from `suppliers.rating`).
- **`P_price` (Product Price):** Numeric value (from `products.price`).
- **`C_avg_price` (Category Average Price):** Calculated average for the specific category.
- **`D_proxy` (Demand Proxy):** Placeholder for scraped metadata like "views" or "order count" (if available). Defaults to 1.0 if not.
- **`W_cat` (Category Weight):** Strategic importance of the category (e.g., Medical = 1.5, Electronics = 1.2, General = 1.0).

## 3. Scoring Formula
The Total Score (**TS**) is calculated as follows:

**TS = (W1 * SR) + (W2 * PE) + (W3 * DF) + (W4 * CW)**

Where:
- **SR (Supplier Rating Normalized):** `S_rating / 5.0` (Scale 0-1)
- **PE (Price Efficiency):** `(C_avg_price - P_price) / C_avg_price`. *Note: If negative (above average), it reduces the score unless it's a luxury/premium item.*
- **DF (Demand Factor):** Scraped popularity metrics normalized.
- **CW (Category Weight):** Pre-defined strategic multiplier.

### Weights (Subject to tuning):
- **W1 (Supplier Trust):** 0.4
- **W2 (Price Competitiveness):** 0.3
- **W3 (Demand/Popularity):** 0.2
- **W4 (Strategic Value):** 0.1

## 4. Priority Tiers
- **Tier 1 (Hot Leads):** Score > 0.8. Immediate automated outreach.
- **Tier 2 (Warm Leads):** Score 0.5 - 0.8. Targeted marketing campaigns.
- **Tier 3 (Cold Leads):** Score < 0.5. General newsletter inclusion.

## 5. Implementation (SQL Logic Example)
The following logic can be used to populate the `market_leads` table:

```sql
-- Conceptual query for the Engineer
SELECT 
    p.id, 
    p.name, 
    s.name as supplier,
    ( (0.4 * (s.rating / 5.0)) + 
      (0.3 * CASE WHEN p.price < avg_cat.avg_p THEN (avg_cat.avg_p - p.price)/avg_cat.avg_p ELSE 0 END) +
      (0.2 * 1.0) -- DF Placeholder
    ) as lead_score
FROM products p
JOIN suppliers s ON p.supplier_id = s.id
JOIN (SELECT category_id, AVG(price) as avg_p FROM products GROUP BY category_id) avg_cat 
  ON p.category_id = avg_cat.category_id;
```

## 6. Next Steps
- Implement the `Demand Proxy` scraper.
- Define `Category Weights` in a configuration table.
- Automate the lead generation script to run after every crawl.
