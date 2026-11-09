import "server-only";

// The four languages WhatsApp texts are written in (MJ, 4 Nov 2026): English, Hinglish (Hindi in English letters), Hindi and Gujarati. This module holds
//   - what HMS says to a guest BY ITSELF (the "which hotel?" question, STOP and START answers, "wrong hotel?", the redirect), in each language,
//   - how the language of a guest is told from their own words (their script, or Hinglish words in English letters), and
//   - the language code Meta wants for a message template (Meta has no Hinglish: it is approved and sent as English).
// The words below were written by the build, not by a translator: a native speaker should read them once before the first hotel uses them.
export const LANGUAGES = ["en", "hinglish", "hi", "gu"] as const;
export type Language = (typeof LANGUAGES)[number];
export const isLanguage = (x: unknown): x is Language => (LANGUAGES as readonly unknown[]).includes(x);
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = { en: "English", hinglish: "Hinglish", hi: "Hindi", gu: "Gujarati" };

/** The code Meta expects for a template in this language: Hinglish goes to Meta as English. */
export const metaLanguageCode = (language: string): string => (language === "hinglish" ? "en" : language);

export interface SystemTexts {
  stopped: string;
  started: string;
  choiceLost: string;
  askName: string;
  wrongHotel: string;
  wrongHotelGeneric: string;
  question: string;
  questionGeneric: string;
  /** Reply-button and list labels (WhatsApp cuts a button title at 20 characters and a list row at 24). */
  wrongButton: string;
  otherHotel: string;
  chooseHotel: string;
  hotelsSection: string;
  redirect(phone: string): string;
}

export const SYSTEM_TEXTS: Readonly<Record<Language, SystemTexts>> = {
  en: {
    stopped: "You will not get automatic messages from this chat any more. Send START to get them again.",
    started: "Automatic messages are back on. Send STOP to turn them off.",
    choiceLost: "We did not get your choice in time. Please write your message again.",
    askName: "Please write part of the hotel's name.",
    wrongHotel: "Sorry about that. Which hotel did you mean?",
    wrongHotelGeneric: "Sorry about that. Please reply with the name or code of the hotel you meant.",
    question: "Which hotel is your message for?",
    questionGeneric: "Which hotel is your message for? Please reply with the hotel's name or code.",
    wrongButton: "Wrong hotel?",
    otherHotel: "Other hotel",
    chooseHotel: "Choose hotel",
    hotelsSection: "Hotels",
    redirect: (phone) => `This hotel now chats on its own WhatsApp number: https://wa.me/${phone}`,
  },
  hinglish: {
    stopped: "Ab aapko is chat se automatic messages nahi milenge. Dobara chalu karne ke liye START bhejiye.",
    started: "Automatic messages phir se chalu hain. Band karne ke liye STOP bhejiye.",
    choiceLost: "Humein aapka chunav samay par nahi mila. Kripya apna message dobara likhiye.",
    askName: "Kripya hotel ke naam ka kuch hissa likhiye.",
    wrongHotel: "Maaf kijiye. Aapka matlab kaunsa hotel tha?",
    wrongHotelGeneric: "Maaf kijiye. Kripya us hotel ka naam ya code bhejiye jo aap chahte the.",
    question: "Aapka message kis hotel ke liye hai?",
    questionGeneric: "Aapka message kis hotel ke liye hai? Kripya hotel ka naam ya code bhejiye.",
    wrongButton: "Galat hotel?",
    otherHotel: "Doosra hotel",
    chooseHotel: "Hotel chuniye",
    hotelsSection: "Hotels",
    redirect: (phone) => `Yeh hotel ab apne WhatsApp number par chat karta hai: https://wa.me/${phone}`,
  },
  hi: {
    stopped: "अब आपको इस चैट से स्वचालित संदेश नहीं मिलेंगे। फिर से शुरू करने के लिए START भेजें।",
    started: "स्वचालित संदेश फिर से चालू हैं। बंद करने के लिए STOP भेजें।",
    choiceLost: "हमें आपकी पसंद समय पर नहीं मिली। कृपया अपना संदेश फिर से लिखें।",
    askName: "कृपया होटल के नाम का कुछ हिस्सा लिखें।",
    wrongHotel: "क्षमा करें। आपका मतलब कौन सा होटल था?",
    wrongHotelGeneric: "क्षमा करें। कृपया उस होटल का नाम या कोड भेजें जो आप चाहते थे।",
    question: "आपका संदेश किस होटल के लिए है?",
    questionGeneric: "आपका संदेश किस होटल के लिए है? कृपया होटल का नाम या कोड भेजें।",
    wrongButton: "गलत होटल?",
    otherHotel: "दूसरा होटल",
    chooseHotel: "होटल चुनें",
    hotelsSection: "होटल",
    redirect: (phone) => `यह होटल अब अपने WhatsApp नंबर पर चैट करता है: https://wa.me/${phone}`,
  },
  gu: {
    stopped: "હવે તમને આ ચેટમાંથી આપમેળે સંદેશા મળશે નહીં. ફરી ચાલુ કરવા માટે START મોકલો.",
    started: "આપમેળે સંદેશા ફરી ચાલુ છે. બંધ કરવા માટે STOP મોકલો.",
    choiceLost: "અમને તમારી પસંદગી સમયસર મળી નથી. કૃપા કરીને તમારો સંદેશ ફરી લખો.",
    askName: "કૃપા કરીને હોટેલના નામનો થોડો ભાગ લખો.",
    wrongHotel: "માફ કરશો. તમારો મતલબ કઈ હોટેલ હતો?",
    wrongHotelGeneric: "માફ કરશો. કૃપા કરીને જે હોટેલ તમારે જોઈતી હતી તેનું નામ અથવા કોડ મોકલો.",
    question: "તમારો સંદેશ કઈ હોટેલ માટે છે?",
    questionGeneric: "તમારો સંદેશ કઈ હોટેલ માટે છે? કૃપા કરીને હોટેલનું નામ અથવા કોડ મોકલો.",
    wrongButton: "ખોટી હોટેલ?",
    otherHotel: "બીજી હોટેલ",
    chooseHotel: "હોટેલ પસંદ કરો",
    hotelsSection: "હોટેલ",
    redirect: (phone) => `આ હોટેલ હવે પોતાના WhatsApp નંબર પર ચેટ કરે છે: https://wa.me/${phone}`,
  },
};

