'use client';

// Pay all due: every open bill of the company in one payment (oldest first, hotel and food), after one confirmation because money cannot be taken back here.
import { useState } from 'react';

import { corporateCopyByLanguage } from '@shared/dashboards/corporate.lang';
import { formatINR } from '@shared/dashboards/format';

import { errorText, useToast } from '@/components/ui';
import { Dialog } from '@/dashboards/pallav/ui';
import { useCopy } from '@/lib/i18n/language';
import { corporateApi } from './api';
import { cpWords } from './words';

export function PayAllDialog({ amountPaise, onClose, onPaid }: { amountPaise: number | null; onClose: () => void; onPaid: () => void }) {
  const c = useCopy(corporateCopyByLanguage);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const amount = formatINR(amountPaise ?? 0);

  const pay = async () => {
    setBusy(true);
    const res = await corporateApi.payDues(['hotel', 'food']);
    setBusy(false);
    onClose();
    if (!res.ok) {
      toast.show({ tone: 'error', text: errorText(res.error) });
      return;
    }
    toast.show({ tone: 'success', text: c.dues.done(amount) });
    onPaid();
  };

  return (
    <Dialog
      open={amountPaise !== null}
      title={cpWords.bills.payAllTitle}
      message={c.dues.confirmBody(amount)}
      confirmLabel={cpWords.bills.payAll(amount)}
      icon="lock"
      busy={busy}
      onConfirm={() => void pay()}
      onCancel={onClose}
    />
  );
}
