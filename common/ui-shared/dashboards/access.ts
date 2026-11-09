// Which dashboard pages a person may open, from THEIR OWN session values only (role, hotel-role grants), with no module-wide state.
// The server uses it before it draws a page (an address the person may not open is redirected to "/"), and the shell uses the same rules for its menu,
// so the server's first HTML and the browser's first render always agree. features.ts keeps the module-wide copies for the screens in the browser.
import type { Role } from '../auth/types';
import type { Route } from './routes';
import { moduleOfView } from './features';
import { CONSOLE_MAILBOX_ROLES, hasMailbox } from './mailboxAccess';
import { drillParent, nav, subNav, type DashboardKind, type NavItem, type NavSection } from './nav';

export interface Viewer {
  kind: DashboardKind;
  role: Role;
  /** The session's hotel-role grants (module -> level); null = no filtering (Hotel Admin who holds everything, mock, a platform visit). */
  grants: Readonly<Record<string, string>> | null;
}

const itemsByKind = new Map<DashboardKind, Map<string, NavItem>>();
function itemOf(kind: DashboardKind, id: string): NavItem | undefined {
  let byId = itemsByKind.get(kind);
  if (!byId) {
    byId = new Map(nav[kind].flatMap((s) => s.items.map((i) => [i.id, i] as const)));
    itemsByKind.set(kind, byId);
  }
  return byId.get(id);
}

/** May this person open this menu entry (hidden entries included: a hidden page still has an address)? */
export function mayOpenItem(v: Viewer, item: NavItem): boolean {
  if (item.off) return false;
  // one entry for several mailboxes (Email, MJ 5 Nov 2026): open-able when any of the pages it stands for is
  if (item.opensWith) return item.opensWith.some((id) => {
    const other = itemOf(v.kind, id);
    return other !== undefined && mayOpenItem(v, other);
  });
  if (item.adminOnly && v.role === 'hotel_user') return false;
  if (item.superOnly && v.role !== 'super_admin') return false;
  // My mailbox (platform 0178, 0179): every staff login (the ONE table, mailboxAccess.ts), never a guest or a company login. People with their own console open it there; inside a hotel's
  // dashboard (a visit) it is not theirs to open.
  if (item.staffOnly && !hasMailbox(v.role)) return false;
  if (item.staffOnly && v.kind === 'hotel' && (CONSOLE_MAILBOX_ROLES as readonly string[]).includes(v.role)) return false;
  // A hotel's private page (Conversations, decision 66, C4): never for Super Admin or Platform Admin in a hotel dashboard, a visit included.
  if (item.hotelPrivate && v.kind === 'hotel' && (v.role === 'super_admin' || v.role === 'platform_admin')) return false;
  if (v.grants) {
    const module = moduleOfView(item.id);
    if (module) {
      const level = v.grants[module];
      if (level === undefined || level === 'none') return false;
    }
  }
  return true;
}

/** The menu as this person sees it: open-able, not hidden, empty sections dropped. */
export function menuFor(v: Viewer, sections: NavSection[] = nav[v.kind]): NavSection[] {
  return sections.map((s) => ({ ...s, items: s.items.filter((i) => !i.hidden && mayOpenItem(v, i)) })).filter((s) => s.items.length > 0);
}

/** The first page ("/"): the first entry of the menu as this person sees it. */
export function homeOf(v: Viewer): string {
  return menuFor(v)[0]?.items[0]?.id ?? nav[v.kind][0]?.items[0]?.id ?? '';
}

/** Every page id this person may open by address: menu entries (hidden ones too) and, for the hotel, the second-panel entries. */
export function openableIds(v: Viewer): Set<string> {
  const ids = new Set<string>();
  for (const s of nav[v.kind]) for (const i of s.items) if (mayOpenItem(v, i)) ids.add(i.id);
  if (v.kind === 'hotel') for (const sections of Object.values(subNav)) for (const s of sections) for (const i of s.items) if (mayOpenItem(v, i)) ids.add(i.id);
  return ids;
}

/** May this person open the page of this route? A detail page counts when its list (drillParent) does. */
export function mayOpenRoute(v: Viewer, route: Route, ids: Set<string> = openableIds(v)): boolean {
  let id: string | undefined = route.viewId;
  for (let guard = 0; id && guard < 6; guard++) {
    if (ids.has(id)) return true;
    id = drillParent[id];
  }
  return false;
}
