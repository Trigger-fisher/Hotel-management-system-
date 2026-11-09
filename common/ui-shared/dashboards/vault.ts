// The vault (MJ, 2 Nov 2026; platform 0168): the important things of a hotel kept by the Super Admin in the hotel's profile (Platform > Hotels > a hotel > Vault). A list shows the
// title, kind, user name and web address; the secret (password, PIN, account or card number) and the private notes are sealed on the server and shown only when the Super Admin
// presses Show, which is recorded in the hotel's Activity.

export type VaultKind = 'login' | 'bank' | 'card' | 'licence' | 'note' | 'other';
export const VAULT_KINDS: readonly VaultKind[] = ['login', 'bank', 'card', 'licence', 'note', 'other'];

/** One stored thing as the list shows it: never the secret or the notes themselves. */
export interface VaultItem {
  id: string;
  kind: VaultKind;
  title: string;
  username: string | null;
  url: string | null;
  hasSecret: boolean;
  hasNotes: boolean;
  /** YYYY-MM-DD, when a licence or card runs out. */
  expiresOn: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

/** What Show opens. */
export interface VaultSecret {
  secret: string | null;
  notes: string | null;
}

/** Add or change. On a change, `secret` / `notes` left out (undefined) keep what is stored; an empty string removes it. */
export interface VaultInput {
  kind: VaultKind;
  title: string;
  username?: string | null;
  url?: string | null;
  secret?: string;
  notes?: string;
  expiresOn?: string | null;
}

export const vaultCopy = {
  tab: 'Vault',
  title: 'Hotel vault',
  intro: 'Passwords, bank and card details, licences and notes for this hotel. Secrets are locked when saved and open only when you press Show; they hide again after 30 seconds and every Show is recorded in Activity.',
  add: 'Add to vault',
  empty: { title: 'Nothing in the vault yet', body: 'Keep this hotel’s OTA logins, bank details, licence numbers and codes here, locked.' },
  search: 'Search the vault…',
  kinds: { login: 'Login', bank: 'Bank account', card: 'Card', licence: 'Licence', note: 'Secure note', other: 'Other' } satisfies Record<VaultKind, string>,
  kindIcons: { login: 'key', bank: 'bank', card: 'credit-card', licence: 'patch-check', note: 'journal-lock', other: 'safe' } satisfies Record<VaultKind, string>,
  /** What the secret field is called for each kind. */
  secretLabel: { login: 'Password', bank: 'Account number and password', card: 'Card number, expiry and PIN', licence: 'Licence number', note: 'Secret', other: 'Secret' } satisfies Record<VaultKind, string>,
  fields: { kind: 'Type', title: 'Name', username: 'User name or ID', url: 'Website', secret: 'Secret', notes: 'Private notes', expiresOn: 'Expires on' },
  hints: {
    title: 'For example "Booking.com extranet" or "HDFC current account".',
    secretKeep: 'Locked. Leave empty to keep the saved one, or type a new one to replace it.',
    notes: 'Locked like the secret. Recovery codes, security answers, who to call.',
  },
  urlPlaceholder: 'admin.booking.com',
  show: 'Show',
  hide: 'Hide',
  copy: 'Copy',
  copied: 'Copied. It clears from the clipboard in 30 seconds.',
  edit: 'Edit',
  remove: 'Remove',
  removeAsk: (title: string) => `Remove “${title}” from the vault?`,
  removeBody: 'It disappears from the list. It stays stored, locked, and can be brought back if needed.',
  saved: (title: string) => `${title} saved in the vault.`,
  removed: (title: string) => `${title} removed from the vault.`,
  expired: 'Expired',
  expiresSoon: 'Expires soon',
  nothingLocked: 'Nothing locked is stored for this item.',
  superOnly: 'Only the Super Admin can open the vault.',
} as const;

/** "expired", "soon" (within 30 days) or null, for a YYYY-MM-DD date against today's YYYY-MM-DD. */
export function vaultExpiry(expiresOn: string | null, today: string): 'expired' | 'soon' | null {
  if (!expiresOn) return null;
  if (expiresOn < today) return 'expired';
  const days = (Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  return days <= 30 ? 'soon' : null;
}
