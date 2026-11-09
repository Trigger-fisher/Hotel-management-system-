// What Pallav's Users / Roles / Profile screens add to the plain level model of the mock: a role's icon and colour, the
// five tick columns (View, Add, Edit, Delete, PDF) read off a level, and "3 hours ago" wording (Carbon diffForHumans).
import { permissionModules, type AdminRole, type PermissionLevel, type PermissionMap } from '@shared/dashboards/admin';

const LOOK: Record<string, { icon: string; accent: string }> = {
  'r-super': { icon: 'shield-fill-check', accent: '#2B2B31' }, // check-shared-ignore: a role's saved colour
  'r-admin': { icon: 'person-gear', accent: '#B45309' }, // check-shared-ignore: a role's saved colour
  'r-editor': { icon: 'pencil-square', accent: '#0F766E' }, // check-shared-ignore: a role's saved colour
  'r-viewer': { icon: 'eye', accent: '#64748B' }, // check-shared-ignore: a role's saved colour
  'r-accounts': { icon: 'cash-coin', accent: '#1D4ED8' }, // check-shared-ignore: a role's saved colour
};

export const ICON_CHOICES = ['person', 'person-gear', 'shield-fill-check', 'pencil-square', 'eye', 'briefcase', 'cash-coin', 'people-fill', 'clipboard-check', 'headset', 'key', 'star-fill'];
export const ACCENT_CHOICES = ['#2B2B31', '#B45309', '#0F766E', '#64748B', '#BE123C', '#1D4ED8', '#047857', '#C2410C'];

type Looked = { id: string; icon?: string; accent?: string };
export const roleIcon = (r: Looked | undefined): string => r?.icon ?? (r ? LOOK[r.id]?.icon : undefined) ?? 'person';
export const roleAccent = (r: Looked | undefined): string => r?.accent ?? (r ? LOOK[r.id]?.accent : undefined) ?? '#111114';
/** The top rung (it holds everything, so its ticks are locked): the first built-in role of the ladder (the mock calls it `r-super`). */
export const topRole = (roles: AdminRole[], id: string): boolean => id === 'r-super' || roles.find((r) => r.builtIn)?.id === id;

/** The five columns of the roles grid, each switched on by a level (Pallav: View, Add, Edit, Delete, PDF). */
export const ACTIONS: { key: string; label: string; hint: string; needs: PermissionLevel; sensitive?: boolean }[] = [
  { key: 'view', label: 'View', hint: 'Open the screen and read what is on it.', needs: 'view' },
  { key: 'add', label: 'Add', hint: 'Record new entries.', needs: 'create' },
  { key: 'edit', label: 'Edit', hint: 'Change entries that already exist.', needs: 'edit' },
  { key: 'delete', label: 'Delete', hint: 'Remove entries. Treat with care.', needs: 'full', sensitive: true },
  { key: 'pdf', label: 'PDF', hint: 'Open and download the PDF of a record.', needs: 'full' },
];
const ORDER: PermissionLevel[] = ['none', 'view', 'create', 'edit', 'full'];
const rank = (l: PermissionLevel | undefined): number => ORDER.indexOf(l ?? 'none');

export const cellOn = (level: PermissionLevel | undefined, action: string): boolean => {
  const a = ACTIONS.find((x) => x.key === action);
  return Boolean(a) && rank(level) >= rank(a?.needs);
};

/** Ticking a box gives that level (never less than the role has); clearing one drops to the level just below it. */
export function withCell(level: PermissionLevel | undefined, action: string, on: boolean): PermissionLevel {
  const a = ACTIONS.find((x) => x.key === action);
  if (!a) return level ?? 'none';
  const need = rank(a.needs);
  if (on) return rank(level) >= need ? (level ?? 'none') : (a.needs);
  return rank(level) < need ? (level ?? 'none') : (ORDER[need - 1] ?? 'none');
}

/** How many tick boxes a map of levels switches on. */
export const allowedCount = (levels: PermissionMap): number => permissionModules.reduce((n, m) => n + ACTIONS.filter((a) => cellOn(levels[m.key], a.key)).length, 0);
export const sensitiveCount = (levels: PermissionMap): number => permissionModules.reduce((n, m) => n + ACTIONS.filter((a) => a.sensitive && cellOn(levels[m.key], a.key)).length, 0);
export const TOTAL_CELLS = permissionModules.length * ACTIONS.length;

/** What a role really has: its own ticks plus, when it inherits, everything the role below it has. `roles` are in ladder order. */
export function effectiveLevels(roles: AdminRole[], index: number): PermissionMap {
  const own = roles[index]?.levels ?? {};
  if (!roles[index]?.inherits || index >= roles.length - 1) return own;
  const below = effectiveLevels(roles, index + 1);
  return Object.fromEntries(permissionModules.map((m) => [m.key, rank(below[m.key]) > rank(own[m.key]) ? (below[m.key] ?? 'none') : (own[m.key] ?? 'none')])) as PermissionMap;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number) => String(n).padStart(2, '0');
/** "06 Oct" and "14:05", the way Pallav's KPI card writes the last sign-in. */
export const dayMonth = (iso: string): string => { const d = new Date(iso); return `${two(d.getDate())} ${MONTHS[d.getMonth()]}`; };
export const clock24 = (iso: string): string => { const d = new Date(iso); return `${two(d.getHours())}:${two(d.getMinutes())}`; };

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
export const deviceIcon = (device: string): string => (/iphone|android/i.test(device) ? 'phone' : /mac|ipad/i.test(device) ? 'laptop' : 'display');

/** A module's icon (Pallav Permissions::modules() 'icon', without "bi-"), on the roles grid and a person's permissions tab. */
export const moduleIcon: Record<string, string> = {
  dashboard: 'speedometer2',
  revenue: 'cash-coin',
  expense: 'cash-stack',
  handover: 'arrow-left-right',
  bills: 'receipt',
  companies: 'buildings',
  payroll: 'people-fill',
  reports: 'file-earmark-bar-graph',
  pms: 'door-closed',
  website: 'globe2',
  users: 'person-badge',
  access: 'diagram-3',
  masters: 'list-check',
};

/** The one-line "what is this screen" under a module's name on the roles grid. */
export const moduleAbout: Record<string, string> = {
  dashboard: 'The day at a glance.',
  revenue: 'Money received each day.',
  expense: 'Money spent each day.',
  handover: 'Shift cash handed from one person to the next.',
  bills: 'Guest bills and advances.',
  companies: 'Company accounts, customers and leads.',
  payroll: 'Staff, attendance, salary and advances.',
  reports: 'Totals, statements and exports.',
  pms: 'Rooms, bookings, check-in and check-out.',
  website: 'Pages and offers on the hotel website.',
  users: 'Who can sign in to this hotel.',
  access: 'Roles and what each may do.',
  masters: 'Lists and rates the other screens use.',
};
