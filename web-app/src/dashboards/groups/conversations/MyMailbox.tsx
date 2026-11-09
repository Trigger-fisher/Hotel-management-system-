'use client';

// My mailbox (platform 0178, 0179; MJ, 3 Nov 2026): every staff login's own mailbox on the platform's Amazon SES domain, one box of the Email page (EmailPage.tsx). Nothing to
// connect: one quiet line says "Your mailbox address is <username>@<domain>" (with Copy) and, when the name is used by something else, says so in a plain sentence (sending is
// blocked on the server until the username is changed).
import { useState } from 'react';

import { personalMailboxCopy as p, type PersonalAddressView } from '@shared/dashboards/conversations';

import { useToast } from '@/components/ui';
import { Alert, Bi, Button } from '@/dashboards/pallav/ui';

import { tr } from '@/lib/i18n/language';

/** "Your mailbox address is ...", with a copy button; the plain sentence when the name cannot be an address. */
export function AddressLine({ view }: { view: PersonalAddressView }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!view.address) return;
    try {
      await navigator.clipboard.writeText(view.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.show({ tone: 'error', text: tr('Could not copy. Select the address and copy it.') });
    }
  };
  return (
    <div className="mb-mine">
      <p className="mb-mine-line">
        <Bi name="envelope-check" />
        <span>{view.address ? p.addressIs : p.title}</span>
        {view.address ? <strong className="text-break">{view.address}</strong> : null}
        {view.address ? (
          <Button variant="ghost" size="sm" icon={copied ? 'check-lg' : 'clipboard'} onClick={() => void copy()}>
            {copied ? p.copied : p.copy}
          </Button>
        ) : null}
      </p>
      {view.extras?.length ? (
        <p className="mb-mine-line">
          <Bi name="envelope-plus" />
          <span>{p.alsoAt}</span>
          <strong className="text-break">{view.extras.join(', ')}</strong>
        </p>
      ) : null}
      {!view.usable && view.message ? <Alert tone="warning">{view.message}</Alert> : null}
    </div>
  );
}
