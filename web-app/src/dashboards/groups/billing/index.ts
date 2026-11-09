// Billing screens: guest advances and bills, each a Pallav list with its pop-ups (no detail or form pages: Pallav has none).
import type { ScreenMap } from '../../types';
import { AdvancesScreen } from './AdvancesScreen';
import { BillsScreen } from './BillsScreen';

export const screens: ScreenMap = {
  'hotel.billing.advances': AdvancesScreen,
  'hotel.billing.bills': BillsScreen,
};
