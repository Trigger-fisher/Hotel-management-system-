// Pure helpers over ui-shared/dashboards/nav.ts for the web shell: which menu items a role sees,
// which sub-menu belongs to a view, and what a view is called. No React, easy to test.
import type { Role } from '@shared/auth/types';
import { userMayOpen } from '@shared/dashboards/features';
import { drillParent, nav, subNav, type DashboardKind, type NavItem, type NavSection } from '@shared/dashboards/nav';

/** Hotel Admin sees every item; Hotel User only the ones that are not admin-only. Hidden items are never listed. */
export function isAdminRole(role: Role): boolean {
  return role !== 'hotel_user';
}

export function visibleSections(sections: NavSection[], admin: boolean): NavSection[] {
  return sections
    // a page that is not built yet (upcoming) is not offered in the menu: it stays reachable by its address
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.hidden && !i.off && !i.upcoming && userMayOpen(i.id) && (admin || !i.adminOnly)) }))
    .filter((s) => s.items.length > 0);
}

function flat(sections: NavSection[]): NavItem[] {
  return sections.flatMap((s) => s.items);
}

/** Sub-menus belong to the hotel dashboard only (Payroll, Website). */
function subEntries(kind: DashboardKind): [string, NavSection[]][] {
  return kind === 'hotel' ? Object.entries(subNav) : [];
}

export function menuItems(kind: DashboardKind): NavItem[] {
  return flat(nav[kind]);
}

/** Every item the shell can name: the main menu and all sub-menus. */
export function findItem(kind: DashboardKind, id: string): NavItem | undefined {
  const main = menuItems(kind).find((i) => i.id === id);
  if (main) return main;
  for (const [, sections] of subEntries(kind)) {
    const hit = flat(sections).find((i) => i.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/** True when `id` is a menu entry (main or sub). Anything else is a drill-in view (detail, form; see drillParent). */
export function isMenuId(kind: DashboardKind, id: string): boolean {
  return findItem(kind, id) !== undefined;
}

export function isMainId(kind: DashboardKind, id: string): boolean {
  return menuItems(kind).some((i) => i.id === id);
}

/** The sub-menu key that owns this view or its root item, or null. */
export function subKeyFor(kind: DashboardKind, viewId: string, rootId: string): string | null {
  for (const [key, sections] of subEntries(kind)) {
    if (key === viewId || key === rootId) return key;
    const items = flat(sections);
    if (items.some((i) => i.id === viewId || i.id === rootId)) return key;
  }
  return null;
}

export function subSections(kind: DashboardKind, key: string | null, admin: boolean): NavSection[] {
  if (!key || kind !== 'hotel') return [];
  return visibleSections(subNav[key] ?? [], admin);
}

/**
 * The menu entry a view lives under (highlighted in the rail). A main entry is its own root; a second-panel entry lives under the
 * entry that owns the panel; a drill-in view (drillParent) lives under its parent's root unless the person is already in the same
 * menu section (a statement opened from Company Profiles keeps Company Profiles lit). Anything else keeps the current root.
 */
export function rootFor(kind: DashboardKind, viewId: string, currentRoot: string): string {
  if (isMainId(kind, viewId)) return viewId;
  const parent = drillParent[viewId];
  if (parent && parent !== viewId) {
    const section = sectionTitleFor(kind, parent);
    if (section !== undefined && section === sectionTitleFor(kind, currentRoot)) return currentRoot;
    return rootFor(kind, parent, currentRoot);
  }
  return subKeyFor(kind, viewId, viewId) ?? currentRoot;
}

/** The menu item that names a view in the header: its own, else (drill-in) its parent's second-panel entry, else the root's. */
export function pageItem(kind: DashboardKind, viewId: string, rootId: string): NavItem | undefined {
  const own = findItem(kind, viewId);
  if (own) return own;
  const parent = drillParent[viewId];
  if (parent && !isMainId(kind, parent)) return findItem(kind, parent) ?? findItem(kind, rootId);
  return findItem(kind, rootId) ?? (parent ? findItem(kind, parent) : undefined);
}

/** The second-panel entry to light for a view: itself, or (drill-in) its parent. */
export function subActiveFor(viewId: string): string {
  return drillParent[viewId] ?? viewId;
}

/** Where "My profile" goes for each dashboard. */
export const profileViewId: Record<DashboardKind, string> = {
  guest: 'guest.profile',
  corporate: 'corporate.myProfile',
  hotel: 'hotel.admin.profile',
  platform: 'platform.profile',
  group: 'group.profile',
};

/** The menu section a view belongs to (e.g. "Front Office"), for the top bar's context label. */
export function sectionTitleFor(kind: DashboardKind, id: string): string | undefined {
  for (const section of nav[kind]) if (section.items.some((i) => i.id === id)) return section.title;
  for (const [, sections] of subEntries(kind)) {
    for (const section of sections) if (section.items.some((i) => i.id === id)) return section.title;
  }
  return undefined;
}
