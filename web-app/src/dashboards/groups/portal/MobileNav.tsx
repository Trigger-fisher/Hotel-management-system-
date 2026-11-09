'use client';

// Decision 53, the mobile layout of the Guest and Company portals (docs/UI.md, "Mobile portals"). Phones (768 px and down) get a floating rounded
// bottom navigation with the main sections and a "More" sheet for the rest, taken from the eTrafficEYE mobile structure (an app column, a
// pill-shaped bottom bar whose active item is filled, a bar that slips away while scrolling down). The web layout is untouched: every rule for it
// is under `@media (max-width: 768px)` in hms-overrides.css and the bar is `display: none` above that.
import { useEffect, useState } from 'react';

import { guestTabFor, guestTabs } from '@shared/dashboards/guestStage';
import type { NavSection } from '@shared/dashboards/nav';
import { pathForRoute } from '@shared/dashboards/routes';
import { shellCopyByLanguage, translateNavText } from '@shared/dashboards/shellCopy';

import { Bi } from '@/dashboards/pallav/ui';
import { useCopy, useLanguage, tr, trf } from '@/lib/i18n/language';
import { useMyPhoto } from '../../shell/myPhoto';
import { useGuestBadges } from '../guest/kit/badges';
import { useGuestChrome } from '../guest/kit/chrome';

type Kind = 'guest' | 'corporate';
interface Entry {
  id: string;
  label: string;
  icon: string;
}

// The company portal's bar: four main sections and a More sheet. (Decision 71: the guest has its own four-tab bar, GuestTabBar below.)
const MAIN: Record<'corporate', Entry[]> = {
  corporate: [
    { id: 'corporate.dashboard', label: 'Overview', icon: 'grid-1x2' },
    { id: 'corporate.bills', label: 'Bills', icon: 'receipt' },
    { id: 'corporate.payments', label: 'Payments', icon: 'wallet2' },
    { id: 'corporate.notifications', label: 'Notices', icon: 'bell' },
  ],
};

const MORE: Record<'corporate', Entry[]> = {
  corporate: [
    { id: 'corporate.ledger', label: 'Statement', icon: 'journal-text' },
    { id: 'corporate.support', label: 'Support', icon: 'headset' },
    { id: 'corporate.profile', label: 'Company', icon: 'building' },
    { id: 'corporate.myProfile', label: 'My profile', icon: 'person-circle' },
  ],
};

interface PortalNavProps {
  kind: Kind;
  /** The current page's menu entry (rootId). */
  activeId: string;
  /** The current page itself (a drill-in such as one bill differs from its menu entry). */
  viewId?: string;
  onGo: (id: string) => void;
  onSignOut: () => void;
  unread?: number;
}

/** The portals' phone bottom bar: the guest's four tabs (decision 71) or the company portal's bar with its More sheet. */
export function PortalBottomNav(props: PortalNavProps) {
  return props.kind === 'guest' ? <GuestTabBar activeId={props.activeId} viewId={props.viewId ?? props.activeId} onGo={props.onGo} /> : <CompanyBottomNav {...props} kind="corporate" />;
}

/**
 * Decision 71: the guest's phone tab bar, an app's: Home, Room service, Bills, Payments, Account (icon and word each; Payments its own tab since MJ's 26 Oct 2026 order), fixed at the bottom over the home-indicator inset,
 * never hiding on scroll, never changing with the stay. Bills is lit for the bills and one bill. A coral dot on Bills while something is owed; the
 * number of live orders on Room service. Tapping the tab of the page on screen scrolls it to the top (instantly under reduced motion). Sign out is in Account.
 */
/** True while the page scrolls down (past 120px); false again as soon as it scrolls up. The bars slip away and come back with it. */
function useBarAway(hold = false): boolean {
  const [away, setAway] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - last) < 8) return;
      setAway(y > last && y > 120);
      last = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return away && !hold;
}

