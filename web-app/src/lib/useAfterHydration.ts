'use client';

import { useSyncExternalStore } from 'react';

const never = () => () => {};

/**
 * False while React hydrates server HTML (so the first client render equals the server's), true from the render right after, and true at once in a client-only render.
 * Browser-only choices (saved page, theme, panel widths) are read when this is true, so no effect has to copy them into state.
 */
export function useAfterHydration(): boolean {
  return useSyncExternalStore(never, () => true, () => false);
}
