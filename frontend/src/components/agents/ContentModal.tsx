'use client';
import { useState } from 'react';
import Modal from '@/components/ui/Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  onRun: (payload: { type: string; keywords: string[]; productIds?: string[] }) => void;
}

export default function ContentModal({ open, onClose, onRun }: Props) {
  const [type, setType] = useState('blog');
  const [keywords, setKeywords] = useState('');

  const handleRun = () => {
    const kwArray = keywords.split(',').map((k) => k.trim()).filter(Boolean);
    onRun({ type, keywords: kwArray });
  };

  return (
    <Modal open={open} onClose={onClose} title="Create Content">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Content Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="blog">Blog Article</option>
            <option value="product_guide">Product Guide</option>
            <option value="company_profile">Company Profile</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Keywords (comma separated)</label>
          <input
            type="text"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="e.g. B2B e-commerce, wholesale"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <button
          onClick={handleRun}
          className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          Generate Content
        </button>
      </div>
    </Modal>
  );
}
