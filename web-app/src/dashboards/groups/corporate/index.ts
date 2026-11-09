// Company portal screens. View ids come from ui-shared/dashboards/nav.ts; "corporate.bill" is one bill (params.id), where paying is done.
// "corporate.myProfile" is the person's own profile: the same screen as the hotel's My Profile (groups/admin/Profile.tsx).
// "corporate.support" is the one payment-problems page the guest portal uses too (portal/PayProblems.tsx).
import { createElement } from 'react';

import type { ScreenMap } from '../../types';
import { Profile } from '../admin/Profile';
import { PayProblems } from '../portal/PayProblems';
import { corporatePayProblemsApi } from '../portal/payProblemsApi';
import { CorporateBillScreen } from './BillScreen';
import { CorporateDashboardScreen } from './DashboardScreen';
import { CorporateDueBillsScreen } from './DueBillsScreen';
import { CorporateLedgerAccountScreen } from './LedgerAccountScreen';
import { CorporateNotificationsScreen } from './NotificationsScreen';
import { CorporatePaymentHistoryScreen } from './PaymentHistoryScreen';
import { CorporateProfileScreen } from './ProfileScreen';

function CorporateSupport() {
  return createElement(PayProblems, { api: corporatePayProblemsApi, kind: 'corporate' });
}

export const screens: ScreenMap = {
  'corporate.dashboard': CorporateDashboardScreen,
  'corporate.notifications': CorporateNotificationsScreen,
  'corporate.bills': CorporateDueBillsScreen,
  'corporate.bill': CorporateBillScreen,
  'corporate.payments': CorporatePaymentHistoryScreen,
  'corporate.ledger': CorporateLedgerAccountScreen,
  'corporate.support': CorporateSupport,
  'corporate.profile': CorporateProfileScreen,
  'corporate.myProfile': Profile,
};
