'use client';

// The slim progress line at the very top of the page while any screen refreshes behind its old data (R48, like Vercel's): it only shows when a refresh runs, never on the
// first load (that has its skeleton), and it moves nothing on the page. If a background refresh fails, a small notice says the old data is still shown.
import { useRefreshFailed, useRefreshing } from '@/components/ui';

import { tr } from '@/lib/i18n/language';
export function RefreshLine() {
  const on = useRefreshing();
  const failed = useRefreshFailed();
  return (
    <>
      <div className={`hms-refresh-line${on ? ' on' : ''}`} role="progressbar" aria-hidden={!on} aria-label={tr("Updating")} />
      {failed && (
        <div className="hms-refresh-failed" role="status">
          {tr("Could not refresh. Showing the last data.")}
        </div>
      )}
    </>
  );
}