function GuestTabBar({ activeId, viewId, onGo }: { activeId: string; viewId: string; onGo: (id: string) => void }) {
  usePhoneTables();
  useGuestChrome();
  const away = useBarAway();
  const sw = useCopy(shellCopyByLanguage);
  const [language] = useLanguage();
  const badges = useGuestBadges();
  const lit = guestTabFor(viewId) ?? guestTabFor(activeId);
  const press = (id: string) => {
    if (id === viewId) {
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' });
      return;
    }
    onGo(id);
  };
  // the capsule lens slides to the lit tab (guest-glass.css reads data-lit; -1 hides it)
  const litIndex = guestTabs.findIndex((t) => t.id === lit);
  return (
    <nav className={`pt-m-nav gg-tabbar${away ? ' away' : ''}`} aria-label={sw.chrome.mainSections} data-lit={litIndex} data-tabs={guestTabs.length}>
      <span className="gg-tab-lens" aria-hidden="true" />
      {guestTabs.map((t) => {
        const on = t.id === lit;
        const count = t.id === 'guest.order' ? badges.liveOrders : 0;
        const dot = t.id === 'guest.bills' && badges.outstandingPaise > 0;
        // the tab's real address (a long-press "open in new tab" works); a plain tap stays in the app
        const href = pathForRoute('guest', { viewId: t.id, params: {} }, { home: guestTabs[0]?.id }) ?? '#';
        return (
          <a
            key={t.id}
            href={href}
            className={on ? 'active' : ''}
            aria-current={on ? 'page' : undefined}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              press(t.id);
            }}
          >
            <span className="gg-tab-ico">
              <Bi name={t.icon} />
              {count > 0 ? (
                <b className="gg-tab-count" aria-hidden="true">
                  {count > 9 ? '9+' : count}
                </b>
              ) : null}
              {dot ? <b className="gg-tab-dot" aria-hidden="true" /> : null}
            </span>
            <span>{translateNavText(t.label, language)}</span>
            {/* the badges, spoken (a <b> with aria-label is not read out) */}
            {count > 0 ? <span className="visually-hidden">{trf(", {0} {1} on the way", [count, count === 1 ? 'order' : 'orders'])}</span> : null}
            {dot ? <span className="visually-hidden">{tr(", something to pay")}</span> : null}
          </a>
        );
      })}
    </nav>
  );
}

