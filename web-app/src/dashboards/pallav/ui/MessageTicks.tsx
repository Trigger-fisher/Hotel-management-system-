'use client';

// The state of an outgoing message, as WhatsApp draws it: a clock while it waits to go, one tick when WhatsApp took it, two when it reached the phone,
// two in the accent colour when it was read, and a red mark when it was not delivered. Each carries its words for a screen reader (whatsappCopy.ticks).
//   <MessageTicks status="delivered" />
import { whatsappCopy, type WaTick } from '@shared/dashboards/whatsapp';

import { Bi } from '../Bi';

const ICON: Record<WaTick, string> = { pending: 'clock', sent: 'check', delivered: 'check-all', read: 'check-all', failed: 'exclamation-circle' };

export function MessageTicks({ status, className = '' }: { status: WaTick; className?: string }) {
  return (
    <span className={`cv-ticks is-${status} ${className}`.trim()} role="img" aria-label={whatsappCopy.ticks[status]} title={whatsappCopy.ticks[status]}>
      <Bi name={ICON[status]} />
    </span>
  );
}