// common words of Hindi written in English letters; two of them in one message make it Hinglish (one alone is too easily English or a name)
const HINGLISH = new Set([
  "hai", "hain", "nahi", "nahin", "kya", "kaise", "kab", "kahan", "kitna", "kitne", "mujhe", "mera", "meri", "mere", "aap", "aapka", "aapki", "hum", "humein", "tum", "chahiye", "chahie", "kripya", "dhanyavad", "shukriya",
  "theek", "thik", "accha", "achha", "haan", "bhai", "karo", "karna", "kijiye", "raha", "rahi", "liye", "mein", "abhi", "kal", "aaj", "paisa", "kamra", "khana", "bata", "batao", "bataiye", "milega", "milta", "hoga", "hogi", "bahut", "zyada",
]);
const STRONG_HINGLISH = new Set(["hai", "hain", "nahi", "nahin", "kya", "kaise", "mujhe", "chahiye", "kripya", "dhanyavad", "shukriya", "aapka", "aapki", "kijiye", "karo", "batao", "bataiye", "milega", "kamra", "humein"]);

/**
 * The language of a guest's words, or null when there are too few to tell. A Gujarati letter means Gujarati, a Devanagari letter Hindi; in English letters, one strong Hindi word or three common ones
 * make Hinglish, anything else with enough letters is English. A heuristic: a guest who writes "ok" gets the default language.
 */
export function detectLanguage(text: string | null | undefined): Language | null {
  const t = (text ?? "").trim();
  if (t === "") return null;
  let gujarati = 0;
  let devanagari = 0;
  let latin = 0;
  for (const ch of t) {
    const c = ch.codePointAt(0) as number;
    if (c >= 0x0a80 && c <= 0x0aff) gujarati += 1;
    else if (c >= 0x0900 && c <= 0x097f) devanagari += 1;
    else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) latin += 1;
  }
  if (gujarati >= 2 && gujarati >= devanagari) return "gu";
  if (devanagari >= 2) return "hi";
  if (latin < 3) return null;
  const words = t.toLowerCase().match(/[a-z]+/g) ?? [];
  const strong = words.filter((w) => STRONG_HINGLISH.has(w)).length;
  const common = words.filter((w) => HINGLISH.has(w)).length;
  if (strong >= 1 || common >= 3) return "hinglish";
  // English needs a sentence: a single word such as STOP, START, Hello or a hotel's name says nothing about the guest's language
  return latin >= 8 && words.length >= 2 ? "en" : null;
}

/** What to say, in the guest's language when their words tell it, else the Super Admin's default. */
export const textsFor = (guestText: string | null | undefined, fallback: Language = "en"): { language: Language; t: SystemTexts } => {
  const language = detectLanguage(guestText) ?? fallback;
  return { language, t: SYSTEM_TEXTS[language] };
};
