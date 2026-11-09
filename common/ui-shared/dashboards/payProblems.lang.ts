// draft translation, to be checked by a native speaker
// Hindi and Gujarati for the guest and company "Online payments and support" page (payProblemsCopy in ./payProblems.ts).
// Accounting words to check with a native speaker: refund, dispute, captured/authorized payment states.
import { copyByLanguage, type Widen } from '../i18n/copy';
import { payProblemsCopy } from './payProblems';

const payProblemsCopyHi: Widen<typeof payProblemsCopy> = {
  title: 'ऑनलाइन भुगतान और सहायता',
  sub: 'आपके ऑनलाइन भुगतान, और किसी भी भुगतान में गड़बड़ी बताने की जगह। होटल यहीं जवाब देता है।',
  paymentsTitle: 'भुगतान',
  problemsTitle: 'शिकायतें',
  noPayments: { title: 'अभी कोई ऑनलाइन भुगतान नहीं', text: 'आप जो भुगतान ऑनलाइन करेंगे वह यहाँ दिखेगा, और कुछ गलत हो तो शिकायत करने का तरीका भी।' },
  noProblems: { title: 'कोई शिकायत नहीं की गई', text: 'अगर कोई भुगतान गलत लगे तो उसी भुगतान से शिकायत करें। होटल इसी पेज पर जवाब देगा।' },
  raise: 'शिकायत करें',
  raiseFor: (id: string) => `भुगतान ${id}`,
  kinds: { dispute: 'मैं इस राशि को पहचानता/पहचानती नहीं', refund_request: 'मुझे पैसे वापस चाहिए', question: 'मेरा एक सवाल है' },
  kindShort: { dispute: 'विवाद', refund_request: 'पैसे वापसी की माँग', question: 'सवाल' },
  status: { open: 'होटल के जवाब का इंतज़ार', answered: 'जवाब मिल गया', closed: 'बंद', withdrawn: 'वापस ली गई' },
  payStatus: { captured: 'चुका दिया', authorized: 'इंतज़ार में', failed: 'नाकाम', refunded: 'पैसे वापस हुए', created: 'शुरू हुआ' },
  partlyRefunded: 'कुछ पैसे वापस हुए',
  form: {
    kind: 'क्या दिक्कत है?',
    title: 'थोड़े शब्दों में',
    titleHint: 'दो बार पैसे कटे',
    message: 'हमें बताइए क्या हुआ',
    amount: 'जिस रकम पर सवाल है (रुपये, ज़रूरी नहीं)',
    send: 'होटल को भेजें',
    cancel: 'रद्द करें',
  },
  withdraw: 'वापस लें',
  reply: (by: string | null) => (by ? `${by} का जवाब` : 'होटल का जवाब'),
  sent: 'भेज दिया। होटल यहीं जवाब देगा।',
  withdrawn: 'वापस ले लिया।',
};

const payProblemsCopyGu: Widen<typeof payProblemsCopy> = {
  title: 'ઓનલાઇન ચુકવણી અને સહાય',
  sub: 'તમારી ઓનલાઇન ચુકવણી, અને કોઈ પણ ચુકવણીમાં ગડબડ જણાવવાની જગ્યા. હોટેલ અહીં જ જવાબ આપે છે.',
  paymentsTitle: 'ચુકવણી',
  problemsTitle: 'ફરિયાદો',
  noPayments: { title: 'હજી કોઈ ઓનલાઇન ચુકવણી નથી', text: 'તમે ઓનલાઇન જે ચુકવણી કરશો તે અહીં દેખાશે, અને કંઈ ખોટું હોય તો ફરિયાદ કરવાની રીત પણ.' },
  noProblems: { title: 'કોઈ ફરિયાદ કરી નથી', text: 'જો કોઈ ચુકવણી ખોટી લાગે તો તે જ ચુકવણીમાંથી ફરિયાદ કરો. હોટેલ આ જ પેજ પર જવાબ આપશે.' },
  raise: 'ફરિયાદ કરો',
  raiseFor: (id: string) => `ચુકવણી ${id}`,
  kinds: { dispute: 'હું આ રકમ ઓળખતો/ઓળખતી નથી', refund_request: 'મને પૈસા પાછા જોઈએ છે', question: 'મારે એક સવાલ છે' },
  kindShort: { dispute: 'વિવાદ', refund_request: 'પૈસા પાછા આપવાની માગ', question: 'સવાલ' },
  status: { open: 'હોટેલના જવાબની રાહ', answered: 'જવાબ મળી ગયો', closed: 'બંધ', withdrawn: 'પાછી ખેંચી' },
  payStatus: { captured: 'ચૂકવાઈ ગયું', authorized: 'રાહમાં', failed: 'નિષ્ફળ', refunded: 'પૈસા પાછા અપાયા', created: 'શરૂ થયું' },
  partlyRefunded: 'થોડા પૈસા પાછા અપાયા',
  form: {
    kind: 'શું તકલીફ છે?',
    title: 'થોડા શબ્દોમાં',
    titleHint: 'બે વાર પૈસા કપાયા',
    message: 'અમને જણાવો શું થયું',
    amount: 'જે રકમ વિશે સવાલ છે (રૂપિયા, જરૂરી નથી)',
    send: 'હોટેલને મોકલો',
    cancel: 'રદ કરો',
  },
  withdraw: 'પાછી ખેંચો',
  reply: (by: string | null) => (by ? `${by} તરફથી જવાબ` : 'હોટેલ તરફથી જવાબ'),
  sent: 'મોકલી દીધું. હોટેલ અહીં જ જવાબ આપશે.',
  withdrawn: 'પાછું ખેંચી લીધું.',
};

export const payProblemsCopyByLanguage = copyByLanguage(payProblemsCopy, payProblemsCopyHi, payProblemsCopyGu);
