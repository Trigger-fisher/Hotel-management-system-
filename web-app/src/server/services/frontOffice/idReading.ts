import "server-only";
import type { IdReading } from "@shared/dashboards/frontOffice";

// What the reader worker wrote into the job rows (status `read` onward: fields, doubtful fields, clarity), turned into the check-in's IdReading. One row per picture:
// the first card with a name leads, a back or a second picture of the same person only fills what the lead lacks, and other named people become the others in the room.
// Pure: no ID number or name is logged or kept here.
export interface IntakeJobState {
  id: string;
  status: string;
  reasonCode: string | null;
  message: string | null;
  documentType: { type?: string } | null;
  fields: Record<string, { value?: unknown }> | null;
  clarity: { advice?: string | null } | null;
}

export const RETAKE_DEFAULT = "Retake the photo of the card. Hold the phone steady and keep the whole card in the picture.";
const FRONT_NEEDED = "The front of the card, with the name, is needed. Add it and try again.";
const UNUSABLE = "That picture cannot be used. Take a new photo of the card.";
const FORM_KEYS = ["guestName", "idProofType", "idProofNumber", "dateOfBirth", "address", "city", "nationality"] as const;
type FormKey = (typeof FORM_KEYS)[number];

const TYPE_NAMES: Record<string, string> = { Aadhaar: "Aadhaar", PAN: "PAN card", DrivingLicence: "Driving licence", VoterID: "Voter ID", Passport: "Passport", Visa: "Visa" };
const INDIAN_DOCUMENTS = new Set(["Aadhaar", "PAN", "DrivingLicence", "VoterID"]);

export const isFinished = (s: IntakeJobState): boolean => ["read", "saving", "done", "rejected", "needs_attention"].includes(s.status);
export const hasFields = (s: IntakeJobState): boolean => ["read", "saving", "done"].includes(s.status) && s.fields !== null;

const text = (s: IntakeJobState, key: string): string => {
  const v = s.fields?.[key]?.value;
  return typeof v === "string" || typeof v === "number" ? String(v).replace(/\s+/g, " ").trim() : "";
};

/** 17/04/1988 or 17-04-1988 as 1988-04-17; an ISO date as it is; a year alone or anything else is not a date the form can take. */
export function isoDate(raw: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) return raw;
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(raw);
  return dmy ? `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}` : "";
}

interface Person {
  name: string;
  number: string;
  type: string;
  nationality: string;
  dob: string;
  address: string;
}

function personOf(s: IntakeJobState): Person {
  const kind = s.documentType?.type ?? "";
  return {
    name: text(s, "name"),
    number: text(s, "documentNumber"),
    type: TYPE_NAMES[kind] ?? "",
    nationality: text(s, "nationality") || (INDIAN_DOCUMENTS.has(kind) ? "Indian" : ""),
    dob: isoDate(text(s, "dob")),
    address: text(s, "address"),
  };
}

const idOf = (p: Person): string => p.number.replace(/[^0-9a-z]/gi, "").toUpperCase() || p.name.toLowerCase();
const fill = (into: Person, from: Person): void => {
  for (const k of Object.keys(into) as (keyof Person)[]) if (!into[k] && from[k]) into[k] = from[k];
};

export function readingOf(states: IntakeJobState[]): IdReading {
  const people = states.filter(hasFields).map(personOf);
  const named = people.filter((p) => p.name);
  const lines = states.filter((s) => s.status === "rejected").map((s) => (s.reasonCode === "photo_unclear" ? s.message || RETAKE_DEFAULT : UNUSABLE));
  const advice = states.map((s) => s.clarity?.advice).find((a): a is string => Boolean(a));
  if (named.length === 0) {
    const frontNeeded = people.some((p) => p.address || p.number);
    return { outcome: "unclear", fields: {}, unread: [], retake: frontNeeded ? FRONT_NEEDED : lines[0] ?? advice ?? RETAKE_DEFAULT };
  }
  const [lead, ...rest] = named;
  const others: Person[] = [];
  for (const p of rest) {
    if (idOf(p) === idOf(lead)) fill(lead, p);
    else if (!others.some((o) => idOf(o) === idOf(p))) others.push(p);
  }
  for (const p of people.filter((x) => !x.name)) if (!p.number || idOf(p) === idOf(lead)) fill(lead, p);
  const fields: IdReading["fields"] = {};
  const set = (k: FormKey, v: string) => {
    if (v) fields[k] = v;
  };
  set("guestName", lead.name);
  set("idProofType", lead.type);
  set("idProofNumber", lead.number);
  set("dateOfBirth", lead.dob);
  set("address", lead.address);
  set("nationality", lead.nationality);
  return {
    outcome: "read",
    fields,
    unread: FORM_KEYS.filter((k) => !fields[k]),
    retake: lines[0] ?? null,
    others: others.map((o) => ({ fullName: o.name, idType: o.type, idNumber: o.number })),
  };
}
