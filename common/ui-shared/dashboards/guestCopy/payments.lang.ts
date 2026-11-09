// draft translation, to be checked by a native speaker
// Hindi and Gujarati for the guest's Payments (paymentsCopy in ./payments.ts). PDF stays in Latin letters.
import { copyByLanguage, type Widen } from '../../i18n/copy';
import { paymentsCopy } from './payments';

const paymentsCopyHi: Widen<typeof paymentsCopy> = {
  title: 'भुगतान',
  status: (payments: number, charges: number) =>
    `${payments === 1 ? '1 भुगतान' : `${payments} भुगतान`} · ${charges === 1 ? '1 खर्च' : `${charges} खर्च`}`,
  kinds: { label: 'दिखाएँ', payments: 'भुगतान', charges: 'खर्च' },
  search: 'भुगतान और खर्च खोजें',
  getStatement: 'स्टेटमेंट पाएँ',
  receipt: 'रसीद (PDF)',
  receiptLabel: (title: string, amount: string) => `${title}, ${amount}। रसीद (PDF) खोलें`,
  cancelled: 'रद्द',
  billRef: (no: string) => `बिल ${no}`,
  details: {
    show: (title: string, amount: string) => `${title}, ${amount}। जानकारी दिखाएँ`,
    paidOn: 'चुकाने की तारीख़',
    amount: 'रकम',
    towards: 'किसके लिए चुकाया',
    business: { hotel: 'कमरे और होटल का बिल', food: 'रेस्टोरेंट का बिल' },
    bill: 'बिल',
    hotel: 'होटल',
    status: 'स्थिति',
    statusText: { paid: 'मिल गया', on_bill: 'आपके बिल में', cancelled: 'रद्द' },
    download: 'रसीद डाउनलोड करें',
    noReceipt: 'रद्द किए गए भुगतान की रसीद नहीं होती।',
  },
  empty: {
    payments: { title: 'अभी कोई भुगतान नहीं', body: 'आप जो भुगतान करेंगे वे अपनी रसीद के साथ यहाँ दिखेंगे।' },
    charges: { title: 'आपके बिल में अभी कुछ नहीं जुड़ा', body: 'कमरे की रातें, खाना और सेवाएँ जो आपके बिल में लगेंगी, यहाँ दिखेंगी।' },
  },
  summary: {
    title: 'अब तक चुकाया',
    count: (n: number) => (n === 1 ? 'इस सूची में 1 भुगतान' : `इस सूची में ${n} भुगतान`),
    latest: 'सबसे हाल का भुगतान',
  },
  help: {
    title: 'भुगतान के बारे में सवाल?',
    body: 'रिसेप्शन किसी भी खर्च को समझा सकता है या रसीद दोबारा भेज सकता है।',
  },
  statement: {
    title: 'स्टेटमेंट पाएँ',
    intro: 'किसी अवधि का हर खर्च और भुगतान, PDF में।',
    from: 'से',
    to: 'तक',
    covers: (from: string, to: string) => `${from} से ${to} तक।`,
    allHotels: 'आप जिन भी होटलों में ठहरे हैं, सब शामिल हैं।',
    oneHotel: (hotel: string) => `सिर्फ़ ${hotel} के लिए।`,
    download: 'PDF डाउनलोड करें',
    cancel: 'रद्द करें',
    backwards: 'आख़िरी तारीख़ शुरू की तारीख़ के बराबर या उसके बाद की होनी चाहिए।',
    tooLong: 'एक स्टेटमेंट में ज़्यादा से ज़्यादा एक साल आ सकता है। छोटी अवधि चुनें।',
    missing: 'दोनों तारीख़ें चुनें।',
  },
};

const paymentsCopyGu: Widen<typeof paymentsCopy> = {
  title: 'ચુકવણી',
  status: (payments: number, charges: number) =>
    `${payments === 1 ? '1 ચુકવણી' : `${payments} ચુકવણી`} · ${charges === 1 ? '1 ખર્ચ' : `${charges} ખર્ચ`}`,
  kinds: { label: 'બતાવો', payments: 'ચુકવણી', charges: 'ખર્ચ' },
  search: 'ચુકવણી અને ખર્ચ શોધો',
  getStatement: 'સ્ટેટમેન્ટ મેળવો',
  receipt: 'રસીદ (PDF)',
  receiptLabel: (title: string, amount: string) => `${title}, ${amount}. રસીદ (PDF) ખોલો`,
  cancelled: 'રદ',
  billRef: (no: string) => `બિલ ${no}`,
  details: {
    show: (title: string, amount: string) => `${title}, ${amount}. વિગતો બતાવો`,
    paidOn: 'ચૂકવ્યાની તારીખ',
    amount: 'રકમ',
    towards: 'શેના માટે ચૂકવ્યા',
    business: { hotel: 'રૂમ અને હોટેલનું બિલ', food: 'રેસ્ટોરન્ટનું બિલ' },
    bill: 'બિલ',
    hotel: 'હોટેલ',
    status: 'સ્થિતિ',
    statusText: { paid: 'મળી ગયા', on_bill: 'તમારા બિલમાં', cancelled: 'રદ' },
    download: 'રસીદ ડાઉનલોડ કરો',
    noReceipt: 'રદ થયેલી ચુકવણીની રસીદ હોતી નથી.',
  },
  empty: {
    payments: { title: 'હજી કોઈ ચુકવણી નથી', body: 'તમે કરેલી ચુકવણી તેની રસીદ સાથે અહીં દેખાશે.' },
    charges: { title: 'તમારા બિલમાં હજી કંઈ ઉમેરાયું નથી', body: 'રૂમની રાત, ભોજન અને સેવાઓ જે તમારા બિલમાં લાગશે તે અહીં દેખાશે.' },
  },
  summary: {
    title: 'અત્યાર સુધી ચૂકવ્યા',
    count: (n: number) => (n === 1 ? 'આ યાદીમાં 1 ચુકવણી' : `આ યાદીમાં ${n} ચુકવણી`),
    latest: 'સૌથી તાજેતરની ચુકવણી',
  },
  help: {
    title: 'ચુકવણી વિશે સવાલ?',
    body: 'રિસેપ્શન કોઈ પણ ખર્ચ સમજાવી શકે છે અથવા રસીદ ફરી મોકલી શકે છે.',
  },
  statement: {
    title: 'સ્ટેટમેન્ટ મેળવો',
    intro: 'કોઈ સમયગાળાનો દરેક ખર્ચ અને ચુકવણી, PDF માં.',
    from: 'થી',
    to: 'સુધી',
    covers: (from: string, to: string) => `${from} થી ${to} સુધી.`,
    allHotels: 'તમે જે બધી હોટેલમાં રોકાયા છો તે બધી આવરી લેવાઈ છે.',
    oneHotel: (hotel: string) => `ફક્ત ${hotel} માટે.`,
    download: 'PDF ડાઉનલોડ કરો',
    cancel: 'રદ કરો',
    backwards: 'છેલ્લી તારીખ શરૂની તારીખ જેટલી કે તેના પછીની હોવી જોઈએ.',
    tooLong: 'એક સ્ટેટમેન્ટમાં વધુમાં વધુ એક વર્ષ આવી શકે. ટૂંકો સમયગાળો પસંદ કરો.',
    missing: 'બંને તારીખો પસંદ કરો.',
  },
};

export const paymentsCopyByLanguage = copyByLanguage(paymentsCopy, paymentsCopyHi, paymentsCopyGu);
