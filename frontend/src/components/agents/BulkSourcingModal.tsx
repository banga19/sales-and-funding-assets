'use client';
import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Toggle from '@/components/Toggle';
import { agentConfig } from '@/agent.config';

interface Props {
  open: boolean;
  onClose: () => void;
  onRun: (payload: { pages: number; enrichWithAI: boolean }) => void;
}

export default function BulkSourcingModal({ open, onClose, onRun }: Props) {
  const [pages, setPages] = useState(agentConfig.bulkSourcing.defaultPages);
  const [enrich, setEnrich] = useState(agentConfig.bulkSourcing.enrichWithAI);

  return (
    <Modal open={open} onClose={onClose} title="Bulk Product Sourcing">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Number of Pages</label>
          <input
            type="number"
            min={1}
            max={agentConfig.bulkSourcing.maxPages}
            value={pages}
            onChange={(e) => setPages(Number(e.target.value))}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">AI Enrichment</span>
          <Toggle enabled={enrich} onChange={setEnrich} />
        </div>
        <button
          onClick={() => onRun({ pages, enrichWithAI: enrich })}
          className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          Start Scraping
        </button>
      </div>
    </Modal>
  );
}
