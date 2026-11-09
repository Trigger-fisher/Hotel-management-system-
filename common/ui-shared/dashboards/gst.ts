// GST numbers (MJ, 2 Nov 2026: "save the GST and the company details when a user searches for it the first time, then reuse it"). Two parts:
//   1. checkGstin(): free, here, no service: the shape, the state (first two digits), the PAN (the next ten) and the check character (the last one), so a mistyped number is caught
//      at once and the state fills in by itself;
//   2. the company behind a valid GSTIN (GstRegistryEntry): looked up once from a GST lookup service, then kept in platform.gst_registry (platform 0167) and reused by every hotel.
import { PLATFORM_STATES } from './platform';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SHAPE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** The check character of the first 14 characters of a GSTIN (the GSTN's base-36 checksum), or null when a character is not 0-9 / A-Z. */
export function gstinCheckChar(first14: string): string | null {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const value = ALPHABET.indexOf(first14.charAt(i));
    if (value < 0) return null;
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return ALPHABET.charAt((36 - (sum % 36)) % 36);
}

export type GstinProblem = 'empty' | 'length' | 'format' | 'state' | 'checksum';

export interface GstinCheck {
  /** The number as it is kept: upper case, no spaces. */
  gstin: string;
  ok: boolean;
  problem: GstinProblem | null;
  stateCode: string | null;
  state: string | null;
  pan: string | null;
}

/** Everything that can be told about a GSTIN without asking anyone. */
export function checkGstin(raw: string): GstinCheck {
  const gstin = raw.replace(/\s+/g, '').toUpperCase();
  const stateCode = /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : null;
  const state = stateCode ? (PLATFORM_STATES.find((s) => s.gstCode === stateCode)?.name ?? null) : null;
  const pan = gstin.length >= 12 && /^[A-Z]{5}\d{4}[A-Z]$/.test(gstin.slice(2, 12)) ? gstin.slice(2, 12) : null;
  const fail = (problem: GstinProblem): GstinCheck => ({ gstin, ok: false, problem, stateCode, state, pan });
  if (gstin === '') return fail('empty');
  if (gstin.length !== 15) return fail('length');
  if (!SHAPE.test(gstin)) return fail('format');
  if (!state) return fail('state');
  if (gstinCheckChar(gstin.slice(0, 14)) !== gstin.charAt(14)) return fail('checksum');
  return { gstin, ok: true, problem: null, stateCode, state, pan };
}

export const gstCopy = {
  problems: {
    empty: 'Enter the GSTIN.',
    length: 'A GSTIN has 15 characters.',
    format: 'This is not a GSTIN. It looks like 24ABCDE1234F1Z5.',
    state: 'The first two digits are not an Indian state code.',
    checksum: 'This GSTIN has a typing mistake: its last character does not match. Check the number.',
  } satisfies Record<GstinProblem, string>,
  found: 'Company details filled in from the GST record.',
  saved: 'Filled in from the saved GST record.',
  /** GST records never carry a phone number or email. */
  noContact: 'The GST record has no phone number or email: add them below.',
  notFound: 'No GST record was found for this number.',
  notReady: 'Automatic company lookup is not switched on yet. The state was filled in from the number.',
  failed: 'The GST lookup did not answer. Try again in a minute, or type the details.',
  cancelled: 'This GST registration is cancelled.',
  /** The GSTIN is already one of this hotel's own companies: said, linked, and not fetched. */
  inHotel: (name: string) => `Already in your hotel: ${name}`,
} as const;

export type GstStatus = 'active' | 'cancelled' | 'suspended' | 'inactive' | 'unknown';

/** One company as the GST record shows it (platform.gst_registry). */
export interface GstRegistryEntry {
  gstin: string;
  pan: string;
  stateCode: string;
  legalName: string | null;
  tradeName: string | null;
  status: GstStatus;
  taxpayerType: string | null;
  constitution: string | null;
  registeredOn: string | null;
  cancelledOn: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  /** What the business does, as registered (e.g. "Retail Business"); empty when the record does not say. */
  natureOfBusiness: string[];
  /** Whether the registration is blocked from filing, in the service's own word ("Unblocked", "Blocked"); null when it does not say. */
  blockStatus: string | null;
  /** The state tax office the taxpayer is under, as the service gives it. */
  stateJurisdiction: string | null;
  /** The principal place of business in parts, as the service gives them (null = not given). */
  street: string | null;
  locality: string | null;
  buildingName: string | null;
  buildingNumber: string | null;
  floor: string | null;
  landmark: string | null;
  /** Where it came from: the id of the lookup service (never typed by a person; the central table is written by the lookup alone). */
  source: string;
  fetchedAt: string;
}

/** The answer of a lookup: the free check, and the company when one is known. */
export interface GstLookupResult {
  check: GstinCheck;
  entry: GstRegistryEntry | null;
  /**
   * hotel: this GSTIN is already one of the signed-in hotel's own companies (`inHotel`); nothing was fetched and no credit was used.
   * saved: from our database (free); provider: just looked up and saved; none: not found or not looked up.
   * The order is always: the hotel's own companies, then the saved central record, then the lookup service (once).
   */
  from: 'hotel' | 'saved' | 'provider' | 'none';
  /** Set when `from` is 'hotel': the company of this hotel that already has the GSTIN. */
  inHotel?: { id: string; name: string };
  /** A lookup service is set up on this server. */
  providerReady: boolean;
  /** A plain sentence for the form. */
  message: string;
}
