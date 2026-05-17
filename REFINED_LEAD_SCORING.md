# Refined Lead Scoring Algorithm for Sokogate Agent

## 1. Objective
To prioritize market leads by assigning a quantitative score based on supplier trust, price efficiency, market demand, and strategic category value.

## 2. Category Weights (W_cat)
The following weights have been assigned based on market demand and strategic importance for the African B2B market:

| Category | Weight (W_cat) | Justification |
| :--- | :--- | :--- |
| **Electronics** | 1.5 | High demand, high unit value, strong resale market. |
| **Agriculture & Food** | 1.4 | Critical sector, high volume, essential goods. |
| **Machinery & Parts** | 1.4 | Industrial equipment is key for economic growth. |
| **Health & Personal Care** | 1.3 | High demand for pharmaceuticals and hygiene products. |
| **Auto Parts & Transportation** | 1.2 | Huge market for vehicle maintenance and logistics. |
| **Electronic Equipment & Supply** | 1.2 | Infrastructure components for tech and energy. |
| **Home, Lights & Construction** | 1.1 | Supports urban development and housing. |
| **Apparel & Fabrics** | 1.0 | Standard B2B commodity, high competition. |
| **Bags, Shoes & Accessories** | 1.0 | Standard consumer goods. |
| **Sports, Gifts & Toys** | 0.9 | Non-essential/seasonal demand. |
| **Other / General** | 1.0 | Default weight for unmapped categories. |

## 3. Demand Proxy Metrics (DF)
The Demand Factor (**DF**) is a normalized score (0-1) derived from the following scraped metrics:
1. **Transaction Volume (V_trans):** Number of orders completed.
2. **Page Views (PV):** Total number of times the product page was visited.
3. **Buyer Count (N_buyers):** Number of unique businesses that have purchased the item.
4. **Recency (R_days):** Number of days since the last transaction (inverse relationship).

**DF Calculation:**
`DF = (0.4 * V_norm) + (0.3 * PV_norm) + (0.3 * N_norm)`
*Where V_norm, PV_norm, and N_norm are values normalized against the category maximum.*

## 4. Final Scoring Formula (TS)
**TS = (0.4 * SR) + (0.3 * PE) + (0.2 * DF) + (0.1 * CW)**

- **SR (Supplier Rating):** `rating / 5.0`
- **PE (Price Efficiency):** `(Avg_Cat_Price - Price) / Avg_Cat_Price` (Capped at 1.0, items significantly below average score higher).
- **DF (Demand Factor):** Calculated from proxy metrics.
- **CW (Category Weight):** Normalized `W_cat / 1.5`.

## 5. Priority Action Tiers
- **Tier 1 (Hot): TS > 0.85** -> Automated direct outreach to supplier & top buyers.
- **Tier 2 (Warm): TS 0.60 - 0.85** -> Feature in "State of African Trade" reports.
- **Tier 3 (Neutral): TS < 0.60** -> Store in database for aggregate analysis.

## 6. Engineer Implementation Notes
- Use the `categories` table to store `W_cat`.
- Scraper should prioritize extracting "Transaction History" and "View Count" from product pages.
- Lead scoring script should run as a post-processing job after the daily crawl.
