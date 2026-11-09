'use client';

// Pallav's page head: what the page is for (a bold graphite sentence) on the left, search and buttons on the right.
//   <div class="page-head"><div><p class="pms-sub">..</p></div><div class="sh-head-actions">..</div></div>
import type { ReactNode } from 'react';

import { trn } from '@/lib/i18n/language';
export function PageHead({ sub, children, actionsClass = 'sh-head-actions', className = '' }: { sub?: ReactNode; children?: ReactNode; actionsClass?: string; className?: string }) {
  return (
    <div className={`page-head ${className}`}>
      <div>{sub && <p className="pms-sub">{trn(sub)}</p>}</div>
      {children && <div className={actionsClass}>{children}</div>}
    </div>
  );
}
