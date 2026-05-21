'use client';
import { useState, useEffect } from 'react';
import Modal from '@/components/ui/Modal';
import type { Product } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  onRun: (payload: { productIds: string[]; targetChannel: string }) => void;
}

export default function MarketingModal({ open, onClose, onRun }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [channel, setChannel] = useState('all');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setLoading(true);
      fetch('/api/products?pageSize=50')
        .then((res) => res.json())
        .then((data: any) => {
          const productList = data?.data ?? data?.products ?? [];
          setProducts(productList);
          // Auto-select first 3 products if none selected
          if (productList.length > 0 && selected.length === 0) {
            setSelected(productList.slice(0, 3).map((p: any) => p.id));
          }
        })
        .catch(() => setProducts([]))
        .finally(() => setLoading(false));
    }
  }, [open]);

  const toggleProduct = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  return (
    <Modal open={open} onClose={onClose} title="Generate Marketing Campaign">
      <div className="space-y-4">
        {loading ? (
          <p className="text-sm text-gray-500">Loading products...</p>
        ) : products.length === 0 ? (
          <p className="text-sm text-gray-500">No products available. Please scrape some first.</p>
        ) : (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Select Products</label>
              <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
                {products.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.includes(p.id)}
                      onChange={() => toggleProduct(p.id)}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Target Channel</label>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">All Channels</option>
                <option value="email">Email</option>
                <option value="social">Social Media</option>
                <option value="ads">Ad Copy</option>
              </select>
            </div>
          </>
        )}
        <button
          onClick={() => {
            // If no products selected, send empty array to trigger fallback (uses recent products)
            onRun({ productIds: selected.length > 0 ? selected : [], targetChannel: channel });
          }}
          disabled={loading || products.length === 0}
          className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
        >
          Generate Campaign{selected.length > 0 ? ` (${selected.length} product${selected.length !== 1 ? 's' : ''})` : ' (Recent Products)'}
        </button>
      </div>
    </Modal>
  );
}
