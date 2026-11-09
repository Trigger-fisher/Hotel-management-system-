'use client';

import { useMedia } from './focus';

/** Rows per page: 10 on phones (short cards, "Load more"; also a size every server list allows), `desktop` elsewhere. */
export function usePageSize(desktop = 20): number {
  const phone = useMedia('(max-width: 639px)');
  return phone ? 10 : desktop;
}
