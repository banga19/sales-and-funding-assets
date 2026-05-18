/**
 * ProductCard
 *
 * Minimal product card — image strip, name, price, and a subtle
 * hover border/shadows. All mockups in this redesign use a
 * rounded-xl + gray-50 surface aesthetic.
 */

import { ArrowUpRight } from 'lucide-react';
import type { Product } from '@/types';

export default function ProductCard({ product }: { product: Product }) {
  return (
    <div className="group bg-gray-50 rounded-xl p-4 border border-transparent hover:border-indigo-200 hover:shadow-md transition-all duration-200">
      {product.images && product.images[0] ? (
        <img
          src={product.images[0]}
          alt={product.name}
          className="w-full h-36 object-cover rounded-lg mb-3"
        />
      ) : (
        <div className="w-full h-36 rounded-lg mb-3 bg-gray-100 flex items-center justify-center text-gray-300 text-2xl">
          #
        </div>
      )}
      <h3 className="font-medium text-gray-800 text-sm line-clamp-2 leading-snug">{product.name}</h3>
      {product.price && (
        <p className="text-indigo-600 font-semibold mt-1">{product.price}</p>
      )}
      <div className="flex justify-end mt-2">
        <ArrowUpRight className="w-4 h-4 text-gray-400 group-hover:text-indigo-500 transition-colors" />
      </div>
    </div>
  );
}
