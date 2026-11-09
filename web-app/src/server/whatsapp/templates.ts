import "server-only";
import { AppError } from "../errors";

// A hotel's message templates (hotel 0057 wa_templates): the checks of a draft before it is sent to Meta, and how Meta's word becomes ours. Pure; the rules marked "verify" are Meta's as
// documented and must be confirmed on the live account.
export const TEMPLATE_BODY_MAX = 1024;
export const TEMPLATE_SOURCES = ["guest_name", "room", "check_in", "check_out", "hotel_name"] as const;
export type TemplateSource = (typeof TEMPLATE_SOURCES)[number];
export type TemplateStatus = "draft" | "pending" | "approved" | "rejected" | "paused";
export type TemplateCategory = "utility" | "authentication" | "marketing";

export interface TemplateVariable {
  index: number;
  /** What HMS fills in from the linked guest or stay, or a free label the staff member types when sending. */
  name: string;
  /** The sample value Meta's reviewers see. */
  example: string;
}

/** A button under the message: a link the same for every guest (directions, reviews), or a quick answer the guest taps. */
export type TemplateButton = { kind: "url"; text: string; url: string } | { kind: "quick_reply"; text: string };
export const TEMPLATE_BUTTONS_MAX = 3;
export const TEMPLATE_URL_BUTTONS_MAX = 2;
export const TEMPLATE_BUTTON_TEXT_MAX = 25;

export interface TemplateDraft {
  name: string;
  language: string;
  category: TemplateCategory;
  body: string;
  variables: TemplateVariable[];
  buttons?: TemplateButton[];
  /** The ready-made message it was started from (whatsappStarters key), so a newer wording can be offered later. */
  starterKey?: string | null;
}

