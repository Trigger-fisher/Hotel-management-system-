// My vault (MJ, 5 Nov 2026: "superadmin have their own vault to save all his details personal"; platform 0190): the signed-in Super Admin's own passwords, notes, bank details,
// ID document details, cards and keys. Only its owner lists or opens it; anyone else gets "not found". The list never carries a secret or the private notes.

export type PersonalVaultKind = 'password' | 'note' | 'bank' | 'id_document' | 'card' | 'key';
export const PERSONAL_VAULT_KINDS: readonly PersonalVaultKind[] = ['password', 'note', 'bank', 'id_document', 'card', 'key'];

export interface PersonalVaultItem {
  id: string;
  kind: PersonalVaultKind;
  title: string;
  username: string | null;
  url: string | null;
  hasSecret: boolean;
  hasNotes: boolean;
  /** YYYY-MM-DD, when a card or an ID document runs out. */
  expiresOn: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface PersonalVaultInput {
  kind: PersonalVaultKind;
  title: string;
  username?: string | null;
  url?: string | null;
  secret?: string;
  notes?: string;
  expiresOn?: string | null;
}

export const personalVaultCopy = {
  page: 'My vault',
  sub: 'Your own passwords, bank and card details, ID documents and keys. Only you can open it: other admins cannot see that it exists.',
  title: 'My vault',
  intro: 'Secrets are locked when saved and open only when you press Show. They hide again by themselves after 30 seconds.',
  add: 'Add to my vault',
  empty: { title: 'Your vault is empty', body: 'Keep your own passwords, bank details, ID document numbers and keys here, locked.' },
  search: 'Search my vault…',
  kinds: { password: 'Password', note: 'Secure note', bank: 'Bank details', id_document: 'ID document', card: 'Card', key: 'Key' } satisfies Record<PersonalVaultKind, string>,
  kindIcons: { password: 'key', note: 'journal-lock', bank: 'bank', id_document: 'person-vcard', card: 'credit-card', key: 'key-fill' } satisfies Record<PersonalVaultKind, string>,
  secretLabel: { password: 'Password', note: 'Secret', bank: 'Account number and IFSC', id_document: 'Document number', card: 'Card number, expiry and CVV', key: 'Key or code' } satisfies Record<PersonalVaultKind, string>,
  fields: { kind: 'Type', title: 'Name', username: 'User name or ID', url: 'Website', secret: 'Secret', notes: 'Private notes', expiresOn: 'Expires on' },
  hints: {
    title: 'For example "Personal Gmail" or "PAN card".',
    secretKeep: 'Locked. Leave empty to keep the saved one, or type a new one to replace it.',
    notes: 'Locked like the secret. Recovery codes, security answers, who to call.',
  },
  urlPlaceholder: 'mail.google.com',
  show: 'Show',
  hide: 'Hide',
  copy: 'Copy',
  copied: 'Copied. It clears from the clipboard in 30 seconds.',
  edit: 'Edit',
  remove: 'Remove',
  removeAsk: (title: string) => `Remove “${title}” from your vault?`,
  removeBody: 'It disappears from the list. It stays stored, locked, and can be brought back if needed.',
  saved: (title: string) => `${title} saved in your vault.`,
  removed: (title: string) => `${title} removed from your vault.`,
  expired: 'Expired',
  expiresSoon: 'Expires soon',
  nothingLocked: 'Nothing locked is stored for this item.',
  /** The audit row's words: never the item's name or its secret. */
  auditLabel: 'My vault',
} as const;
