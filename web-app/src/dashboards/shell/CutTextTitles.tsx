'use client';

// Text cut with an ellipsis (a long note, an e-mail address, a company name in a table cell) shows its full text as a tooltip (R46). One listener for the whole page: when the
// pointer reaches a box whose text is cut and which has no title of its own, the title is filled in from its text. No component needs to know; new tables are covered too.
import { useEffect } from 'react';

function isCut(el: HTMLElement): boolean {
  const s = getComputedStyle(el);
  if (s.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) return true;
  const clamp = s.getPropertyValue('-webkit-line-clamp');
  return clamp !== '' && clamp !== 'none' && el.scrollHeight > el.clientHeight + 1;
}

export function CutTextTitles() {
  useEffect(() => {
    const onOver = (e: MouseEvent) => {
      let el = e.target instanceof HTMLElement ? e.target : null;
      for (let i = 0; el && i < 4; i += 1, el = el.parentElement) {
        if (el.hasAttribute('title') || el.id === 'dash-content') return;
        if (isCut(el)) {
          const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
          if (text) el.setAttribute('title', text);
          return;
        }
      }
    };
    document.addEventListener('mouseover', onOver, { passive: true });
    return () => document.removeEventListener('mouseover', onOver);
  }, []);
  return null;
}