export interface TemplateRecord extends TemplateDraft {
  id: string;
  status: TemplateStatus;
  statusReason: string | null;
  metaTemplateId: string | null;
  lineId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const fail = (field: string, message: string): never => {
  throw new AppError("VALIDATION_FAILED", message, { fields: { [field]: message } });
};

/** A template name as Meta stores it: lower case letters, digits and underscores. */
export const templateNameOf = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

/** The numbers used in the body, in order of appearance ({{1}}, {{2}}). */
export const placeholdersOf = (body: string): number[] => [...body.matchAll(/\{\{\s*(\d{1,2})\s*\}\}/g)].map((m) => Number(m[1]));

/** Checks and cleans a draft; throws a plain sentence on the first problem. */
export function checkTemplate(input: TemplateDraft): TemplateDraft {
  const name = input.name.trim();
  if (!/^[a-z0-9_]{1,512}$/.test(name)) fail("name", "Use lower case letters, digits and underscores for the name.");
  // a Meta language code, or Hinglish (Hindi in English letters: Meta has no such code, so it is sent to Meta as English, language.ts metaLanguageCode)
  if (!/^([a-z]{2}(_[A-Z]{2})?|hinglish)$/.test(input.language)) fail("language", "Choose a language.");
  const body = input.body.replace(/\r\n/g, "\n").trim();
  if (body.length < 1) fail("body", "Write the message.");
  if (body.length > TEMPLATE_BODY_MAX) fail("body", `The message is longer than ${TEMPLATE_BODY_MAX} characters.`);
  const used = placeholdersOf(body);
  const distinct = [...new Set(used)];
  // verify: Meta wants {{1}}, {{2}} ... with no gap, each at least once
  if (distinct.some((n, i) => n !== i + 1)) fail("body", "Number the blanks {{1}}, {{2}}, {{3}} in order, with none missing.");
  // verify: a blank may not be the very first or very last thing in the message, nor sit next to another blank
  if (/^\s*\{\{/.test(body) || /\}\}\s*$/.test(body)) fail("body", "A blank cannot be the first or the last thing in the message. Add a few words around it.");
  if (/\}\}\s*\{\{/.test(body)) fail("body", "Two blanks cannot sit side by side. Put a word between them.");
  if (body.length < distinct.length * 8) fail("body", "The message is too short for the number of blanks.");
  const byIndex = new Map(input.variables.map((v) => [v.index, v] as const));
  const variables = distinct.map((index) => {
    const v = byIndex.get(index);
    const example = (v?.example ?? "").trim();
    if (example === "") return fail("variables", `Give an example for {{${index}}}: Meta reads it when it reviews the message.`);
    if (example.length > 60) return fail("variables", `The example for {{${index}}} is too long.`);
    return { index, name: (v?.name ?? "").trim().slice(0, 40) || `value_${index}`, example };
  });
  const emoji = body.match(/\p{Extended_Pictographic}/gu)?.length ?? 0;
  if (emoji > 1) fail("body", "Use at most one emoji in a message.");
  const letters = body.replace(/\{\{\s*\d{1,2}\s*\}\}|\bSTOP\b/g, "").match(/[A-Za-z]/g) ?? [];
  if (letters.length >= 20 && letters.filter((ch) => ch >= "A" && ch <= "Z").length * 2 > letters.length) fail("body", "Do not write the message in capital letters.");
  if (input.category === "marketing" && !/\bSTOP\b/.test(body)) fail("body", "An offer must tell the guest how to stop offers, for example: Reply STOP to stop offers.");
  const buttons = checkButtons(input.buttons ?? []);
  const starterKey = input.starterKey && /^[a-z0-9_]{1,60}$/.test(input.starterKey) ? input.starterKey : null;
  return { name, language: input.language, category: input.category, body, variables, buttons, starterKey };
}

function checkButtons(list: readonly TemplateButton[]): TemplateButton[] {
  if (list.length > TEMPLATE_BUTTONS_MAX) fail("buttons", `Use at most ${TEMPLATE_BUTTONS_MAX} buttons.`);
  if (list.filter((b) => b.kind === "url").length > TEMPLATE_URL_BUTTONS_MAX) fail("buttons", `Use at most ${TEMPLATE_URL_BUTTONS_MAX} link buttons.`);
  const seen = new Set<string>();
  return list.map((b) => {
    const text = b.text.replace(/\s+/g, " ").trim();
    if (text === "") fail("buttons", "Write the words on each button.");
    if (text.length > TEMPLATE_BUTTON_TEXT_MAX) fail("buttons", `Keep the words on a button to ${TEMPLATE_BUTTON_TEXT_MAX} characters.`);
    if (/\{\{|\p{Extended_Pictographic}/u.test(text)) fail("buttons", "A button shows plain words only, with no blank or emoji.");
    if (seen.has(text.toLowerCase())) fail("buttons", "Two buttons cannot have the same words.");
    seen.add(text.toLowerCase());
    if (b.kind === "quick_reply") return { kind: "quick_reply" as const, text };
    const url = b.url.trim();
    if (!/^https:\/\/[^\s{}]+\.[^\s{}]+$/.test(url) || url.length > 2000) fail("buttons", `Give a full link starting with https:// for the button "${text}".`);
    return { kind: "url" as const, text, url };
  });
}

/** Meta's status word to ours (an unknown word is kept pending: nothing is sent with a template we do not understand). */
export function statusFromMeta(word: string | null): TemplateStatus {
  switch ((word ?? "").toLowerCase()) {
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "paused":
    case "disabled":
      return "paused";
    default:
      return "pending";
  }
}

/** The text with the blanks filled in, for a preview or a send. Missing values stay as {{n}}. */
export function fillTemplate(body: string, values: readonly string[]): string {
  return body.replace(/\{\{\s*(\d{1,2})\s*\}\}/g, (m, n: string) => values[Number(n) - 1] ?? m);
}

/** A rejected or draft template may be edited and sent again; a pending, approved or paused one may not (Meta holds the text). */
export const isEditable = (status: TemplateStatus): boolean => status === "draft" || status === "rejected";
