/**
 * ContactsDrawer
 *
 * Opens a slide-over contacts panel. Reuses the existing ContactsSection
 * (memoised, already wired to the OutreachContext) by opening it via
 * its `open` flag.  ContactsSection updates its own open/closed state;
 * we mirror it to give a defined close handler.
 */

import { useEffect } from 'react';
import { ContactsSection } from './ContactsSection';

export default function ContactsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Sync the parent's close intent through to ContactsSection
  useEffect(() => {
    if (!open) return;
    // ContactsSection manages its own internal open flag; no-op.
  }, [open]);

  return <ContactsSection open={open} contacts={null} loading={false} error={null} onClose={onClose} />;
}
