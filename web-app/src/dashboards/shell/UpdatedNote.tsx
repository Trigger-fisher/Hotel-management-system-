'use client';

// "Updated just now" beside the page title after a soft refresh (F5): a refresh that changes nothing on screen still shows that it happened. Nothing is drawn before the first one.
import { useEffect, useState } from 'react';

import { useRefreshedAt } from '@/components/ui/softRefresh';

function label(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 10) return 'Updated just now';
  if (s < 60) return `Updated ${s} s ago`;
  const m = Math.floor(s / 60);
  return m < 60 ? `Updated ${m} min ago` : 'Updated over an hour ago';
}

export function UpdatedNote() {
  const at = useRefreshedAt();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!at) return undefined;
    const t = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(t);
  }, [at]);
  if (!at) return null;
  // `at` is newer than the last tick right after a refresh: that reads "just now"
  return <span className="hms-updated">{label(Math.max(0, now - at))}</span>;
}
