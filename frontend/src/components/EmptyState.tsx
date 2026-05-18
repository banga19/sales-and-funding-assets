/**
 * EmptyState
 *
 * Shared empty-state helper — a left-aligned title + subtitle
 * inside a light gray card, used when the product grid (or another
 * section) has no data yet.
 */

import { Package } from 'lucide-react';

export default function EmptyState({ message }: { message: string }) {
  return (
    <div className="bg-gray-50 rounded-xl py-10 text-center">
      <Package className="w-10 h-10 mx-auto mb-3 text-gray-300" />
      <p className="text-gray-500 text-sm">{message}</p>
    </div>
  );
}
