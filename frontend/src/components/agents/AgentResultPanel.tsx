import { CheckCircle, XCircle, FileText, Mail, Briefcase, Zap, RefreshCw } from 'lucide-react';

interface Props {
  agentKey: string;
  result: any;
  onClose: () => void;
  onRetry?: () => void;
}

export default function AgentResultPanel({ agentKey, result, onClose, onRetry }: Props) {
  if (!result) return null;
  const hasError = result.error || !result.success;

  const renderContent = () => {
    if (hasError) return <ErrorMessage message={result.error || 'Unknown error'} onRetry={onRetry} />;
    switch (agentKey) {
      case 'bulk-sourcing':
        return <BulkResult data={result} />;
      case 'sales-marketing':
        return <MarketingResult data={result} />;
      case 'content-creation':
        return <ContentResult data={result} />;
      case 'funding':
        return <FundingResult data={result} />;
      default:
        return <RawJson data={result} />;
    }
  };

  return (
    <div className="mt-4 border border-gray-200 rounded-xl p-4 bg-gray-50 relative">
      <button
        onClick={onClose}
        className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 transition-colors"
        aria-label="Close results"
      >
        <XCircle className="w-4 h-4" />
      </button>
      <div className="flex items-center gap-2 mb-3">
        {agentIcons[agentKey]}
        <span className="text-sm font-medium text-gray-700 capitalize">
          {agentKey.replace(/-/g, ' ')}
        </span>
        {!hasError && <CheckCircle className="w-4 h-4 text-emerald-500" />}
        {hasError && <XCircle className="w-4 h-4 text-red-400" />}
      </div>
      {renderContent()}
    </div>
  );
}

const agentIcons: Record<string, React.ReactNode> = {
  'bulk-sourcing': <Zap className="w-4 h-4 text-indigo-500" />,
  'sales-marketing': <Mail className="w-4 h-4 text-indigo-500" />,
  'content-creation': <FileText className="w-4 h-4 text-indigo-500" />,
  'funding': <Briefcase className="w-4 h-4 text-indigo-500" />,
};

function ErrorMessage({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="text-sm text-red-600">
      <p>{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 underline"
        >
          <RefreshCw className="w-3 h-3" /> Retry
        </button>
      )}
    </div>
  );
}

function BulkResult({ data }: { data: any }) {
  const productsSaved = data.productsUpserted ?? data.productsSaved ?? data.count ?? 0;
  const pagesCrawled = data.pagesCrawled ?? data.steps?.scraping?.pages ?? 0;
  const enriched = data.enrichedCount ?? data.enriched ?? 0;
  return (
    <div className="text-sm text-gray-600 space-y-1">
      <p>
        <span className="font-medium text-gray-700">Products Saved:</span>{' '}
        {productsSaved}
      </p>
      {enriched > 0 && (
        <p>
          <span className="font-medium text-gray-700">AI Enrichment:</span>{' '}
          {enriched} products
        </p>
      )}
      {pagesCrawled > 0 && (
        <p>
          <span className="font-medium text-gray-700">Pages Crawled:</span> {pagesCrawled}
        </p>
      )}
      {data.errors && data.errors.length > 0 && (
        <p className="text-xs text-red-500 mt-1">Errors: {data.errors.join(', ')}</p>
      )}
    </div>
  );
}

function MarketingResult({ data }: { data: any }) {
  const assets = data.assets || [];
  if (assets.length === 0) return <p className="text-sm text-gray-600">No assets generated.</p>;
  return (
    <div className="space-y-2 max-h-48 overflow-y-auto">
      {assets.map((asset: any, i: number) => (
        <div key={i} className="text-sm bg-white rounded-lg p-2.5 border border-gray-200">
          <p className="font-medium text-gray-700">{asset.product}</p>
          <p className="text-xs text-indigo-600 mb-1 uppercase tracking-wide">{asset.type}</p>
          <p className="text-gray-500 text-xs line-clamp-2">{asset.content ?? 'No preview available.'}</p>
        </div>
      ))}
    </div>
  );
}

function ContentResult({ data }: { data: any }) {
  const piece: { title?: string; body?: string; type?: string; createdAt?: string; imageUrls?: string[] } = {
    title: data.title || '',
    body:  data.body  || '',
    type:  data.type  || '',
    imageUrls: data.imageUrls || [],
  };
  if (!piece.title) return <p className="text-sm text-gray-600">No content generated.</p>;
  return (
    <div className="space-y-2">
      <h4 className="font-medium text-gray-700 text-sm">{piece.title}</h4>
      <p className="text-xs text-gray-500">
        {piece.type || 'generated'} · {new Date(piece.createdAt || Date.now()).toLocaleDateString()}
      </p>
      {piece.imageUrls && piece.imageUrls.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {piece.imageUrls.map((url: string, i: number) => (
            <img
              key={i}
              src={url}
              alt={`Generated image ${i + 1}`}
              className="h-24 w-24 object-cover rounded-lg border border-gray-200 flex-shrink-0"
            />
          ))}
        </div>
      )}
      <div className="text-sm text-gray-600 bg-white p-3 rounded-lg border max-h-40 overflow-y-auto whitespace-pre-wrap">
        {piece.body?.substring(0, 500)}...
      </div>
    </div>
  );
}

function FundingResult({ data }: { data: any }) {
  const prospects = data.prospects || [];
  const pitchSummary = data.pitchSummary || data.pitchSummarySize ? '(Pitch generated)' : '';
  return (
    <div>
      <p className="text-sm text-gray-600 mb-2">
        Generated pitch and linked {prospects.length} prospect{prospects.length !== 1 ? 's' : ''}.
      </p>
      {pitchSummary && (
        <div className="mb-3 text-sm bg-white rounded-lg p-2.5 border border-gray-200">
          <p className="font-medium text-gray-700 mb-1">Pitch Summary</p>
          <p className="text-xs text-gray-500 whitespace-pre-wrap line-clamp-4">{pitchSummary}</p>
        </div>
      )}
      {prospects.map((p: any, i: number) => (
        <div key={p.id || i} className="text-sm bg-white rounded-lg p-2.5 border border-gray-200 mb-1">
          <p className="font-medium text-gray-700">{p.name || p.contact?.name || 'Unnamed Contact'}</p>
          <p className="text-xs text-gray-500">
            {p.firm || 'Unknown Firm'} · {p.email || 'No email'}
          </p>
          {p.fit && <p className="text-xs text-indigo-600 mt-1">{p.fit}</p>}
        </div>
      ))}
    </div>
  );
}

function RawJson({ data }: { data: any }) {
  return <pre className="text-xs text-gray-700 font-mono overflow-x-auto">{JSON.stringify(data, null, 2)}</pre>;
}
