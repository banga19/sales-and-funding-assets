/**
 * useProductList
 *
 * Fetches the product catalogue from GET /api/products.
 * Returns a no-args `refresh()` (safe as an event handler) and
 * `refreshWithOpts(opts?)` for callers that need to change sort/limit.
 */

import { useState, useCallback, useEffect } from 'react';
import { apiClient } from '@/api/client';
import type { Product, SortKey } from '@/types';

interface UseProductListOptions {
  sortBy?:   SortKey;
  page?:     number;
  pageSize?: number;
}

interface UseProductListResult {
  products:        Product[];
  loading:         boolean;
  error:           string | null;
  refresh:         () => void;               // safe for onClick
  refreshWithOpts: (opts?: UseProductListOptions) => void;
}

export function useProductList(opts: UseProductListOptions = {}): UseProductListResult {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  const doFetch = useCallback(async (fetchOpts?: UseProductListOptions) => {
    setLoading(true);
    setError(null);
    try {
      const {
        sortBy     = opts.sortBy ?? 'trending',
        page       = opts.page     ?? 1,
        pageSize   = opts.pageSize ?? 24,
      } = fetchOpts ?? {};
      const qs = new URLSearchParams({ sort: sortBy, page: String(page), limit: String(pageSize) });
      const resp: any = await apiClient.get(`/products?${qs}`);
      setProducts(Array.isArray(resp?.data) ? resp.data : []);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to load products.');
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [opts.sortBy, opts.page, opts.pageSize]);

  useEffect(() => { void doFetch(); }, [doFetch]);

  const refresh         = useCallback(() => doFetch(), [doFetch]);
  const refreshWithOpts = useCallback((o?: UseProductListOptions) => doFetch(o), [doFetch]);

  return { products, loading, error, refresh, refreshWithOpts };
}
