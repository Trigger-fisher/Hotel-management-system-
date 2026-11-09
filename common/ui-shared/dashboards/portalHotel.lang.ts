// draft translation, to be checked by a native speaker
// Hindi and Gujarati for the hotel selector of the guest and company portals (portalHotelCopy in ./portalHotel.ts).
import { copyByLanguage, type Widen } from '../i18n/copy';
import { portalHotelCopy } from './portalHotel';

const portalHotelCopyHi: Widen<typeof portalHotelCopy> = {
  all: 'सभी होटल',
  current: 'दिख रहा है',
  menuLabel: 'होटल चुनें',
  hint: 'सिर्फ़ किसी एक होटल के बिल और ठहराव देखने के लिए उसे चुनें।',
  rowHotel: 'होटल',
  filter: 'होटल',
  owes: (due: string): string => `${due} देना है`,
  unread: (n: number): string => `${n} अनपढ़े`,
  room: (no: string): string => `कमरा ${no}`,
  requests: (n: number): string => `${n} अनुरोध खुले हैं`,
  allTotals: (due: string, bills: number): string => `${bills} बिल में ${due} देना है`,
  unavailableTitle: (n: number): string => `${n} होटल तक नहीं पहुँच सके`,
  unavailableBody: (names: string[]): string => `अभी शामिल नहीं: ${names.join(', ')}। थोड़ी देर में फिर कोशिश करें।`,
};

const portalHotelCopyGu: Widen<typeof portalHotelCopy> = {
  all: 'બધી હોટેલ',
  current: 'દેખાય છે',
  menuLabel: 'હોટેલ પસંદ કરો',
  hint: 'ફક્ત કોઈ એક હોટેલનાં બિલ અને રોકાણ જોવા માટે તે પસંદ કરો.',
  rowHotel: 'હોટેલ',
  filter: 'હોટેલ',
  owes: (due: string): string => `${due} ચૂકવવાના`,
  unread: (n: number): string => `${n} વણવાંચેલા`,
  room: (no: string): string => `રૂમ ${no}`,
  requests: (n: number): string => `${n} વિનંતી ખુલ્લી છે`,
  allTotals: (due: string, bills: number): string => `${bills} બિલમાં ${due} ચૂકવવાના`,
  unavailableTitle: (n: number): string => `${n} હોટેલ સુધી પહોંચી શક્યા નહીં`,
  unavailableBody: (names: string[]): string => `હમણાં સામેલ નથી: ${names.join(', ')}. થોડી વારમાં ફરી પ્રયત્ન કરો.`,
};

export const portalHotelCopyByLanguage = copyByLanguage(portalHotelCopy, portalHotelCopyHi, portalHotelCopyGu);
