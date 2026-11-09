// Daily Cash screens: revenue (deposits), expenses and shift handover. New, edit and detail open in dialogs.
import type { ScreenMap } from '../../types';
import { ExpensesScreen } from './ExpensesScreen';
import { HandoverScreen } from './HandoverScreen';
import { RevenueScreen } from './RevenueScreen';

export const screens: ScreenMap = {
  'hotel.cash.revenue': RevenueScreen,
  'hotel.cash.expenses': ExpensesScreen,
  'hotel.cash.handover': HandoverScreen,
};
