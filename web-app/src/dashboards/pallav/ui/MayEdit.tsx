'use client';

// Shows its children only to a person who may change things in the module (edit or full level, and not inside a read-only visit): a view-only person never sees a button that would
// end in "Not allowed" (R46). The server still checks every write.
import type { ReactNode } from 'react';

import { userMayEdit } from '@shared/dashboards/features';

export function MayEdit({ module, children }: { module: string; children: ReactNode }) {
  return userMayEdit(module) ? <>{children}</> : null;
}
