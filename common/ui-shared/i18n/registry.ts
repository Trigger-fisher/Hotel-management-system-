// Every module that has Hindi and Gujarati words, in one list. Only the test (web-app/tests/server/i18n.languages.test.ts) reads it: it proves each language has exactly
// the English keys, no empty text, the same {placeholders}, and no stray English. A module is added here when its `...ByLanguage` object is made.
import type { CopyByLanguage } from './copy';
import { languageSwitchCopyByLanguage } from './words';
import { authWordsCopyByLanguage } from '../auth/copy.lang';
import { pallavCopyByLanguage } from '../auth-pallav/copy.lang';
import { shellCopyByLanguage } from '../dashboards/shellCopy';
import { guestCopyByLanguage } from '../dashboards/guest.lang';
import { homeCopyByLanguage } from '../dashboards/guestCopy/home.lang';
import { billsCopyByLanguage } from '../dashboards/guestCopy/bills.lang';
import { paymentsCopyByLanguage } from '../dashboards/guestCopy/payments.lang';
import { accountCopyByLanguage } from '../dashboards/guestCopy/account.lang';
import { orderCopyByLanguage } from '../dashboards/guestCopy/order.lang';
import { guestPortalOrderCopyByLanguage } from '../dashboards/guestPortal.lang';
import { payProblemsCopyByLanguage } from '../dashboards/payProblems.lang';
import { portalCopyByLanguage } from '../dashboards/portalState.lang';
import { portalHotelCopyByLanguage } from '../dashboards/portalHotel.lang';
import { corporateCopyByLanguage } from '../dashboards/corporate.lang';
import { notificationsPortalCopyByLanguage } from '../dashboards/notificationsCopy.lang';
import { notchCopyByLanguage } from '../dashboards/notchCopy.lang';

export interface TranslatedModule {
  name: string;
  words: CopyByLanguage<unknown>;
}

export const translatedModules: readonly TranslatedModule[] = [
  { name: 'languageSwitch', words: languageSwitchCopyByLanguage },
  { name: 'shell', words: shellCopyByLanguage },
  { name: 'signIn (auth-pallav)', words: pallavCopyByLanguage },
  { name: 'signIn words (auth)', words: authWordsCopyByLanguage },
  { name: 'guest: main words', words: guestCopyByLanguage },
  { name: 'guest: home', words: homeCopyByLanguage },
  { name: 'guest: bills', words: billsCopyByLanguage },
  { name: 'guest: payments', words: paymentsCopyByLanguage },
  { name: 'guest: account', words: accountCopyByLanguage },
  { name: 'guest: dining', words: orderCopyByLanguage },
  { name: 'guest: dining when', words: guestPortalOrderCopyByLanguage },
  { name: 'portal: online payments and support', words: payProblemsCopyByLanguage },
  { name: 'portal: account not set up', words: portalCopyByLanguage },
  { name: 'portal: hotel selector', words: portalHotelCopyByLanguage },
  { name: 'company: all pages', words: corporateCopyByLanguage },
  { name: 'company: notices', words: notificationsPortalCopyByLanguage },
  { name: 'notch', words: notchCopyByLanguage },
];
