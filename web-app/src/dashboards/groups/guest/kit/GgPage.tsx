'use client';

// The frame of every guest page (decision 71). On a phone: an iOS-style large title that, once scrolled under the top bar, hands over to the top bar's own
// compact title (a 150 ms crossfade); on a desktop the top bar keeps its title and the large one is hidden. The shell's h1 (.tb-title) stays the page's only
// heading of level 1: the large title is a div, aria-hidden. Under it: the status line ("In stay · Room 204 · checks out tomorrow") and the page's actions.
// Body classes (guest look only, guest-glass.css): `gg-has-large` while a large title is on screen, `gg-titled` once it has scrolled away.
import { useEffect, useRef, type ReactNode } from 'react';

import { useKpiSlot } from '../../../kpis';

export interface GgPageProps {
  /** The page's name: the same word as the menu and the top bar ("Home", "Bills"). */
  title: string;
  /** The line under the title (a stage line, a count); optional. */
  status?: ReactNode;
  /** Buttons at the right of the title row (a Call icon, "Get statement"); optional. */
  actions?: ReactNode;
  /** The page root class: gg-home, gg-order, gg-bills, gg-payments, gg-account, gg-bill. Page layout rules sit under it. */
  className?: string;
  /** A page pushed on top of another (one bill): slides in from the right on a phone. */
  push?: boolean;
  children: ReactNode;
}

/** Height of the phone top bar the large title slides under. */
const TOP_BAR_PX = 64;

export function GgPage({ title, status, actions, className = '', push = false, children }: GgPageProps) {
  const large = useRef<HTMLDivElement>(null);
  const kpis = useKpiSlot();

  useEffect(() => {
    const body = document.body;
    body.classList.add('gg-has-large');
    const el = large.current;
    let observer: IntersectionObserver | null = null;
    if (el && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          const e = entries[entries.length - 1];
          if (e) body.classList.toggle('gg-titled', !e.isIntersecting && e.boundingClientRect.top < TOP_BAR_PX);
        },
        { rootMargin: `-${TOP_BAR_PX}px 0px 0px 0px`, threshold: 0 },
      );
      observer.observe(el);
    }
    return () => {
      observer?.disconnect();
      body.classList.remove('gg-has-large', 'gg-titled');
    };
  }, []);

  return (
    <div className={`gg-page ${push ? 'gg-push ' : ''}${className}`.trim()}>
      <header className="gg-page-head">
        <div className="gg-page-titles">
          <div ref={large} className="gg-large" aria-hidden="true">
            {title}
          </div>
          {status ? <p className="gg-status">{status}</p> : null}
        </div>
        {actions ? <div className="gg-page-actions">{actions}</div> : null}
      </header>
      {kpis}
      {children}
    </div>
  );
}
