'use client';

// Pull to refresh on phones: a finger pulled down from the top of a page reloads what the page shows through the soft-refresh bus (every useAsync loader of the
// screen, the same reload F5 runs), behind the old data. Nothing moves on a desktop, inside a dialog or a sheet, or while the page is scrolled.
import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { markRefreshed, softRefreshAll } from '@/components/ui/softRefresh';
import { Bi } from '@/dashboards/pallav/ui';
import { tr } from '@/lib/i18n/language';

const PHONE = '(max-width: 768px)';
const ARM_AT = 72;
const MAX_PULL = 110;
const NOT_HERE = '.modal, .pms-dialog, .pt-m-sheet, .gg-sheet, .hotel-pop, .dropdown-menu.show, input, textarea, select, [contenteditable]';

export function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef<{ y: number; x: number } | null>(null);
  const live = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const onStart = (e: TouchEvent) => {
      start.current = null;
      if (!mq.matches || live.current || window.scrollY > 0 || e.touches.length !== 1) return;
      const t = e.target as Element | null;
      if (t?.closest?.(NOT_HERE)) return;
      const touch = e.touches[0];
      if (touch) start.current = { y: touch.clientY, x: touch.clientX };
    };
    const onMove = (e: TouchEvent) => {
      const from = start.current;
      const touch = e.touches[0];
      if (!from || !touch) return;
      const dy = touch.clientY - from.y;
      const dx = Math.abs(touch.clientX - from.x);
      if (dy <= 0 || window.scrollY > 0 || dx > 40) {
        if (dy <= 0 || dx > 40) start.current = null;
        setPull(0);
        return;
      }
      // the pull eases out as it grows, like a native list
      setPull(Math.min(MAX_PULL, dy * 0.55));
    };
    const onEnd = () => {
      const from = start.current;
      start.current = null;
      setPull((p) => {
        if (from && p >= ARM_AT * 0.55 && !live.current) {
          live.current = true;
          setBusy(true);
          document.body.classList.add('hms-softing');
          void softRefreshAll().then((outcome) => {
            if (outcome === 'ok' || outcome === 'nothing') markRefreshed();
            window.setTimeout(() => {
              document.body.classList.remove('hms-softing');
              live.current = false;
              setBusy(false);
            }, 350);
          });
        }
        return 0;
      });
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
      document.body.classList.remove('hms-softing');
    };
  }, []);

  const shown = busy || pull > 0;
  const armed = pull >= ARM_AT * 0.55;
  return (
    <div
      className={`hms-ptr${shown ? ' is-shown' : ''}${busy ? ' is-busy' : ''}${armed ? ' is-armed' : ''}`}
      style={{ '--ptr': `${busy ? ARM_AT * 0.55 : pull}px` } as CSSProperties}
      role="status"
      aria-live="polite"
      aria-label={busy ? tr("Refreshing") : armed ? tr("Release to refresh") : tr("Pull to refresh")}
    >
      <span className="hms-ptr-ring" aria-hidden="true">
        <Bi name="arrow-clockwise" />
      </span>
    </div>
  );
}
