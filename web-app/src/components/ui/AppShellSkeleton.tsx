'use client';

import { useSyncExternalStore } from 'react';
import { readShellSnapshot, type ShellSnapshot } from '@/dashboards/shell/shellSnapshot';
import { tr } from '@/lib/i18n/language';
// The dashboard's outline (the graphite side rail, the white top bar, grey content blocks) drawn with plain CSS (globals.css, .hms-sk-app), so it is on screen from the
// very first paint of a reload, before any script or Pallav stylesheet has arrived. It has the same widths as the real shell (layout.css: --sidebar-w 244 px, the
// collapsed rail 68 px, the top bar 14 px padding), so when the real shell replaces it nothing moves.
//
// Shown in three places: (1) the server placeholder of the whole app (AuthShellSkeleton) when <html data-shell="app"> is set by the inline script in layout.tsx,
// (2) while the dashboard code loads (SignedInStep) and (3) while Pallav's stylesheets load (PallavFrame). In (2) and (3) `always` forces it on.
//
// With a shell snapshot in this browser (dashboards/shell/shellSnapshot.ts) the outline carries the dashboard's own words: the brand, the menu labels (the
// open page lit), the page title and the person's name. The inline script of layout.tsx writes the same words into the server outline before the app's
// scripts run; after hydration this component draws them itself (the server snapshot is null, so hydration matches and the words then render once).
const noSubscribe = () => () => undefined;
const serverSnapshot = () => null;
/** The rail's rows as the inline script draws them: a section title, then up to 14 menu labels in all. */
function railRows(s: ShellSnapshot): Array<{ kind: 'group'; label: string } | { kind: 'nav'; label: string; on: boolean }> {
  const rows: Array<{ kind: 'group'; label: string } | { kind: 'nav'; label: string; on: boolean }> = [];
  let n = 0;
  for (const section of s.sections) {
    if (n >= 14) break;
    rows.push({ kind: 'group', label: section.title });
    for (const item of section.items) {
      if (n >= 14) break;
      if (item.hidden) continue;
      rows.push({ kind: 'nav', label: item.label, on: item.id === s.activeId });
      n++;
    }
  }
  return rows;
}

export function AppShellSkeleton({ always = false }: { always?: boolean }) {
  const snap = useSyncExternalStore(noSubscribe, readShellSnapshot, serverSnapshot);
  const words = snap !== null;
  return (
    <div className={`${always ? 'hms-sk-app hms-sk-always' : 'hms-sk-app'}${words ? ' hms-sk-words' : ''}`} aria-busy="true" aria-label={tr("Loading")}>
      <div className="hms-sk-rail">
        {words ? (
          <>
            <span className="hms-sk-logo">{snap.brandName}</span>
            {railRows(snap).map((row, i) =>
              row.kind === 'group' ? (
                <span key={i} className="hms-sk-group">
                  {row.label}
                </span>
              ) : (
                <span key={i} className={row.on ? 'hms-sk-nav hms-sk-on' : 'hms-sk-nav'}>
                  {row.label}
                </span>
              ),
            )}
          </>
        ) : (
          <>
            <span className="hms-sk-logo" />
            {Array.from({ length: 8 }, (_, i) => (
              <span key={i} className="hms-sk-nav" />
            ))}
          </>
        )}
      </div>
      <div className="hms-sk-main">
        <div className="hms-sk-top">
          {words ? (
            <>
              <span className="hms-sk-title">
                <span className="hms-sk-eyebrow">{snap.header.eyebrow}</span>
                <span className="hms-sk-h1">{snap.header.title}</span>
              </span>
              <span className="hms-sk-chip">{snap.user.displayName}</span>
            </>
          ) : (
            <>
              <span className="hms-sk-title" />
              <span className="hms-sk-chip" />
            </>
          )}
        </div>
        <div className="hms-sk-content">
          <div className="hms-sk-tiles">
            {Array.from({ length: 4 }, (_, i) => (
              <span key={i} />
            ))}
          </div>
          <div className="hms-sk-rows">
            {Array.from({ length: 4 }, (_, i) => (
              <span key={i} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
