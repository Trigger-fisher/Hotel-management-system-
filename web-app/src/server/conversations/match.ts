import "server-only";

// How an address or a number is kept and matched (decision 66): an email address in lower case; a phone number as digits with the country code (a bare 10-digit Indian mobile
// gets 91); matching a number to a guest uses its last 10 digits, so +91 98250 12345, 098250 12345 and 9825012345 are the same person.

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+$/;

/** The address as kept (lower case, trimmed), or null when it is not one. */
export function normaliseEmail(value: string | null | undefined): string | null {
  const v = (value ?? "").trim().toLowerCase();
  return v.length > 0 && v.length <= 254 && EMAIL.test(v) ? v : null;
}

/** The number as kept: digits only, with the country code (91 for a bare 10-digit Indian mobile, a leading 0 dropped); null when it is not 8 to 15 digits. */
export function normalisePhone(value: string | null | undefined): string | null {
  let d = (value ?? "").replace(/[^0-9]/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10 && /^[6-9]/.test(d)) d = `91${d}`;
  return d.length >= 8 && d.length <= 15 ? d : null;
}

/** The last 10 digits a guest's number is matched by. */
export const last10 = (digits: string): string => digits.replace(/[^0-9]/g, "").slice(-10);

/** "+91 98250 12345" for a kept Indian number, "+<digits>" otherwise. */
export function displayPhone(digits: string): string {
  return digits.length === 12 && digits.startsWith("91") ? `+91 ${digits.slice(2, 7)} ${digits.slice(7)}` : `+${digits}`;
}
