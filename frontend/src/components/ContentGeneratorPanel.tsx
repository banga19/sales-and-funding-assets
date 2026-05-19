import React, { useState, useCallback } from 'react';
import axios from 'axios';
import { Sparkles, Copy, Check, X } from 'lucide-react';
import { toast } from 'react-hot-toast';

interface ContentGeneratorPanelProps {
  productId: string;
  onClose: () => void;
}

export default function ContentGeneratorPanel({ productId, onClose }: ContentGeneratorPanelProps) {
  const [loading, setLoading] = useState(false);
  const [outputs, setOutputs] = useState<{
    email_sequence?: string;
    social_post?: string;
    ad_copy?: string;
    landing_page?: string;
  }>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.post('/api/generate-content', { productId });
      if (data?.success) {
        setOutputs({
          email_sequence: data.email_sequence || '',
          social_post:    data.social_post    || '',
          ad_copy:        data.ad_copy        || '',
          landing_page:   data.landing_page   || '',
        });
        toast.success('Content generated!');
      } else {
        toast.error(data?.error || 'Generation failed');
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Generation failed');
    } finally {
      setLoading(false);
    }
  }, [productId]);

  const copyToClipboard = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
      toast.success('Copied!');
    } catch {
      toast.error('Copy failed');
    }
  }, []);

  const fields: Array<{ key: keyof typeof outputs; label: string }> = [
    { key: 'email_sequence', label: 'Email Sequence' },
    { key: 'social_post',    label: 'Social Post' },
    { key: 'ad_copy',        label: 'Ad Copy' },
    { key: 'landing_page',   label: 'Landing Page' },
  ];

  return (
    <div className="border rounded-xl p-4 bg-purple-50/50 shadow-sm mt-4 mx-6 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-800 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-600" />
          AI Content Generator
        </h3>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-purple-100 text-gray-500"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <button
        onClick={generate}
        disabled={loading}
        className="mb-4 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors"
      >
        <Sparkles className="inline w-4 h-4 mr-1.5" />
        {loading ? 'Generating…' : 'Generate Content'}
      </button>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {fields.map(({ key, label }) => (
          <div key={key} className="flex flex-col">
            <label className="text-xs font-medium text-gray-600 mb-1 flex items-center justify-between">
              {label}
              {outputs[key] && (
                <button
                  type="button"
                  onClick={() => copyToClipboard(outputs[key]!, key)}
                  className="inline-flex items-center gap-1 text-purple-600 hover:text-purple-800"
                >
                  {copiedKey === key ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copiedKey === key ? 'Copied' : 'Copy'}
                </button>
              )}
            </label>
            <textarea
              value={(outputs as any)[key] || ''}
              onChange={(e) => setOutputs(prev => ({ ...prev, [key]: e.target.value }))}
              rows={3}
              className="w-full border border-purple-200 rounded-lg p-2 text-sm bg-white focus:ring-2 focus:ring-purple-400 focus:border-purple-400 outline-none resize-none"
              placeholder={loading ? 'Generating…' : 'Click Generate'}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
