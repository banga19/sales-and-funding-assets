/**
 * useProductList
 *
 * React hook that fetches the full product catalog from
 * GET /api/products using the agent proxy (/api → :3002).
 * Includes an on-demand refresh function so parent components
 * can trigger a refetch after a scrape completes.
 */

import { useState, useCallback, useEffect } from 'react';
import { apiClient } from '@/api/client';
import type { Product } from '@/types';

interface UseProductListResult {
  products:  Product[];
  loading:   boolean;
  error:     string | null;
  refresh:   () => void;
}

export function useProductList(): UseProductListResult {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp: any = await apiClient.get('/products');
      setProducts(Array.isArray(resp?.data) ? resp.data : []);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to load products.');
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetch(); }, [fetch]);

  return { products, loading, error, refresh: fetch };
}
