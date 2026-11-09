// draft translation, to be checked by a native speaker
// Hindi and Gujarati for the company portal's Notices page and bell (the `portal` part of notificationsCopy). The hotel side of that file stays English.
import { copyByLanguage, type Widen } from '../i18n/copy';
import { notificationsCopy } from './notificationsCopy';
import type { NotificationLinkView } from './notifications';

/** The company portal's part of the notification words: the unit that is translated. */
export const notificationsPortalCopy = notificationsCopy.portal;

const LINK_LABEL_HI: Record<NotificationLinkView, string> = {
  'corporate.bills': 'बिल खोलें',
  'corporate.bill': 'बिल खोलें',
  'corporate.payments': 'भुगतान खोलें',
  'corporate.ledger': 'विवरण खोलें',
  'corporate.profile': 'कंपनी प्रोफ़ाइल खोलें',
};

const LINK_LABEL_GU: Record<NotificationLinkView, string> = {
  'corporate.bills': 'બિલ ખોલો',
  'corporate.bill': 'બિલ ખોલો',
  'corporate.payments': 'ચુકવણી ખોલો',
  'corporate.ledger': 'સ્ટેટમેન્ટ ખોલો',
  'corporate.profile': 'કંપની પ્રોફાઇલ ખોલો',
};

const portalHi: Widen<typeof notificationsPortalCopy> = {
  subtitle: 'आपके होटलों ने आपकी कंपनी को जो संदेश भेजे।',
  filters: { all: 'सारे', unread: 'नए', read: 'पहले के' },
  toast: { view: 'देखें', close: 'बंद करें', more: (n: number) => `और ${n} और` },
  desktop: {
    on: 'डेस्कटॉप अलर्ट चालू हैं',
    off: 'डेस्कटॉप अलर्ट चालू करें',
    blocked: 'इस ब्राउज़र में डेस्कटॉप अलर्ट बंद हैं',
    hint: 'HMS किसी दूसरे टैब में खुला हो तब भी नई सूचना ब्राउज़र अलर्ट की तरह दिखती है।',
  },
  emptyRead: { title: 'पहले का कुछ नहीं', body: 'जो सूचनाएँ आप पढ़ चुके हैं वे यहाँ दिखेंगी।' },
  markAll: 'सब पढ़ा हुआ मानें',
  markAllDone: (n: number) => (n === 0 ? 'निशान लगाने को कुछ नहीं: सब पढ़ी जा चुकी हैं।' : `${n} को पढ़ा हुआ माना गया।`),
  markOne: 'पढ़ा हुआ मानें',
  read: 'पढ़ी',
  newBadge: 'नई',
  important: 'ज़रूरी',
  from: 'किसकी तरफ़ से',
  count: (n: number) => `${n} सूचना`,
  empty: { title: 'कोई सूचना नहीं', body: 'जब कोई होटल आपको संदेश भेजेगा तो वह यहाँ दिखेगा और घंटी पर संख्या आएगी।' },
  emptyUnread: { title: 'सब पढ़ ली', body: 'आपकी कोई नई सूचना नहीं है।' },
  openLink: (view: NotificationLinkView): string => LINK_LABEL_HI[view],
  unreadLabel: (n: number) => (n === 0 ? 'सूचनाएँ' : `सूचनाएँ, ${n} अनपढ़ी`),
  bell: { title: 'सूचनाएँ', all: 'सारी सूचनाएँ देखें', empty: 'कुछ नया नहीं।', markAll: 'सब पढ़ा हुआ मानें' },
};

const portalGu: Widen<typeof notificationsPortalCopy> = {
  subtitle: 'તમારી હોટેલોએ તમારી કંપનીને મોકલેલા સંદેશા.',
  filters: { all: 'બધી', unread: 'નવી', read: 'અગાઉની' },
  toast: { view: 'જુઓ', close: 'બંધ કરો', more: (n: number) => `અને ${n} વધુ` },
  desktop: {
    on: 'ડેસ્કટૉપ ચેતવણી ચાલુ છે',
    off: 'ડેસ્કટૉપ ચેતવણી ચાલુ કરો',
    blocked: 'આ બ્રાઉઝરમાં ડેસ્કટૉપ ચેતવણી બંધ છે',
    hint: 'HMS બીજી ટૅબમાં ખુલ્લું હોય ત્યારે પણ નવી સૂચના બ્રાઉઝર ચેતવણી તરીકે દેખાય છે.',
  },
  emptyRead: { title: 'અગાઉનું કંઈ નથી', body: 'જે સૂચનાઓ તમે વાંચી લીધી છે તે અહીં દેખાશે.' },
  markAll: 'બધી વાંચેલી ગણો',
  markAllDone: (n: number) => (n === 0 ? 'નિશાન કરવા માટે કંઈ નથી: બધી વંચાઈ ગઈ છે.' : `${n} ને વાંચેલી ગણી.`),
  markOne: 'વાંચેલી ગણો',
  read: 'વાંચી',
  newBadge: 'નવી',
  important: 'મહત્વની',
  from: 'કોના તરફથી',
  count: (n: number) => `${n} સૂચના`,
  empty: { title: 'કોઈ સૂચના નથી', body: 'જ્યારે કોઈ હોટેલ તમને સંદેશ મોકલશે ત્યારે તે અહીં દેખાશે અને ઘંટડી પર સંખ્યા આવશે.' },
  emptyUnread: { title: 'બધી વંચાઈ ગઈ', body: 'તમારી કોઈ નવી સૂચના નથી.' },
  openLink: (view: NotificationLinkView): string => LINK_LABEL_GU[view],
  unreadLabel: (n: number) => (n === 0 ? 'સૂચનાઓ' : `સૂચનાઓ, ${n} વણવાંચેલી`),
  bell: { title: 'સૂચનાઓ', all: 'બધી સૂચનાઓ જુઓ', empty: 'કંઈ નવું નથી.', markAll: 'બધી વાંચેલી ગણો' },
};

export const notificationsPortalCopyByLanguage = copyByLanguage(notificationsPortalCopy, portalHi, portalGu);
