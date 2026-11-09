'use client';

// Pieces the Guest screens share.
// Decision 71: the pay sheet of Bills and one bill (GuestPaySheet: a bottom sheet on a phone, a glass dialog on a desktop). The decision-70 pay cards
// (GuestPayPanel) are gone: Bills pays from its action bar. ActivityRow, CallReception and useReceptionPhone moved to the guest kit (kit/activity.tsx,
// kit/contact.tsx); they are re-exported here until every page imports them from the kit.
// ComingUp (decision 52's scheduled orders) is gone too: Room service shows the scheduled orders (decision 71).
import { useState } from 'react';

import { billNumberText, billTotals, type GuestBill } from '@shared/dashboards/guest';
import { billsCopyByLanguage } from '@shared/dashboards/guestCopy/bills.lang';
import { sellerName } from '@shared/dashboards/guestStage';

import { errorText, useToast } from '@/components/ui';
import { Bi, PortalButton } from '@/dashboards/pallav/ui';

import { guestApi } from './api';
import { inr } from '../portal/parts';
import { CallReception, useReceptionPhone } from './kit/contact';
import { refreshGuest } from './kit/refresh';
import { GgRow } from './kit/rows';
import { GgSheet } from './kit/sheet';
import { gpWordsByLanguage } from './kit/words';
import { useCopy } from '@/lib/i18n/language';

export { ActivityRow } from './kit/activity';
export { CallReception, useReceptionPhone } from './kit/contact';


/**
 * Confirms and pays `bills` (only those with something due): the total in coral, one row per bill, the Razorpay note, "Not now" and "Pay ₹X". Opened only when the hotel takes
 * online payment (useCanPayOnline: no screen opens it while the hotel has no online payment set up). A refusal (422 PAY_OFF, a conflict) keeps the sheet open with the
 * server's sentence and the reception's Call button. `onPaid` runs after a payment; every guest screen is told too (gg:refresh); onReceipt adds See receipt to the success toast.
 */
export function GuestPaySheet({ open, bills, onClose, onPaid, onReceipt }: { open: boolean; bills: readonly GuestBill[]; onClose: () => void; onPaid?: () => void; onReceipt?: () => void }) {
  const billsCopy = useCopy(billsCopyByLanguage);
  const p = billsCopy.pay;
  const w = useCopy(gpWordsByLanguage).bill;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const phone = useReceptionPhone(bills[0]?.hotelId);
  const due = bills.filter((b) => billTotals(b).duePaise > 0);
  const total = due.reduce((s, b) => s + billTotals(b).duePaise, 0);

  const close = () => {
    if (busy) return;
    setRefusal(null);
    onClose();
  };

  const pay = async () => {
    if (busy || due.length === 0) return;
    setBusy(true);
    setRefusal(null);
    const res = await guestApi.payBills(due.map((b) => b.id));
    setBusy(false);
    if (!res.ok) {
      const text = errorText(res.error);
      setRefusal(text);
      toast.show({ tone: 'error', text });
      return;
    }
    toast.show({ tone: 'success', text: p.paid(inr(res.data.totalPaise)), ...(onReceipt ? { action: { label: w.seeReceipt, onClick: onReceipt }, ms: 8000 } : {}) });
    onClose();
    onPaid?.();
    refreshGuest();
  };

  return (
    <GgSheet
      open={open}
      title={p.title}
      onClose={close}
      className="gg-paysheet"
      footer={
        <>
          <PortalButton variant="line" onClick={close} disabled={busy}>
            {p.cancel}
          </PortalButton>
          <PortalButton icon="lock" busy={busy} disabled={total <= 0} onClick={() => void pay()}>
            {p.confirm(inr(total))}
          </PortalButton>
        </>
      }
    >
      <div className="gg-sheet-amount gg-pay-amount">
        <span className="gg-money-label">
          {p.total} · {p.count(due.length)}
        </span>
        <span className="gg-money-amt warn">{inr(total)}</span>
      </div>
      <div className="gg-list gg-pay-list">
        {due.map((b) => (
          <GgRow
            key={b.id}
            icon={b.business === 'hotel' ? 'building' : 'cup-hot'}
            title={sellerName(b)}
            sub={[billNumberText(b.number), b.hotelName && b.hotelName !== sellerName(b) ? b.hotelName : null].filter(Boolean).join(' · ')}
            right={<span className="gg-amt">{inr(billTotals(b).duePaise)}</span>}
            chevron={false}
          />
        ))}
      </div>
      {refusal ? (
        <div className="pt-alert err gg-pay-refusal" role="alert">
          <Bi name="exclamation-circle" />
          <div>
            {refusal}
            {phone ? (
              <div className="mt-2">
                <CallReception phone={phone} label={p.refusedCall} />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <p className="gg-sheet-note">
        <Bi name="shield-check" /> {p.note}
      </p>
    </GgSheet>
  );
}
