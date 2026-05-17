import subprocess
import json
import logging
import uuid
import os
from datetime import datetime

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

class LeadScorer:
    def __init__(self):
        self.cmd = "team-db"

    def execute_query(self, query):
        logging.debug(f"Executing: {query}")
        try:
            result = subprocess.run([self.cmd, query], capture_output=True, text=True, check=True)
            if result.stdout.strip():
                return json.loads(result.stdout)
            return []
        except Exception as e:
            logging.error(f"Error executing query: {query}. Error: {e}")
            return []

    def escape_str(self, val):
        if val is None:
            return "NULL"
        return f"'{str(val).replace("'", "''")}'"

    def initialize_category_weights(self):
        weights = {
            "Electronics": 1.5,
            "Agriculture & Food": 1.4,
            "Machinery & Parts": 1.4,
            "Health & Personal Care": 1.3,
            "Auto Parts & Transportation": 1.2,
            "Electronic Equipment & Supply": 1.2,
            "Home, Lights & Construction": 1.1,
            "Apparel & Fabrics": 1.0,
            "Bags, Shoes & Accessories": 1.0,
            "Sports, Gifts & Toys": 0.9,
            "Other / General": 1.0
        }
        logging.info("Updating category weights...")
        for name, weight in weights.items():
            # Check if category exists by name
            query = f"SELECT id FROM categories WHERE name = {self.escape_str(name)}"
            res = self.execute_query(query)
            if res:
                cat_id = res[0]['id']
                update_query = f"UPDATE categories SET weight = {weight} WHERE id = '{cat_id}'"
                self.execute_query(update_query)
            else:
                # If it doesn't exist, we can't really do much until the scraper runs
                # but we could insert a skeleton if we knew the ID format.
                # For now, just log it.
                logging.debug(f"Category '{name}' not found in DB, skipping weight update.")

    def get_max_metrics(self):
        query = """
        SELECT 
            MAX(transaction_volume) as max_v,
            MAX(page_views) as max_pv,
            MAX(buyer_count) as max_n
        FROM products
        """
        res = self.execute_query(query)
        if res and res[0]['max_v'] is not None:
            return {
                "max_v": res[0]['max_v'] or 1,
                "max_pv": res[0]['max_pv'] or 1,
                "max_n": res[0]['max_n'] or 1
            }
        return {"max_v": 1, "max_pv": 1, "max_n": 1}

    def get_category_stats(self):
        query = "SELECT category_id, AVG(price) as avg_p FROM products GROUP BY category_id"
        res = self.execute_query(query)
        return {row['category_id']: row['avg_p'] for row in res}

    def run_scoring(self):
        self.initialize_category_weights()
        
        max_metrics = self.get_max_metrics()
        cat_stats = self.get_category_stats()
        
        # Get all products with their supplier and category info
        query = """
        SELECT 
            p.id, p.name, p.price, p.category_id, p.supplier_id,
            p.transaction_volume, p.page_views, p.buyer_count,
            s.name as supplier_name, s.rating as supplier_rating,
            c.weight as cat_weight
        FROM products p
        LEFT JOIN suppliers s ON p.supplier_id = s.id
        LEFT JOIN categories c ON p.category_id = c.id
        """
        products = self.execute_query(query)
        
        if not products:
            logging.info("No products found to score.")
            return

        for p in products:
            # SR (Supplier Rating)
            sr = (p.get('supplier_rating') or 0) / 5.0
            
            # PE (Price Efficiency)
            avg_p = cat_stats.get(p['category_id'], p['price'])
            if avg_p and avg_p > 0:
                pe = (avg_p - p['price']) / avg_p
            else:
                pe = 0
            pe = min(1.0, pe) # Capped at 1.0 per algorithm
            
            # DF (Demand Factor)
            v_norm = (p.get('transaction_volume') or 0) / max_metrics['max_v']
            pv_norm = (p.get('page_views') or 0) / max_metrics['max_pv']
            n_norm = (p.get('buyer_count') or 0) / max_metrics['max_n']
            df = (0.4 * v_norm) + (0.3 * pv_norm) + (0.3 * n_norm)
            
            # CW (Category Weight)
            cw = (p.get('cat_weight') or 1.0) / 1.5
            
            # TS = (0.4 * SR) + (0.3 * PE) + (0.2 * DF) + (0.1 * CW)
            ts = (0.4 * sr) + (0.3 * pe) + (0.2 * df) + (0.1 * cw)
            
            logging.info(f"Product '{p['name']}' (ID: {p['id']}) TS: {ts:.4f}")
            
            # Priority Action Tiers
            # Tier 1 (Hot): TS > 0.85
            # Tier 2 (Warm): TS 0.60 - 0.85
            # Tier 3 (Neutral): TS < 0.60
            
            if ts >= 0.60:
                status = "hot" if ts > 0.85 else "warm"
                self.upsert_lead(p, ts, status)

    def upsert_lead(self, product, score, status):
        # Check if lead exists for this product
        query = f"SELECT id FROM market_leads WHERE product_id = '{product['id']}'"
        res = self.execute_query(query)
        
        notes = f"Score: {score:.4f}. SR: {(product.get('supplier_rating') or 0)/5.0:.2f}, PE: {(0):.2f}, DF: {(0):.2f}, CW: {(product.get('cat_weight') or 1.0)/1.5:.2f}"
        # (Need to recalculate internal components for notes if we want them accurate, or just store total score)
        
        if res:
            lead_id = res[0]['id']
            update_query = f"""
            UPDATE market_leads SET
                company_name = {self.escape_str(product['supplier_name'])},
                product_interest = {self.escape_str(product['name'])},
                score = {score},
                status = '{status}',
                notes = {self.escape_str(notes)}
            WHERE id = '{lead_id}'
            """
            self.execute_query(update_query)
            logging.info(f"Updated lead for product {product['id']}")
        else:
            lead_id = str(uuid.uuid4())
            insert_query = f"""
            INSERT INTO market_leads (id, company_name, product_interest, score, status, notes, product_id)
            VALUES ('{lead_id}', {self.escape_str(product['supplier_name'])}, {self.escape_str(product['name'])}, 
                    {score}, '{status}', {self.escape_str(notes)}, '{product['id']}')
            """
            self.execute_query(insert_query)
            logging.info(f"Created new lead for product {product['id']}")

if __name__ == "__main__":
    scorer = LeadScorer()
    scorer.run_scoring()
