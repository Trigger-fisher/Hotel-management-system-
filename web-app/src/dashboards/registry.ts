// Lazy registry of dashboard screens. Each module group is its own chunk that loads on first use,
// so a Guest never downloads Hotel code (and the other way round). The shell asks for a view id;
// the group that owns it is found by the id's prefix (the menu itself comes from ui-shared nav.ts).
import type { ComponentType } from 'react';
import type { ModuleGroup } from '@shared/dashboards/nav';
import type { ScreenMap, ScreenProps } from './types';

type Screen = ComponentType<ScreenProps>;

const loaders: Record<ModuleGroup, () => Promise<{ screens: ScreenMap }>> = {
  guest: () => import('./groups/guest'),
  corporate: () => import('./groups/corporate'),
  overview: () => import('./groups/overview'),
  frontOffice: () => import('./groups/frontOffice'),
  platform: () => import('./groups/platform'),
  group: () => import('./groups/group'),
  billing: () => import('./groups/billing'),
  cash: () => import('./groups/cash'),
  companies: () => import('./groups/companies'),
  payrollCore: () => import('./groups/payrollCore'),
  payrollPay: () => import('./groups/payrollPay'),
  website: () => import('./groups/website'),
  admin: () => import('./groups/admin'),
  conversations: () => import('./groups/conversations'),
};

/** Groups that may own a view id, most likely first. */
export function groupsFor(viewId: string): ModuleGroup[] {
  if (viewId.startsWith('guest.')) return ['guest'];
  // Conversations (decision 66): the hotel's, the platform's, the group's inbox and everyone's My mailbox (platform 0179) share one group, so this comes before the platform and group lines.
  if (/^(hotel|platform)\.(conversations?|email|emailThread|whatsapp|whatsappThread)$/.test(viewId)) return ['conversations'];
  if (/^(hotel|platform|group)\.(myMailbox|myMailboxThread)$/.test(viewId) || /^group\.(email|emailThread)$/.test(viewId)) return ['conversations'];
  if (viewId.startsWith('platform.')) return ['platform'];
  if (viewId.startsWith('group.')) return ['group'];
  if (viewId.startsWith('corporate.')) return ['corporate'];
  if (viewId.startsWith('hotel.fo.')) return ['frontOffice'];
  if (viewId.startsWith('hotel.billing.')) return ['billing'];
  if (viewId.startsWith('hotel.cash.')) return ['cash'];
  if (viewId.startsWith('hotel.co.')) return ['companies'];
  if (viewId.startsWith('hotel.payroll.')) return ['payrollCore', 'payrollPay'];
  if (viewId.startsWith('hotel.web.')) return ['website'];
  if (viewId.startsWith('hotel.admin.')) return ['admin'];
  if (viewId === 'hotel.dashboard' || viewId === 'hotel.books' || viewId.startsWith('hotel.reports.') || viewId.startsWith('hotel.overview.')) return ['overview'];
  return [];
}

const loadedGroups = new Map<ModuleGroup, Promise<ScreenMap>>();
const resolved = new Map<string, Screen | null>();

function loadGroup(group: ModuleGroup): Promise<ScreenMap> {
  let p = loadedGroups.get(group);
  if (!p) {
    p = loaders[group]().then((m) => {
      // Every screen of a loaded group is known at once, so a later menu click (or a preloaded group) needs no waiting at all.
      for (const [id, screen] of Object.entries(m.screens)) if (screen && !resolved.has(id)) resolved.set(id, screen);
      return m.screens;
    });
    // A failed chunk load must not be remembered, so a retry can try again.
    p.catch(() => loadedGroups.delete(group));
    loadedGroups.set(group, p);
  }
  return p;
}

type IdleHandle = number | ReturnType<typeof setTimeout>;
const idle = (fn: () => void): IdleHandle =>
  typeof window !== 'undefined' && 'requestIdleCallback' in window ? window.requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 300);
const cancelIdle = (h: IdleHandle) => {
  if (typeof window !== 'undefined' && 'cancelIdleCallback' in window && typeof h === 'number') window.cancelIdleCallback(h);
  else clearTimeout(h);
};

/**
 * Loads, while the browser is idle, every group that owns one of these view ids (one group per idle slot, so typing and
 * scrolling are never blocked). Returns a function that stops what has not started yet.
 */
export function preloadGroupsFor(viewIds: string[]): () => void {
  const todo: ModuleGroup[] = [];
  for (const id of viewIds) for (const g of groupsFor(id)) if (!loadedGroups.has(g) && !todo.includes(g)) todo.push(g);
  let handle: IdleHandle | null = null;
  let stopped = false;
  const next = () => {
    handle = null;
    if (stopped) return;
    const group = todo.shift();
    if (!group) return;
    void loadGroup(group).catch(() => undefined);
    if (todo.length) handle = idle(next);
  };
  if (todo.length) handle = idle(next);
  return () => {
    stopped = true;
    if (handle !== null) cancelIdle(handle);
  };
}

/** The screen if its group has already loaded (no waiting), else undefined. `null` = no such view. */
export function peekScreen(viewId: string): Screen | null | undefined {
  return resolved.get(viewId);
}

/** Loads the owning group (once) and resolves the screen, or null when the view does not exist yet. Rejects when a chunk fails to load (offline, new deploy). */
export async function loadScreen(viewId: string): Promise<Screen | null> {
  const known = resolved.get(viewId);
  if (known !== undefined) return known;
  for (const group of groupsFor(viewId)) {
    const screen = (await loadGroup(group))[viewId];
    if (screen) {
      resolved.set(viewId, screen);
      return screen;
    }
  }
  resolved.set(viewId, null);
  return null;
}
