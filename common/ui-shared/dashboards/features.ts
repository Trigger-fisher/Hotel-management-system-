// ---- What the signed-in person may open (the grants of their hotel role) ----
// The real session may carry `user.grants`: module key -> level ('view' | 'edit' | 'full'), a module the role has no level in is left out.
// A menu entry for a module without a level is not listed (a Hotel User without Front Office never sees Front Desk). No `grants` (mock,
// older sessions, Hotel Admin who holds everything) means no filtering; the server's 403 stays the fallback.
let grants: Readonly<Record<string, string>> | null = null;

export function setUserGrants(g: Readonly<Record<string, string>> | null | undefined): void {
  grants = g ?? null;
}

/** The permission module an hotel menu entry belongs to (docs/BACKEND.md permission catalogue), or undefined for entries everyone sees. */
export function moduleOfView(id: string): string | undefined {
  if (id.startsWith('hotel.billing.')) return 'bills';
  if (id === 'hotel.cash.revenue') return 'revenue';
  if (id === 'hotel.cash.expenses') return 'expense';
  if (id === 'hotel.cash.handover') return 'handover';
  if (id.startsWith('hotel.co.')) return 'companies';
  if (id.startsWith('hotel.payroll.')) return 'payroll';
  if (id.startsWith('hotel.reports')) return 'reports';
  if (id.startsWith('hotel.fo.')) return 'pms';
  if (id.startsWith('hotel.web.')) return 'website';
  if (id === 'hotel.conversations' || id === 'hotel.conversation' || id === 'hotel.email' || id === 'hotel.emailThread') return 'conversations';
  // WhatsApp is its own right (MJ, 4 Nov 2026): a hotel can give Email without it
  if (id === 'hotel.whatsapp' || id === 'hotel.whatsappThread') return 'whatsapp';
  if (id === 'hotel.admin.masters') return 'masters';
  if (id === 'hotel.admin.payments') return 'bills';
  if (id === 'hotel.admin.users') return 'users';
  if (id === 'hotel.admin.roles') return 'access';
  return undefined;
}

export function userMayOpen(viewId: string): boolean {
  if (!grants) return true;
  const m = moduleOfView(viewId);
  if (!m) return true;
  const level = grants[m];
  return level !== undefined && level !== 'none';
}

/** May the person change things in this module? Only a role with the level edit or full (or no grants at all: mock, older sessions, Hotel Admin who holds everything). A view-only person never sees a button that would end in "Not allowed". The server still checks. */
/** A platform or group visit inside a hotel is read-only: no one there may change anything (set by the shell with the read-only view of lib/api/mode.ts). */
let visitReadOnly = false;
export function setVisitReadOnly(on: boolean): void {
  visitReadOnly = on;
}

export function userMayEdit(module: string): boolean {
  if (visitReadOnly) return false;
  if (!grants) return true;
  const level = grants[module];
  return level === 'edit' || level === 'full';
}
