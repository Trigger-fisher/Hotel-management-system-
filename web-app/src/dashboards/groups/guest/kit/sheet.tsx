'use client';

// Bottom sheets and the sticky action bar (decision 71).
//   GgSheet: the portal's Modal (focus trap, Esc, backdrop, the visible X) drawn as a bottom sheet on a phone (a grabber on top, slides up in 220 ms, the
//   home-indicator inset under its footer) and as a centred glass dialog on a desktop. The phone's Back button closes it (tempHistory.ts). One sheet at a time:
//   opening one closes the other.
//   GgActionBar: the page's main action with its summary ("3 bills · ₹14,689.00 · Pay"): fixed above the tab bar on a phone (guest look only), an inline
//   glass bar everywhere else (a desktop, the hotel's portal preview).
import { useEffect, useId, useRef, type ReactNode } from 'react';

import { Modal } from '@/dashboards/pallav/ui';

import { closeTempEntry, pushTempEntry } from '../../../shell/tempHistory';

/** The close function of the sheet on screen (one at a time). */
let openSheet: { id: string; close: () => void } | null = null;

export interface GgSheetProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** The sheet's buttons (the main action last); kept in view while the body scrolls. */
  footer?: ReactNode;
  /** A form sheet: header, body and footer sit in a <form>; Enter or the submit button calls it (the required fields are checked first). */
  onSubmit?: () => void;
  /** Wider on a desktop (a bill preview). */
  size?: 'md' | 'lg';
  className?: string;
}

export function GgSheet({ open, title, onClose, children, footer, onSubmit, size = 'md', className = '' }: GgSheetProps) {
  const id = useId();
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  // stays true between React's development double run of the effect, so the history entry is not stepped out of and added again
  const openRef = useRef(false);

  useEffect(() => {
    if (!open) return undefined;
    openRef.current = true;
    if (openSheet && openSheet.id !== id) openSheet.close();
    openSheet = { id, close: () => closeRef.current() };
    pushTempEntry(id, () => closeRef.current());
    return () => {
      openRef.current = false;
      if (openSheet?.id === id) openSheet = null;
      // after this commit: a page change has replaced the entry by then (nothing moves); a sheet that only closed steps back out of its entry
      window.setTimeout(() => {
        if (!openRef.current) closeTempEntry(id);
      }, 0);
    };
  }, [open, id]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size={size === 'lg' ? 'lg' : 'md'}
      className={`gg-sheet ${className}`.trim()}
      onSubmit={onSubmit}
      header={(titleId) => (
        // the phone grabber is the shared sheet's own (hms-overrides.css, .pms-modal .modal-content::before)
        <div className="gg-sheet-head">
          <h5 className="modal-title" id={titleId}>
            {title}
          </h5>
        </div>
      )}
      footer={footer}
      footerClass="gg-sheet-foot"
    >
      {children}
    </Modal>
  );
}

/**
 * The page's main action and what it is about: `summary` on the left ("2 items · ₹640.00"), `action` on the right (a PortalButton). A phone shows it fixed
 * above the tab bar (the page keeps room for it); a desktop shows it where it is placed. Put it once per page, last in the page.
 */
export function GgActionBar({ summary, action, label = 'Main action' }: { summary?: ReactNode; action: ReactNode; label?: string }) {
  return (
    <div className="gg-actionbar" role="region" aria-label={label}>
      {summary ? <div className="gg-actionbar-sum">{summary}</div> : null}
      <div className="gg-actionbar-act">{action}</div>
    </div>
  );
}
