/**
 * Stub types mirroring backend/src/types/index.ts
 * These are kept local to the agent workspace to avoid a cross-workspace TypeScript dependency.
 * The object shapes are intentionally identical so the upsert contract is identical.
 */

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
