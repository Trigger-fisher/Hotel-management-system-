// draft translation, to be checked by a native speaker
// Hindi and Gujarati for the guest's Dining page words that live in guestPortalCopy.order (the restaurant hours part is for hotel staff and stays English).
import { copyByLanguage, type Widen } from '../i18n/copy';
import { guestPortalCopy } from './guestPortal';

/** The guest-facing part of guestPortalCopy: the unit that is translated. */
export const guestPortalOrderCopy = guestPortalCopy.order;

const orderHi: Widen<typeof guestPortalOrderCopy> = {
  notStayingTitle: 'रूम सर्विस हमारे साथ ठहरे मेहमानों के लिए है',
  notStayingBody: 'चेक-इन के बाद आप अपने कमरे में खाना और दूसरी सेवाएँ मँगवा सकते हैं। आपके आने पर यह पेज खुल जाएगा।',
  scheduleTitle: 'यह आप तक कब पहुँचे?',
  now: 'जितना जल्दी हो सके',
  later: 'मेरे चुने समय पर',
  pickDate: 'दिन',
  pickTime: 'समय',
  outsideHours: 'उस समय रसोई बंद रहती है। कृपया खुलने के समय के अंदर का समय चुनें।',
  outsideStay: 'कृपया अपने ठहराव के दौरान का समय चुनें।',
  tooSoon: 'कृपया अभी से कम से कम 15 मिनट बाद का समय चुनें।',
  scheduledFor: (when: string) => `${when} के लिए`,
  pauseBody: 'रूम सर्विस अभी ऑर्डर नहीं ले रही। आप बाद में आ सकते हैं।',
};

const orderGu: Widen<typeof guestPortalOrderCopy> = {
  notStayingTitle: 'રૂમ સર્વિસ અમારી સાથે રોકાયેલા મહેમાનો માટે છે',
  notStayingBody: 'ચેક-ઇન પછી તમે તમારા રૂમમાં જમવાનું અને બીજી સેવાઓ મંગાવી શકો છો. તમે આવશો ત્યારે આ પેજ ખુલી જશે.',
  scheduleTitle: 'તે તમારા સુધી ક્યારે પહોંચે?',
  now: 'બને તેટલું જલ્દી',
  later: 'મારા પસંદ કરેલા સમયે',
  pickDate: 'દિવસ',
  pickTime: 'સમય',
  outsideHours: 'તે સમયે રસોડું બંધ હોય છે. કૃપા કરીને ખુલવાના સમયની અંદરનો સમય પસંદ કરો.',
  outsideStay: 'કૃપા કરીને તમારા રોકાણ દરમિયાનનો સમય પસંદ કરો.',
  tooSoon: 'કૃપા કરીને હમણાંથી ઓછામાં ઓછી 15 મિનિટ પછીનો સમય પસંદ કરો.',
  scheduledFor: (when: string) => `${when} માટે`,
  pauseBody: 'રૂમ સર્વિસ હમણાં ઓર્ડર લેતી નથી. તમે પછીથી આવી શકો છો.',
};

export const guestPortalOrderCopyByLanguage = copyByLanguage(guestPortalOrderCopy, orderHi, orderGu);
