// Guest dashboard screens (Pallav guest portal). Menu ids come from ui-shared/dashboards/nav.ts.
// Each screen is wrapped so the mock API knows which guest is signed in before the screen's first call (api.ts bindGuestUser).
import { createElement, type ComponentType } from 'react';

import type { ScreenMap, ScreenProps } from '../../types';
import { bindGuestUser } from './api';
import { GuestBill } from './Bill';
import { GuestBills } from './Bills';
import { GuestHistory } from './History';
import { GuestHome } from './Home';
import { GuestOrder } from './Order';
import { GuestProfileScreen } from './Profile';
import { GuestSupport } from './Support';

function forUser(Screen: ComponentType<ScreenProps>): ComponentType<ScreenProps> {
  function GuestScreen(props: ScreenProps) {
    // a plain module variable, not React state: set before the child's effects run its first call
    bindGuestUser(props.user);
    return createElement(Screen, props);
  }
  GuestScreen.displayName = `Guest(${Screen.displayName ?? Screen.name})`;
  return GuestScreen;
}

export const screens: ScreenMap = {
  'guest.home': forUser(GuestHome),
  'guest.order': forUser(GuestOrder),
  'guest.bills': forUser(GuestBills),
  'guest.bill': forUser(GuestBill),
  'guest.history': forUser(GuestHistory),
  'guest.profile': forUser(GuestProfileScreen),
  'guest.support': forUser(GuestSupport),
};
