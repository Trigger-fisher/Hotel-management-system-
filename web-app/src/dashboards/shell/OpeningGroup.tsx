'use client';

// The opening screen's code arrives with the first HTML (speed, 24 Oct 2026). The screen groups are lazy chunks (registry.ts), and the shell used to ask for the
// opening screen's group only after hydration: one more round trip before the first screen could even start loading its data. Rendered on the server by
// SeededApp with the page the seed opens on, this draws nothing, but Next writes the group chunk's preload tags into the first HTML (next/dynamic with ssr),
// so the browser has the chunk before hydration; registry.ts imports the very same module, so its loadGroup resolves from the module cache and useScreen
// sets the screen on its first effect. The screen's data still loads only in the browser, and PageSkeleton still shows until hydration.
// A group module is evaluated on the server here: the groups' index files are screen maps and hold no browser-only code at module scope. Should one
// ever fail on the server, the Suspense boundary falls back to the browser for this (empty) piece and the page itself still renders.
import dynamic from 'next/dynamic';
import { Suspense, type ComponentType } from 'react';
import type { ModuleGroup } from '@shared/dashboards/nav';
import { groupsFor } from '../registry';

/** The chunk is wanted, not its screens: the loaded module stands in for a component that draws nothing. */
const nothing = () => ({ default: () => null });

// One dynamic() per group, each at module level with its import path written out, so Next can match the call to its chunk (the same paths as registry.ts loaders).
const PRELOAD: Record<ModuleGroup, ComponentType> = {
  guest: dynamic(() => import('../groups/guest').then(nothing), { ssr: true }),
  corporate: dynamic(() => import('../groups/corporate').then(nothing), { ssr: true }),
  overview: dynamic(() => import('../groups/overview').then(nothing), { ssr: true }),
  frontOffice: dynamic(() => import('../groups/frontOffice').then(nothing), { ssr: true }),
  platform: dynamic(() => import('../groups/platform').then(nothing), { ssr: true }),
  group: dynamic(() => import('../groups/group').then(nothing), { ssr: true }),
  billing: dynamic(() => import('../groups/billing').then(nothing), { ssr: true }),
  cash: dynamic(() => import('../groups/cash').then(nothing), { ssr: true }),
  companies: dynamic(() => import('../groups/companies').then(nothing), { ssr: true }),
  payrollCore: dynamic(() => import('../groups/payrollCore').then(nothing), { ssr: true }),
  payrollPay: dynamic(() => import('../groups/payrollPay').then(nothing), { ssr: true }),
  website: dynamic(() => import('../groups/website').then(nothing), { ssr: true }),
  admin: dynamic(() => import('../groups/admin').then(nothing), { ssr: true }),
  conversations: dynamic(() => import('../groups/conversations').then(nothing), { ssr: true }),
};

/** Preloads the chunk of the group that owns `viewId` (the page the dashboard opens on). Draws nothing. */
export function OpeningGroup({ viewId }: { viewId: string }) {
  const group = groupsFor(viewId)[0];
  if (!group) return null;
  const Preload = PRELOAD[group];
  return (
    <Suspense fallback={null}>
      <Preload />
    </Suspense>
  );
}
