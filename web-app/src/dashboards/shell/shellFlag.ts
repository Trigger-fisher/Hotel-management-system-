// "This browser had a dashboard open": a one-word flag in localStorage that the inline script in app/layout.tsx reads BEFORE the first paint of a reload, so the
// page starts as the neutral dashboard outline (components/ui/AppShellSkeleton.tsx) and not as the graphite sign-in page. Set when a dashboard mounts, cleared when
// the session ends (sign-out, expiry, switch user). Only the word "app" is stored: no session, user or hotel. Every storage access is guarded.
import { sweepBookingDrafts } from '../groups/frontOffice/bookingDraft';
import { sweepDrafts } from '../groups/frontOffice/checkInDraft';
import { clearShellSnapshot } from './shellSnapshot';

export const SHELL_FLAG_KEY = 'hms-shell';

export function markDashboardOpen(open: boolean): void {
  try {
    if (open) localStorage.setItem(SHELL_FLAG_KEY, 'app');
    else {
      localStorage.removeItem(SHELL_FLAG_KEY);
      clearShellSnapshot();
      // no guest's half-typed check-in or booking outlives the session on a shared desk machine
      sweepDrafts(localStorage);
      sweepDrafts(sessionStorage);
      sweepBookingDrafts(localStorage);
    }
  } catch {
    /* blocked storage: the next reload simply shows the sign-in outline for a moment */
  }
  // The same page keeps its attribute in step, so a later placeholder (restoring, lock screen) picks the right outline without a reload.
  if (typeof document !== 'undefined') {
    if (open) document.documentElement.dataset.shell = 'app';
    else delete document.documentElement.dataset.shell;
  }
}

/** True in a browser that had a dashboard open (the flag the reload script reads). */
export function dashboardWasOpen(): boolean {
  try {
    return localStorage.getItem(SHELL_FLAG_KEY) === 'app';
  } catch {
    return false;
  }
}
