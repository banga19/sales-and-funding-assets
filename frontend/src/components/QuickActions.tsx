/**
 * QuickActions
 *
 * Thin orchestration shell: renders the existing QuickActionsCard (which owns
 * all fetch/fetching state) and wires each action to its paired modal / drawer.
 *
 * QuickActions owns no data-fetching logic of its own — it still delegates to
 * the `useQuickActions` hook so QuickActionsCard receives the signal props it
 * expects.  Modal open/close is local state in this wrapper.
 */

import { useState } from 'react';
import { useQuickActions } from '@/hooks/useQuickActions';
import { QuickActionsCard, TestEmailModal, LogsDrawer, ContactsDrawer } from '@/components';

export default function QuickActions() {
  const { loadingAction, emailResult, logs, logsError, fetchLogs, sendTestEmail, resetEmail } =
    useQuickActions(false /* contactsOpen — unused stubs below */, () => {});
  const [emailOpen,    setEmailOpen]    = useState(false);
  const [logsOpen,     setLogsOpen]     = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6 space-y-4">
      <QuickActionsCard
        emailResult    = {emailResult ?? null}
        logs           = {logs     ?? null}
        logsError      = {logsError ?? null}
        loadingAction  = {loadingAction}
        onSendTestEmail={() => { setEmailOpen(true);   void sendTestEmail();   }}
        onViewLogs     ={()  => { setLogsOpen(true);    void fetchLogs();       }}
        onOpenContacts ={()  => setContactsOpen(true)}
        onResetEmail   = {resetEmail}
      />
      <TestEmailModal  open={emailOpen}    onClose={() => setEmailOpen(false)} />
      <LogsDrawer      open={logsOpen}     onClose={() => setLogsOpen(false)} />
      <ContactsDrawer  open={contactsOpen} onClose={() => setContactsOpen(false)} />
    </div>
  );
}
