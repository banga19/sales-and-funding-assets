'use client';
import { useState } from 'react';
import Modal from '@/components/ui/Modal';

const defaultCompany = {
  name: 'Ultimo Trading Company Limited',
  description: 'Parent company of Sokogate, a leading B2B e-commerce platform.',
};

interface Props {
  open: boolean;
  onClose: () => void;
  onRun: (payload: { investorProfile: string; companyDetails: Record<string, string> }) => void;
}

export default function FundingModal({ open, onClose, onRun }: Props) {
  const [profile, setProfile] = useState('vc');
  const [companyName, setCompanyName] = useState(defaultCompany.name);
  const [description, setDescription] = useState(defaultCompany.description);

  return (
    <Modal open={open} onClose={onClose} title="Generate Funding Pitch">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Investor Profile</label>
          <select
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="vc">Venture Capital</option>
            <option value="angel">Angel Investor</option>
            <option value="bank">Bank</option>
            <option value="government">Government Grant</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
          <input
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Brief Description</label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
        </div>
        <button
          onClick={() =>
            onRun({
              investorProfile: profile,
              companyDetails: { name: companyName, description },
            })
          }
          className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          Generate Pitch
        </button>
      </div>
    </Modal>
  );
}
