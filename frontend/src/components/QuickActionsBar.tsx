import { Mail, FileText, Users } from 'lucide-react';

interface Props {
  onEmailClick: () => void;
  onLogsClick: () => void;
  onContactsClick: () => void;
}

export default function QuickActionsBar({ onEmailClick, onLogsClick, onContactsClick }: Props) {
  const buttons = [
    { icon: Mail, label: 'Send Test Email', action: onEmailClick },
    { icon: FileText, label: 'View Logs', action: onLogsClick },
    { icon: Users, label: 'View Contacts', action: onContactsClick },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {buttons.map(({ icon: Icon, label, action }) => (
        <button
          key={label}
          onClick={action}
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors shadow-sm"
        >
          <Icon className="w-4 h-4 text-gray-400" />
          {label}
        </button>
      ))}
    </div>
  );
}
