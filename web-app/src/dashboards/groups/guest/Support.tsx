'use client';
// Help with a payment (guest.support): the guest's own online payments and the problems raised about them, answered by the hotel, under the page's large title.
import { useCopy } from '@/lib/i18n/language';

import type { ScreenProps } from '../../types';
import { PayProblems } from '../portal/PayProblems';
import { guestPayProblemsApi } from '../portal/payProblemsApi';
import { GgPage } from './kit/GgPage';
import { gpWordsByLanguage } from './kit/words';

export function GuestSupport({ navigate }: ScreenProps) {
  const title = useCopy(gpWordsByLanguage).history.paymentHelp;
  return (
    <GgPage title={title} className="gg-support">
      <PayProblems api={guestPayProblemsApi} kind="guest" onBills={() => navigate('guest.bills')} />
    </GgPage>
  );
}
