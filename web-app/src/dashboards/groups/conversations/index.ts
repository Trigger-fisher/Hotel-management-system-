// Conversations (decision 66; MJ, 5 Nov 2026): ONE Email page per console (the shared inbox and the person's own mailbox behind one switch) and one WhatsApp page, the same
// pages for the hotel, the platform and the group. The old addresses (My mailbox, the combined inbox) open the Email page on the right box.
import type { ScreenMap } from '../../types';
import { GroupEmail, GroupMyMailbox, HotelEmail, HotelInboxAlias, HotelMyMailbox, PlatformEmail, PlatformInboxAlias, PlatformMyMailbox } from './EmailPage';
import { HotelWhatsApp, PlatformWhatsApp } from './WhatsAppPage';

export const screens: ScreenMap = {
  'hotel.email': HotelEmail,
  'hotel.emailThread': HotelEmail,
  'hotel.whatsapp': HotelWhatsApp,
  'hotel.whatsappThread': HotelWhatsApp,
  'hotel.conversations': HotelInboxAlias,
  'hotel.conversation': HotelInboxAlias,
  'hotel.myMailbox': HotelMyMailbox,
  'hotel.myMailboxThread': HotelMyMailbox,
  'platform.email': PlatformEmail,
  'platform.emailThread': PlatformEmail,
  'platform.whatsapp': PlatformWhatsApp,
  'platform.whatsappThread': PlatformWhatsApp,
  'platform.conversations': PlatformInboxAlias,
  'platform.conversation': PlatformInboxAlias,
  'platform.myMailbox': PlatformMyMailbox,
  'platform.myMailboxThread': PlatformMyMailbox,
  'group.email': GroupEmail,
  'group.emailThread': GroupEmail,
  'group.myMailbox': GroupMyMailbox,
  'group.myMailboxThread': GroupMyMailbox,
};
