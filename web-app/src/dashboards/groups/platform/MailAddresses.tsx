'use client';

// "Email addresses" of one staff user (Super Admin only; MJ, 5 Nov 2026): the address that comes with the login, the extra ones the Super Admin gave, Remove
// with Undo, and "Give another address" from suggestions the server made and checked to be free. Each address feeds that person's Email page switch.
import { useState } from 'react';

import { formatDateTime } from '@shared/dashboards/format';
import { platformCopy } from '@shared/dashboards/platform';

import { useAction, useToast } from '@/components/ui';
import { Bi, Button, Modal, PickGroup, StatusChip } from '@/dashboards/pallav/ui';
import { Wait, useLoaded } from '../payrollCore/load';
import { setupApi } from './setupApi';

const M = platformCopy.mailAddresses;

export function MailAddressesModal({ person, onClose }: { person: { id: string; name: string }; onClose: () => void }) {
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const { data, error, reload } = useLoaded(() => setupApi.mailAddresses(person.id), [person.id, version]);
  const [pick, setPick] = useState('');
  const { busy, run } = useAction();
  const refresh = () => setVersion((n) => n + 1);
  const free = (data?.patterns ?? []).filter((p) => p.free);
  const chosen = free.find((p) => p.id === pick) ?? free[0];

  const remove = (id: string, address: string) =>
    void run(() => setupApi.removeMailAddress(person.id, id), {
      onOk: () => {
        refresh();
        toast.show({
          tone: 'success',
          text: M.removed(address),
          ms: 8000,
          action: { label: M.undo, onClick: () => void setupApi.restoreMailAddress(person.id, address).then(refresh) },
        });
      },
    });

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={M.title(person.name)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {M.close}
          </Button>
          {chosen ? (
            <Button icon="plus-lg" busy={busy} onClick={() => void run(() => setupApi.addMailAddress(person.id, chosen.id), { success: M.given(chosen.preview), onOk: refresh })}>
              {M.give}
            </Button>
          ) : null}
        </>
      }
    >
      {!data ? (
        <Wait error={error} onRetry={reload} tiles={false} rows={3} />
      ) : (
        <div className="pf-setup-stack">
          <p className="pf-sec-note mb-0">{M.intro}</p>
          <ul className="pf-addr-list">
            {data.items.map((a) => (
              <li key={a.id}>
                <Bi name={a.kind === 'auto' ? 'envelope' : 'envelope-plus'} />
                <span className="pf-addr-text">
                  <b className="pf-mono">{a.address}</b>
                  <small>{a.kind === 'auto' ? M.auto : a.createdBy && a.createdAt ? M.addedBy(a.createdBy, formatDateTime(a.createdAt)) : M.extra}</small>
                </span>
                {a.kind === 'extra' ? (
                  <Button variant="ghost" size="sm" icon="x-lg" title={M.removeLabel(a.address)} disabled={busy} onClick={() => remove(a.id, a.address)}>
                    {M.remove}
                  </Button>
                ) : (
                  <StatusChip>{M.auto}</StatusChip>
                )}
              </li>
            ))}
          </ul>
          <div>
            <h3 className="pf-wizard-title mb-2">{M.giveTitle}</h3>
            {chosen ? (
              <>
                <PickGroup<string> label={M.giveTitle} value={chosen.id} onChange={setPick} disabled={busy} choices={free.map((p) => ({ value: p.id, icon: 'at', title: p.preview }))} />
                <p className="pf-sec-note mt-2 mb-0">{M.giveHint}</p>
              </>
            ) : (
              <p className="pf-sec-note mb-0">{M.none}</p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
