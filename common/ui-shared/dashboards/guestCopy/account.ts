// Decision 71: the words of Account (settings rows, the edit sheets, sign-in and security, Sign out last) and its small pure rules (the ID proof draft, the
// profile body one sheet sends, a sign-in's status word). Owned by the Account page. Rules: "Sign in" never "Log in"; money ₹126,000.00; dates 25 Oct 2026.
import { idProofOptions, type GuestProfile, type IdProofType, type ProfileInput } from '../guest';
import type { GuestSignIn } from '../guestAccount';

export const accountCopy = {
  title: 'Account',
  signOut: 'Sign out',
  guestSince: (date: string, stays: number) => `Guest since ${date} · ${stays === 1 ? '1 stay' : `${stays} stays`}`,
  photoTitle: 'Your photo',
  photoOpen: 'Change your photo',
  sameEverywhere: 'Your details are the same at every hotel: a change here shows everywhere.',

  detailsTitle: 'Your details',
  name: 'Full name',
  email: 'Email',
  emailSub: 'Used only for bills and notices',
  emailMissing: 'Add your email to get bills and notices',
  city: 'City',
  address: 'Address',
  idProof: 'ID proof',
  idType: 'ID type',
  idNumber: 'ID number',
  idHint: 'We show only the last 4 digits.',
  idNewType: 'Enter the full ID number for the new ID type.',
  mobile: 'Mobile (your sign-in)',
  mobileHint: 'To change it, ask reception.',
  username: 'Username',
  notAdded: 'Not added yet',
  /** "Change full name", "Change ID proof" (a capitalised short form stays as it is). */
  edit: (what: string) => `Change ${what.replace(/^([A-Z])(?=[a-z])/, (ch) => ch.toLowerCase())}`,
  save: 'Save',
  saving: 'Saving…',
  cancel: 'Cancel',
  saved: 'Your details are saved.',
  savedPartly: (hotels: string) => `Saved. ${hotels} could not be reached and will be updated next time.`,

  securityTitle: 'Sign-in and security',
  password: 'Change password',
  passwordSub: 'At least 8 characters, with a letter and a number',
  passwordChanging: 'Changing…',
  signInCode: 'Sign-in code',
  signInCodeSub: (on: boolean) => (on ? 'On · we email you a 6-digit code each time you sign in' : 'Off · add a 6-digit emailed code to each sign-in'),
  signInCodeOn: 'A code will be emailed to you when you sign in.',
  signInCodeOff: 'You will sign in with your password only.',
  signInCodeOffTitle: 'Turn off the sign-in code',
  signInCodeOffBody: 'Enter your current password to turn off the emailed code.',
  currentPassword: 'Your current password',
  turnOff: 'Turn it off',
  keepOn: 'Keep it on',
  signIns: 'Recent sign-ins',
  signInsSub: (last: string) => `Last sign-in ${last}`,
  signInsTotals: (ok: number, failed: number) => `${ok} signed in · ${failed} failed ${failed === 1 ? 'attempt' : 'attempts'}`,
  signInsEmpty: 'No sign-ins to show yet.',

  helpTitle: 'Help',
  callReception: 'Call reception',
  callSub: (phone: string) => `${phone} · for your mobile number, ID or anything else`,
} as const;

/** "AJ" from "Amit Joshi" (two letters at most). */
export const initialsOf = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();

/** "Aadhaar card", or "Not added yet" for none. */
export const idProofLabel = (type: IdProofType): string => idProofOptions.find((o) => o.value === type)?.label ?? accountCopy.notAdded;

/** The ID proof row's value: "Aadhaar card · XXXX XXXX 4321", or "Not added yet". */
export const idProofValue = (p: Pick<GuestProfile, 'idProofType' | 'idProofNumber'>): string =>
  p.idProofType === 'none' ? accountCopy.notAdded : [idProofLabel(p.idProofType), p.idProofNumber].filter(Boolean).join(' · ');

/** The whole profile body (PUT /guest/profile takes every field) with one sheet's change on top: the other fields go back as they are (the ID number masked, which keeps it). */
export const profileInput = (p: GuestProfile, patch: Partial<ProfileInput> = {}): ProfileInput => ({
  name: p.name,
  email: p.email,
  city: p.city,
  address: p.address,
  idProofType: p.idProofType,
  idProofNumber: p.idProofNumber,
  notifyEmail: p.notifyEmail,
  ...patch,
});

/**
 * The ID number field after the ID type is changed. The server keeps the stored number only when the masked one comes back with the SAME type, so a new type
 * needs the full number: the masked value is emptied. Back to the saved type, an empty field gets the masked value again; "none" empties it.
 */
export function idNumberForType(nextType: IdProofType, draft: string, saved: Pick<GuestProfile, 'idProofType' | 'idProofNumber'>): string {
  if (nextType === 'none') return '';
  if (nextType === saved.idProofType) return draft.trim() === '' ? saved.idProofNumber : draft;
  return draft === saved.idProofNumber ? '' : draft;
}

/** The ID proof sheet's own check before it sends: a number is needed unless "Not added yet", and a new type cannot reuse the masked number. */
export function checkIdProof(type: IdProofType, number: string, saved: Pick<GuestProfile, 'idProofType' | 'idProofNumber'>): string | undefined {
  if (type === 'none') return undefined;
  const n = number.trim();
  if (!n) return 'Enter the ID number, or pick "Not added yet".';
  if (type !== saved.idProofType && saved.idProofNumber && n === saved.idProofNumber) return accountCopy.idNewType;
  return undefined;
}

/** A sign-in's status word: "Failed attempt" (red), "Active now", or "Signed out". IP addresses are never shown. */
export const signInStatus = (s: Pick<GuestSignIn, 'ok' | 'ended'>): string => (!s.ok ? 'Failed attempt' : s.ended ? 'Signed out' : 'Active now');
