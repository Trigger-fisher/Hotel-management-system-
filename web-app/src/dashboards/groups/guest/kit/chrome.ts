'use client';

// The phone browser's own chrome while the guest portal is on screen (decision 71): the page runs under the notch and the home indicator (viewport-fit=cover,
// the bars pad themselves with env(safe-area-inset-*)), and the browser bar takes the guest page colour of the day or night look (the dashboard's own theme,
// <html data-theme>). Both are put back when the guest portal goes (sign-out). app/layout.tsx is not changed.
import { useEffect } from 'react';

// check-shared-ignore: the browser bar colour must be a literal (meta theme-color); the guest page colours of guest-glass.css (--gg-page by day and by night)
const BAR = { light: '#ECECEF', dark: '#0B0B0C' } as const;

export function useGuestChrome(): void {
  useEffect(() => {
    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    const oldViewport = viewport?.getAttribute('content') ?? null;
    if (viewport && oldViewport !== null && !/viewport-fit\s*=/.test(oldViewport)) viewport.setAttribute('content', `${oldViewport}, viewport-fit=cover`);

    const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
    const old = metas.map((m) => m.getAttribute('content'));
    const paint = () => {
      const color = document.documentElement.getAttribute('data-theme') === 'dark' ? BAR.dark : BAR.light;
      for (const m of metas) m.setAttribute('content', color);
    };
    paint();
    const watch = new MutationObserver(paint);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      watch.disconnect();
      if (viewport && oldViewport !== null) viewport.setAttribute('content', oldViewport);
      metas.forEach((m, i) => {
        const v = old[i];
        if (v === null || v === undefined) m.removeAttribute('content');
        else m.setAttribute('content', v);
      });
    };
  }, []);
}
