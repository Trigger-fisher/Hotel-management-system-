// Companies screens: company profiles, ledger (with the statement view), customers and email marketing.
import type { ScreenMap } from '../../types';
import { CustomersScreen } from './CustomersScreen';
import { LedgerScreen } from './LedgerScreen';
import { MarketingScreen } from './MarketingScreen';
import { NotificationDetailScreen } from './NotificationDetailScreen';
import { NotificationsScreen } from './NotificationsScreen';
import { ProfilesScreen } from './ProfilesScreen';
import { StatementScreen } from './StatementScreen';

export const screens: ScreenMap = {
  'hotel.co.profiles': ProfilesScreen,
  'hotel.co.ledger': LedgerScreen,
  'hotel.co.statement': StatementScreen,
  'hotel.co.customers': CustomersScreen,
  'hotel.co.marketing': MarketingScreen,
  'hotel.co.notifications': NotificationsScreen,
  'hotel.co.notification': NotificationDetailScreen,
};