function CompanyBottomNav({ kind, activeId, onGo, onSignOut, unread = 0 }: PortalNavProps & { kind: 'corporate' }) {
  const [more, setMore] = useState(false);
  const away = useBarAway(more);
  usePhoneTables();
  const sw = useCopy(shellCopyByLanguage);
  const [language] = useLanguage();

  useEffect(() => {
    if (!more) return undefined;
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMore(false);
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [more]);

  const go = (id: string) => {
    setMore(false);
    onGo(id);
  };
  const moreActive = MORE[kind].some((m) => m.id === activeId);
  const photo = useMyPhoto();
  // MJ, 26 Oct 2026: the company portal's bar is the same floating glass capsule as the guest's, five tabs (the four and More), the lens sliding to the lit one
  const litIndex = more || moreActive ? MAIN[kind].length : MAIN[kind].findIndex((m) => m.id === activeId);

  return (
    <>
      <nav className={`pt-m-nav gg-tabbar ${away ? 'away' : ''}`} aria-label={sw.chrome.mainSections} data-lit={litIndex} data-tabs={MAIN[kind].length + 1}>
        <span className="gg-tab-lens" aria-hidden="true" />
        {MAIN[kind].map((m) => (
          <a
            key={m.id}
            href="#"
            className={m.id === activeId ? 'active' : ''}
            aria-current={m.id === activeId ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault();
              go(m.id);
            }}
          >
            <Bi name={m.icon} />
            <span>{translateNavText(m.label, language)}</span>
            {m.id === 'corporate.notifications' && unread > 0 ? (
              <b className="pt-m-dot" aria-label={sw.chrome.unread(unread)}>
                {unread > 9 ? '9+' : unread}
              </b>
            ) : null}
          </a>
        ))}
        <a
          href="#"
          role="button"
          className={moreActive || more ? 'active' : ''}
          aria-haspopup="dialog"
          aria-expanded={more}
          onClick={(e) => {
            e.preventDefault();
            setMore((o) => !o);
          }}
        >
          <Bi name="grid" />
          <span>{sw.chrome.more}</span>
        </a>
      </nav>

      {more ? (
        <>
          <div className="pt-m-scrim" onClick={() => setMore(false)} aria-hidden="true" />
          <div className="pt-m-sheet" role="dialog" aria-modal="true" aria-label={sw.chrome.more}>
            <div className="pt-m-grip" aria-hidden="true" />
            {MORE[kind].map((m) => (
              <a
                key={m.id}
                href="#"
                className={m.id === activeId ? 'active' : ''}
                onClick={(e) => {
                  e.preventDefault();
                  go(m.id);
                }}
              >
                {photo && (m.id === 'corporate.myProfile' || m.id === 'guest.profile') ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the person's own picture from the API
                  <img className="pt-m-photo" src={photo} alt="" />
                ) : (
                  <Bi name={m.icon} />
                )}
                <span>{translateNavText(m.label, language)}</span>
                {m.id === 'corporate.notifications' && unread > 0 ? <b className="sb-count">{unread > 99 ? '99+' : unread}</b> : null}
                <Bi name="chevron-right" className={m.id === 'corporate.notifications' && unread > 0 ? '' : 'ms-auto'} />
              </a>
            ))}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setMore(false);
                onSignOut();
              }}
            >
              <Bi name="box-arrow-right" />
              <span>{sw.menu.signOut}</span>
            </a>
          </div>
        </>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------------------------------------------------------------------------------
   Phone tables (R59): on a phone a table with up to 10 columns and no merged cells is drawn as one card per row (the first cell is the card's title, every other cell
   is "label: value"). The labels are the column headings, copied onto the cells here; the stylesheet (hms-overrides.css, `table[data-cards]`) does the drawing, only under
   768 px and only while `body.portal-mobile` is on. A wide grid (an attendance sheet, a rate table) keeps scrolling inside its card.
   ------------------------------------------------------------------------------------------------------------------------------------------ */
const CARD_MAX_COLUMNS = 10;

function labelTable(table: HTMLTableElement): void {
  // a table that draws its own phone cards (.hms-card-table, the older narrow-table pattern) keeps them: relabeling it crushed its first column
  if (table.dataset.noCards !== undefined || table.closest('[data-no-cards]') || table.classList.contains('hms-card-table')) {
    delete table.dataset.cards;
    return;
  }
  const head = table.tHead?.rows[table.tHead.rows.length - 1];
  if (!head) return;
  const cols = head.cells.length;
  if (cols < 2 || cols > CARD_MAX_COLUMNS || [...head.cells].some((c) => c.colSpan > 1)) {
    delete table.dataset.cards;
    return;
  }
  const names = [...head.cells].map((c) => c.textContent?.trim().replace(/\s+/g, ' ') ?? '');
  const body = table.tBodies;
  for (const tb of body) {
    for (const row of tb.rows) {
      if ([...row.cells].some((c) => c.colSpan > 1 || c.rowSpan > 1)) continue;
      [...row.cells].forEach((cell, i) => {
        const name = names[i] ?? '';
        if (cell.dataset.label !== name) cell.dataset.label = name;
      });
    }
  }
  table.dataset.cards = '1';
}

/** Marks the tables of the page for the phone card layout, now and whenever the page changes. */
export function usePhoneTables(): void {
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    // tablets: only the list pane beside an open record (RoleDashboard .hms-pane-list) draws its rows as cards
    const paneMq = window.matchMedia('(min-width: 768px) and (max-width: 1180px)');
    let frame = 0;
    const run = () => {
      frame = 0;
      if (!mq.matches) {
        if (paneMq.matches) document.querySelectorAll<HTMLTableElement>('.main[data-hms-dash] .content .hms-pane-list table').forEach(labelTable);
        return;
      }
      document.querySelectorAll<HTMLTableElement>('.main[data-hms-dash] .content table').forEach(labelTable);
      document.querySelectorAll<HTMLElement>('.main[data-hms-dash] .bm-fbar-row > .bm-fbar-label').forEach((l) => {
        if (l.getAttribute('role') !== 'button') {
          l.setAttribute('role', 'button');
          l.setAttribute('tabindex', '0');
        }
      });
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(run);
    };
    const root = document.querySelector('.main[data-hms-dash] .content') ?? document.body;
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
    mq.addEventListener('change', schedule);
    paneMq.addEventListener('change', schedule);
    schedule();
    // the filter row's label is the phone fold button: it opens and closes the row (a keyboard reaches it too)
    const fold = (e: Event) => {
      if (!mq.matches) return;
      const label = (e.target as HTMLElement | null)?.closest<HTMLElement>('.bm-fbar-row > .bm-fbar-label');
      if (!label) return;
      if (e instanceof KeyboardEvent && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      const bar = label.closest('.bm-fbar');
      bar?.classList.toggle('open');
      label.setAttribute('aria-expanded', String(bar?.classList.contains('open') ?? false));
    };
    document.addEventListener('click', fold);
    document.addEventListener('keydown', fold);
    return () => {
      document.removeEventListener('click', fold);
      document.removeEventListener('keydown', fold);
      observer.disconnect();
      mq.removeEventListener('change', schedule);
      paneMq.removeEventListener('change', schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
}

/* ------------------------------------------------------------------------------------------------------------------------------------------
   The bottom navigation of the staff dashboards (hotel, platform, group): four main jobs and a More sheet that lists every menu entry of the signed-in role by section.
   ------------------------------------------------------------------------------------------------------------------------------------------ */
type StaffKind = 'hotel' | 'platform' | 'group';
const STAFF_MAIN: Record<StaffKind, string[]> = {
  hotel: ['hotel.dashboard', 'hotel.fo.board', 'hotel.billing.bills', 'hotel.cash.revenue'],
  platform: ['platform.overview', 'platform.hotels', 'platform.groups', 'platform.users'],
  group: ['group.overview', 'group.hotels', 'group.invitations', 'group.admins'],
};
// the menu's own word on the bar (MJ, 26 Oct 2026: one name per page everywhere); only a name too long for a tab is shortened
const STAFF_LABEL: Record<string, string> = { 'hotel.fo.board': 'Rooms', 'hotel.cash.revenue': 'Cash', 'group.admins': 'Admins' };

export function StaffBottomNav({
  kind,
  sections,
  activeId,
  onGo,
  onSignOut,
  sub,
  profileId,
  profileName,
  badges,
}: {
  kind: StaffKind;
  sections: NavSection[];
  activeId: string;
  onGo: (id: string) => void;
  onSignOut: () => void;
  /** A count by menu id (the Conversations unread badge): a dot on the bar's More (or the entry itself) and a count in the sheet; 0 or missing shows nothing. */
  badges?: Record<string, number>;
  /** My profile's page: the first row of the More sheet (it is not in the menu any more). */
  profileId?: string;
  profileName?: string;
  /** The second panel of the page (a payroll company's own pages): on a phone its panel is hidden, so its entries lead the More sheet. */
  sub?: { title: string; sections: NavSection[]; activeId: string; onSelect: (id: string) => void };
}) {
  const [more, setMore] = useState(false);
  const away = useBarAway(more);
  usePhoneTables();
  const sw = useCopy(shellCopyByLanguage);
  const [language] = useLanguage();

  useEffect(() => {
    if (!more) return undefined;
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMore(false);
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [more]);

  const flat = sections.flatMap((s) => s.items);
  const main = STAFF_MAIN[kind].map((id) => flat.find((i) => i.id === id)).filter((i): i is (typeof flat)[number] => Boolean(i));
  for (const item of flat) {
    if (main.length >= 4) break;
    if (!main.includes(item)) main.push(item);
  }
  const go = (id: string) => {
    setMore(false);
    onGo(id);
  };
  const moreActive = !main.some((m) => m.id === activeId);
  const staffPhoto = useMyPhoto();
  const countOf = (id: string) => badges?.[id] ?? 0;
  // what the More sheet holds unread (an entry not on the bar): the More button carries the dot
  const moreUnread = flat.filter((i) => !main.includes(i)).reduce((n, i) => n + countOf(i.id), 0);
  const dot = (n: number) =>
    n > 0 ? (
      <b className="pt-m-dot" aria-label={trf("{0} unread", [n])}>
        {n > 9 ? '9+' : n}
      </b>
    ) : null;

  return (
    <>
      {/* MJ, 26 Oct 2026 ("the same for all users"): the portals' floating glass capsule, the lens sliding to the lit tab (the four and More) */}
      <nav className={`pt-m-nav gg-tabbar ${away ? 'away' : ''}`} aria-label={tr("Main sections")} data-lit={more || moreActive ? main.length : main.findIndex((m) => m.id === activeId)} data-tabs={main.length + 1}>
        <span className="gg-tab-lens" aria-hidden="true" />
        {main.map((m) => (
          <a
            key={m.id}
            href="#"
            className={m.id === activeId ? 'active' : ''}
            aria-current={m.id === activeId ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault();
              go(m.id);
            }}
          >
            <Bi name={m.icon} />
            <span>{STAFF_LABEL[m.id] ?? m.label}</span>
            {dot(countOf(m.id))}
          </a>
        ))}
        <a
          href="#"
          role="button"
          className={moreActive || more ? 'active' : ''}
          aria-haspopup="dialog"
          aria-expanded={more}
          onClick={(e) => {
            e.preventDefault();
            setMore((o) => !o);
          }}
        >
          <Bi name="grid" />
          <span>{sw.chrome.more}</span>
          {dot(moreUnread)}
        </a>
      </nav>

      {more ? (
        <>
          <div className="pt-m-scrim" onClick={() => setMore(false)} aria-hidden="true" />
          <div className="pt-m-sheet" role="dialog" aria-modal="true" aria-label={tr("All sections")}>
            <div className="pt-m-grip" aria-hidden="true" />
            {profileId ? (
              <div className="pt-m-sub">
                <a
                  href="#"
                  className={profileId === activeId ? 'active' : ''}
                  onClick={(e) => {
                    e.preventDefault();
                    go(profileId);
                  }}
                >
                  {staffPhoto ? (
                    // eslint-disable-next-line @next/next/no-img-element -- the person's own picture from the API
                    <img className="pt-m-photo" src={staffPhoto} alt="" />
                  ) : (
                    <Bi name="person-circle" />
                  )}
                  <span>{profileName ? `My profile · ${profileName}` : tr("My profile")}</span>
                  <Bi name="chevron-right" className="ms-auto" />
                </a>
              </div>
            ) : null}
            {sub && sub.sections.some((s) => s.items.length > 0) ? (
              <div className="pt-m-sub">
                <h2 className="pt-m-sec">{sub.title}</h2>
                {sub.sections.flatMap((s) => s.items).map((m) => (
                  <a
                    key={`sub:${m.id}`}
                    href="#"
                    className={m.id === sub.activeId ? 'active' : ''}
                    onClick={(e) => {
                      e.preventDefault();
                      setMore(false);
                      sub.onSelect(m.id);
                    }}
                  >
                    <Bi name={m.icon} />
                    <span>{translateNavText(m.label, language)}</span>
                    <Bi name="chevron-right" className="ms-auto" />
                  </a>
                ))}
              </div>
            ) : null}
            {sections.map((s) => (
              <div key={s.title}>
                <h2 className="pt-m-sec">{s.title}</h2>
                {s.items.map((m) => (
                  <a
                    key={m.id}
                    href="#"
                    className={m.id === activeId ? 'active' : ''}
                    onClick={(e) => {
                      e.preventDefault();
                      go(m.id);
                    }}
                  >
                    <Bi name={m.icon} />
                    <span>{translateNavText(m.label, language)}</span>
                    {countOf(m.id) > 0 ? <b className="sb-count">{countOf(m.id) > 99 ? '99+' : countOf(m.id)}</b> : null}
                    <Bi name="chevron-right" className={countOf(m.id) > 0 ? '' : 'ms-auto'} />
                  </a>
                ))}
              </div>
            ))}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setMore(false);
                onSignOut();
              }}
            >
              <Bi name="box-arrow-right" />
              <span>{sw.menu.signOut}</span>
            </a>
          </div>
        </>
      ) : null}
    </>
  );
}