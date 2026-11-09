'use client';

// A reload's first dashboard frame: the real sidebar and top bar drawn from the last shell snapshot (shellSnapshot.ts) with a page skeleton
// inside, shown while the session is being restored and the dashboard code loads. The real dashboard then replaces it with the same
// markup, so nothing on the rail or in the header moves. Menu clicks wait for the real shell (the stack of views is restored with it).
import { useEffect, useState } from 'react';
import type { HmsUser } from '@shared/auth-pallav/types';
import { AppShellSkeleton } from '@/components/ui/AppShellSkeleton';
import { useMedia } from '@/components/ui';
import { PallavFrame } from '../pallav/PallavFrame';
import { PallavShell } from '../pallav/PallavShell';
import { pageSheetsFor } from '../pallav/pageCss';
import { PageSkeleton } from '../pallav/ui';
import { applyTheme, startTheme } from '../pallav/theme';
import { readShellSnapshot, type ShellSnapshot } from './shellSnapshot';

const noop = () => undefined;

export function SnapshotShell() {
  const [snap] = useState<ShellSnapshot | null>(() => (typeof window === 'undefined' ? null : readShellSnapshot()));
  const [theme] = useState<'light' | 'dark'>(() => (typeof document === 'undefined' ? 'light' : startTheme()));
  const wide = useMedia('(min-width: 761px)');
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  if (!snap) return <AppShellSkeleton always />;
  // Only the fields the frame draws; the rest of HmsUser is unknown here and never read by the shell.
  const user = { id: snap.user.id, displayName: snap.user.displayName, email: '', username: null, role: snap.user.role, hotel: null, group: null } as HmsUser;
  // Decision 70: a guest's reload is drawn in the guest portal's own look at once (its sheet and body class), so the old look never flashes first.
  const guest = snap.user.role === 'guest_user';
  // the company portal shares the look (MJ, 26 Oct 2026)
  const company = snap.user.role === 'corporate_user';
  return (
    <PallavFrame sheets={pageSheetsFor(guest ? 'guest.home' : company ? 'corporate.dashboard' : snap.activeId)}>
      <PallavShell
        look={guest ? 'guest' : company ? 'corporate' : 'staff'}
        user={user}
        brandName={snap.brandName}
        main={snap.sections}
        activeId={snap.activeId}
        onMain={noop}
        onHome={noop}
        wide={wide}
        header={snap.header}
        onProfile={noop}
        onLock={noop}
        onSignOut={noop}
        canForce={false}
        theme={theme}
        yearMenu={false}
        onTheme={noop}
      >
        <div id="dash-content" aria-busy="true">
          <PageSkeleton />
        </div>
      </PallavShell>
    </PallavFrame>
  );
}
