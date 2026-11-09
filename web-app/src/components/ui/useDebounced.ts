'use client';

import { useEffect, useState } from 'react';

/** A value that follows `value` after it has stopped changing for `ms` (search boxes: 250-300 ms). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
