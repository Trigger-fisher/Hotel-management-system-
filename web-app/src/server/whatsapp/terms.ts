import "server-only";
// The WhatsApp terms a hotel's admin accepts once before the hotel messages guests on WhatsApp through HMS (plan part 3, the legal gate). The acceptance is kept in the hotel's own settings
// (app_settings, key whatsapp.terms) with the version, the time and who; a new version asks again. The wording below is the product text; the owner's lawyer reviews it before the first hotel.
export const WA_TERMS_KEY = "whatsapp.terms";
export const WA_TERMS_VERSION = "2026-11";

export const WA_TERMS_TITLE = "Using WhatsApp for your guests";
export const WA_TERMS_POINTS: readonly string[] = [
  "You message only guests who have agreed to hear from the hotel on WhatsApp. Tick the guest's agreement in HMS when they say yes, at booking or at check-in. Never message a number you bought, scraped or were given for another purpose.",
  "You follow WhatsApp's Business Messaging Policy and Meta's rules for message templates. HMS applies the rules that cannot be switched off (the 24-hour reply window, approved messages for anything else, STOP) for you, but the content of your messages is your responsibility.",
  "A guest who sends STOP is not messaged again by your hotel. HMS honours it automatically; you do not override it.",
  "Offers and promotions (marketing messages) are off unless the platform allows them for your hotel, and need the guest's agreement for marketing in particular.",
  "Your guests' chats stay in your hotel's own records. The platform team does not read them. WhatsApp (Meta) carries the messages and processes them under its own terms.",
  "The platform team may pause WhatsApp for your hotel, or lower its limits, if guests report messages as unwanted or if WhatsApp lowers the quality rating of the number. A paused hotel sends nothing until it is resumed.",
  "Messages sent from a shared number show your hotel's name at the start, so guests know who is writing.",
];

export interface WaTermsAcceptance {
  version: string;
  at: string;
  by: string;
}

/** What is stored: one JSON text. A value that does not read as an acceptance of the CURRENT version is "not accepted". */
export function termsAcceptanceOf(value: string | null | undefined): WaTermsAcceptance | null {
  if (!value) return null;
  try {
    const v = JSON.parse(value) as Partial<WaTermsAcceptance>;
    return v.version === WA_TERMS_VERSION && typeof v.at === "string" && typeof v.by === "string" ? { version: v.version, at: v.at, by: v.by } : null;
  } catch {
    return null;
  }
}
