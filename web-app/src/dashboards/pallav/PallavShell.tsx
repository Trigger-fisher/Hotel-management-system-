'use client';

// Hotel Pallav's frame, written as Pallav writes it (resources/views/layouts/app.blade.php, payroll/layout.blade.php):
// the rail, the second panel, the header card and the content. The styles are Pallav's own (public/pallav); the
// behaviour of pms.js / pms-sidebar.js / pms-ui.js is rewritten here in React (collapse, hide, peek on hover, theme).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import type { HmsUser } from '@shared/auth-pallav/types';
import { roleLabel } from '@shared/auth/copy';
import { formatDate, formatWeekdayDate, istWallClock } from '@shared/dashboards/format';
import type { BooksOverview } from '@shared/dashboards/overview';
import type { NavSection } from '@shared/dashboards/nav';
import { supportChatCopy } from '@shared/dashboards/supportChat';
import { overviewApi } from '../groups/overview/api';
import { writePanelsCookie, type ShellPanels } from '@/lib/shellPanels';
import { useAfterHydration } from '@/lib/useAfterHydration';
import { shellCopyByLanguage, translateNavText } from '@shared/dashboards/shellCopy';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { LANGUAGES, LANGUAGE_NAMES } from '@shared/i18n/languages';
import { languageSwitchCopyByLanguage } from '@shared/i18n/words';
import { useCopy, useLanguage, tr, trf } from '@/lib/i18n/language';
import { UpdatedNote } from '../shell/UpdatedNote';
import { Bi } from './Bi';
import { Button } from './ui';
import { chooseTheme } from './theme';
import { useForceMode } from './forceMode';
import { setPanel2Slot, setPanelHeadSlot, usePanel2Request } from './panelSlot';
import { PhoneSearch } from '../shell/PhoneSearch';
import { useMyPhoto } from '../shell/myPhoto';

export interface PallavShellProps {
  user: HmsUser;
  /** The signed-in hotel's own name: the brand is data (Pallav shows "Hotel Pallav"). */
  brandName: string;
  /** The line under the brand (default Pallav's "Management Suite"; the portals under "All hotels" say "All hotels · N"). */
  brandLine?: string;
  /** The letters in the brand square (default: the brand's initials). */
  brandMarkText?: string;
  main: NavSection[];
  activeId: string;
  onMain: (id: string) => void;
  onHome: () => void;
  /** 761px and up (Pallav's breakpoint for the side panels). Below it no side panel is drawn: neither `sub` nor a screen's own panel. */
  wide?: boolean;
  /** Under the brand, above the menu: the portals' hotel selector (decision 48). */
  sidebarTop?: ReactNode;
  /** Decision 53, phones only: a bar under the top bar that stays in view (the portals' hotel selector). */
  mobileBar?: ReactNode;
  /** Decision 53, phones only: the portals' floating bottom navigation. */
  bottomNav?: ReactNode;
  /** Decision 70: 'guest' puts `hms-guest` and `hms-glass` on <body> while this shell is shown, 'corporate' only `hms-glass`: the portals' Full Transparent look (public/pallav/guest-glass.css; the company portal since MJ's 26 Oct 2026 order). */
  /** 'staff' (hotel, platform and group dashboards, MJ 26 Oct 2026: the same look for every user) puts `hms-glass` and `hms-staff`. */
  look?: 'guest' | 'corporate' | 'staff';
  /** The second panel (Payroll, Website); omit when the screen has none. */
  sub?: { title: string; icon: string; sections: NavSection[]; activeId: string; onSelect: (id: string) => void; head?: ReactNode; note?: ReactNode };
  /** The header: page icon, the line above the title (the sidebar section) and the title. */
  header: { icon: string; eyebrow: string; title: string };
  onProfile: () => void;
  onLock: () => void;
  onSignOut: () => void;
  canForce: boolean;
  theme: 'light' | 'dark';
  /** The accounting-year menu in the top bar: hotel staff only (a guest or company portal has no books). */
  yearMenu: boolean;
  /** A bar under the top bar (same place as the Force banner): "You are inside Hotel X. Exit" in the Platform console's entered hotel. */
  banner?: ReactNode;
  /** Opens the accounting-years page (the menu offers it to admins). */
  onBooks?: () => void;
  onTheme: (t: 'light' | 'dark') => void;
  /** Opens the chat: a button in the top bar, and Help in the avatar menu on a phone (no floating button over the page); absent when this dashboard has no chat. */
  onHelp?: () => void;
  /** The top bar's middle in place of the greeting and clock (the guest portal's stay status and quick action, MJ 26 Oct 2026); absent = the greeting and clock. */
  info?: ReactNode;
  /** The bell (hotel dashboards): what needs attention now; rendered first in the top bar's actions. */
  bell?: ReactNode;
  /** A count shown at the right of a sidebar item (the company portal's unread notifications), by item id; 0 or missing shows nothing. */
  badges?: Record<string, number>;
  /** Phones: a back arrow at the left of the top bar (a detail page, or a page opened from the user chip); hidden on wider screens. */
  onBack?: () => void;
  /** Rendered on the server and being hydrated (R48): the first client render must equal the server HTML. */
  hydrating?: boolean;
  /** The saved panel choices read by the server from the preference cookie; null with a server render = nothing saved yet. */
  initialPanels?: ShellPanels | null;
  /** When the server drew this page (ms): the clock strip's first frame shows that time, so it is in the first HTML and the page starts on exactly the same text. */
  initialNow?: number;
  children: ReactNode;
}

const store = {
  read: (k: string) => {
    try {
      return localStorage.getItem(k) === '1';
    } catch {
      return false;
    }
  },
  write: (k: string, v: boolean) => {
    try {
      localStorage.setItem(k, v ? '1' : '0');
    } catch {
      /* private window */
    }
  },
};

/** "HP" from "Hotel Pallav": the first letters of the first two words. */
export function brandMark(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '?') + (words[1]?.[0] ?? '')).toUpperCase();
}

function initialsOf(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] ?? '') + (w.length > 1 ? (w[w.length - 1]?.[0] ?? '') : '')).toUpperCase() || '?';
}

/** Pallav's role colours: role-av-superadmin / admin / editor / viewer. */
/** The person's photo inside an avatar circle, or their initials (shell/myPhoto.ts). */
function Face({ name }: { name: string }) {
  const photo = useMyPhoto();
  // eslint-disable-next-line @next/next/no-img-element -- the signed-in person's own picture from the API; next/image would fetch it without the session
  return photo ? <img className="av-photo" src={photo} alt="" /> : <>{initialsOf(name)}</>;
}

function roleAv(role: HmsUser['role']): string {
  switch (role) {
    case 'super_admin':
    case 'platform_admin':
    case 'group_hotel_admin':
      return 'role-av-superadmin';
    case 'hotel_admin':
      return 'role-av-admin';
    case 'hotel_user':
      return 'role-av-editor';
    default:
      return 'role-av-viewer';
  }
}

/** Peeks held shut until the pointer leaves their zone (see endPeek). One shell is on screen at a time. */
const peekHold = new Set<string>();

const GREETINGS: [until: number, words: string, glyph: string][] = [
  [5, 'Good night', 'moon-stars'],
  [12, 'Good morning', 'sunrise'],
  [17, 'Good afternoon', 'sun'],
  [21, 'Good evening', 'sunset'],
  [24, 'Good night', 'moon-stars'],
];

export function PallavShell(p: PallavShellProps) {
  const sw = useCopy(shellCopyByLanguage);
  const [language] = useLanguage();
  // The guest and company menus have their own word list; every other menu word (the staff dashboards) comes from the phrase book, English when it has none.
  const tn = (text: string) => {
    const own = p.look === 'guest' || p.look === 'corporate' ? translateNavText(text, language) : text;
    return own !== text ? own : tr(text);
  };
  const hasSub = Boolean(p.sub);
  // The three panel flags are this browser's saved choices (localStorage). The server draws the default (all open), and the saved choice is taken right after hydration,
  // so the first client render equals the server HTML (R48).  A browser with nothing saved sees no change at all.
  const fromServer = p.hydrating === true;
  // A server render with no preference cookie yet (first visit after this change) takes this browser's older localStorage choices right after hydration.
  const ready = useAfterHydration();
  const panelFlag = (key: string, fromCookie: boolean | undefined) => (fromServer ? (fromCookie ?? (ready ? store.read(key) : false)) : store.read(key));
  const [ownCollapsed, setCollapsed] = useState<boolean | null>(null);
  const [ownSubHidden, setSubHidden] = useState<boolean | null>(null);
  const [ownSub2Hidden, setSub2Hidden] = useState<boolean | null>(null);
  const collapsed = ownCollapsed ?? panelFlag('pms.sidebarCollapsed', p.initialPanels?.collapsed);
  const subHidden = ownSubHidden ?? panelFlag('pms.subnavHidden', p.initialPanels?.subHidden);
  const panel2 = usePanel2Request();
  const has2 = hasSub && panel2 !== null;
  // A menu with no side panel of its own (Administration): a screen's panel is the first side panel, as Master Data's lists are in Pallav.
  // Under 761px it is hidden like the menu panel (no #subnav, peek button or has-subnav class on a phone).
  const solo = (p.wide ?? true) && !hasSub && panel2 !== null ? panel2 : null;
  const hasFirst = hasSub || solo !== null;
  const sub2Hidden = ownSub2Hidden ?? panelFlag('pms.subnav2Hidden', p.initialPanels?.sub2Hidden);
  // The choices also go into the preference cookie, so the server draws the next load with the same widths (no layout shift).
  const panelsWritten = useRef(false);
  useEffect(() => {
    if (!panelsWritten.current) {
      panelsWritten.current = true;
      // the first run only writes when the cookie is missing or differs, so an untouched browser gets no cookie
      if (!(collapsed || subHidden || sub2Hidden)) return;
    }
    writePanelsCookie({ collapsed, subHidden, sub2Hidden });
  }, [collapsed, subHidden, sub2Hidden]);
  // Pallav never shows three panels at once: with the Payroll menu and the third panel both open, the main rail folds to its icons.
  const autoFolded = has2 && !subHidden && !sub2Hidden;
  const folded = collapsed || autoFolded;
  const sidebarRef = useRef<HTMLDivElement>(null);
  const subnavRef = useRef<HTMLElement>(null);
  const peekRef = useRef<HTMLButtonElement>(null);

  // The portals' phone layout (hms-overrides.css, body.portal-mobile) is on only while a bottom navigation is given.
  const portalMobile = Boolean(p.bottomNav);
  useEffect(() => {
    document.body.classList.toggle('portal-mobile', portalMobile);
    if (!portalMobile) return undefined;
    // the sticky hotel bar sits right under the top bar, whatever height the top bar has on this phone
    const bar = document.querySelector<HTMLElement>('.main[data-hms-dash] .topbar');
    const place = () => document.body.style.setProperty('--pt-m-top', `${Math.round(bar?.getBoundingClientRect().bottom ?? 0)}px`);
    place();
    const ro = bar ? new ResizeObserver(place) : null;
    if (bar) ro?.observe(bar);
    window.addEventListener('resize', place);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', place);
      document.body.classList.remove('portal-mobile');
      document.body.style.removeProperty('--pt-m-top');
    };
  }, [portalMobile]);

  // Decision 70: the portals' look is scoped by body classes, because the sheets, popovers, dialogs and the phone bar are drawn straight under <body>:
  // hms-glass for the Full Transparent look (guest and company portals, MJ 26 Oct 2026), hms-guest for the guest portal's own page sheets.
  const guestLook = p.look === 'guest';
  const glassLook = p.look !== undefined;
  const staffLook = p.look === 'staff';
  // before the first paint, so the portal never shows the plain hotel look for a frame
  useLayoutEffect(() => {
    document.body.classList.toggle('hms-guest', guestLook);
    document.body.classList.toggle('hms-glass', glassLook);
    document.body.classList.toggle('hms-staff', staffLook);
    if (!glassLook) return undefined;
    return () => document.body.classList.remove('hms-guest', 'hms-glass', 'hms-staff');
  }, [guestLook, glassLook, staffLook]);

  // The portals' top-bar drop-downs open centred under their own button (guest-glass.css); one that would leave the screen is nudged back by --dd-shift.
  useEffect(() => {
    if (!glassLook) return undefined;
    const fit = () => {
      document.querySelectorAll<HTMLElement>('.topbar .dropdown-menu.show').forEach((m) => {
        m.style.setProperty('--dd-shift', '0px');
        const r = m.getBoundingClientRect();
        const shift = r.left < 12 ? 12 - r.left : r.right > window.innerWidth - 12 ? window.innerWidth - 12 - r.right : 0;
        m.style.setProperty('--dd-shift', `${Math.round(shift)}px`);
      });
    };
    const later = () => requestAnimationFrame(() => requestAnimationFrame(fit));
    document.addEventListener('click', later);
    window.addEventListener('resize', fit);
    return () => {
      document.removeEventListener('click', later);
      window.removeEventListener('resize', fit);
    };
  }, [glassLook]);

  // ---- Body classes: Pallav's CSS reads them to place the rail, the panel and the page ----
  useEffect(() => {
    const b = document.body;
    b.classList.toggle('has-subnav', hasFirst);
    b.classList.toggle('no-subnav', !hasFirst);
    b.classList.toggle('sidebar-collapsed', folded);
    b.classList.toggle('subnav-hidden', subHidden && hasFirst);
    b.classList.toggle('has-subnav2', has2);
    b.classList.toggle('subnav2-hidden', has2 && sub2Hidden);
    return () => {
      b.classList.remove('has-subnav', 'no-subnav', 'sidebar-collapsed', 'subnav-hidden', 'has-subnav2', 'subnav2-hidden', 'sidebar-peeking', 'subnav-peeking', 'subnav2-peeking');
    };
  }, [hasFirst, folded, subHidden, has2, sub2Hidden]);

  const toggleSub2 = useCallback((hide: boolean) => {
    setSub2Hidden(hide);
    store.write('pms.subnav2Hidden', hide);
  }, []);
  const toggleSidebar = useCallback(() => {
    // Opening the rail while it is folded for the third panel shuts that panel (the one opened longest ago closes).
    if (autoFolded) {
      toggleSub2(true);
      return;
    }
    setCollapsed(!collapsed);
    store.write('pms.sidebarCollapsed', !collapsed);
  }, [autoFolded, collapsed, toggleSub2]);
  const toggleSub = useCallback((hide: boolean) => {
    setSubHidden(hide);
    store.write('pms.subnavHidden', hide);
  }, []);

  // ---- Keyboard: [ toggles the second panel, \ the rail, Escape ends a peek ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        document.body.classList.remove('sidebar-peeking', 'subnav-peeking');
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      const tag = (t.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable) return;
      if (e.key === '[' && hasFirst) {
        e.preventDefault();
        toggleSub(!subHidden);
      }
      if (e.key === '\\') {
        e.preventDefault();
        toggleSidebar();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hasFirst, subHidden, toggleSidebar, toggleSub]);

  // ---- Open on hover when shut (pms.js wireHoverPeek) ----
  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const body = document.body;
    const narrow = window.matchMedia('(max-width: 1180px)');
    const cleanups: (() => void)[] = [];
    function peek(zones: (HTMLElement | null)[], cls: string, shut: () => boolean) {
      const els = zones.filter((z): z is HTMLElement => Boolean(z));
      if (!els.length) return;
      let openTimer: number | undefined;
      let closeTimer: number | undefined;
      const enter = () => {
        window.clearTimeout(closeTimer);
        if (!shut() || body.classList.contains(cls) || peekHold.has(cls)) return;
        openTimer = window.setTimeout(() => {
          if (!peekHold.has(cls)) body.classList.add(cls);
        }, 140);
      };
      const leave = (e: MouseEvent) => {
        if (e.relatedTarget && els.some((z) => z.contains(e.relatedTarget as Node))) return;
        peekHold.delete(cls);
        window.clearTimeout(openTimer);
        closeTimer = window.setTimeout(() => {
          if (els.some((z) => z.querySelector('.open, .show'))) return;
          body.classList.remove(cls);
        }, 260);
      };
      els.forEach((z) => {
        z.addEventListener('mouseenter', enter);
        z.addEventListener('mouseleave', leave);
      });
      cleanups.push(() => {
        window.clearTimeout(openTimer);
        window.clearTimeout(closeTimer);
        els.forEach((z) => {
          z.removeEventListener('mouseenter', enter);
          z.removeEventListener('mouseleave', leave);
        });
      });
    }
    peek([sidebarRef.current], 'sidebar-peeking', () => folded || narrow.matches);
    peek([subnavRef.current, peekRef.current], 'subnav-peeking', () => subHidden);
    return () => cleanups.forEach((c) => c());
  }, [folded, subHidden, hasSub, solo]);

  // Phones: the rail is a drawer (the top bar's menu button sets sidebar-peeking); a tap outside it closes it, as a menu click does (endPeek).
  // Tablets (761 to 1180 px, touch): the rail is icons only; the first tap on it opens it with its words, a tap outside closes it.
  useEffect(() => {
    const phone = window.matchMedia('(max-width: 760px)');
    const tablet = window.matchMedia('(min-width: 761px) and (max-width: 1180px) and (hover: none)');
    const away = (e: PointerEvent) => {
      if (!(phone.matches || tablet.matches) || !document.body.classList.contains('sidebar-peeking')) return;
      if ((e.target as Element | null)?.closest?.('#sidebar, .tb-drawer-btn')) return;
      document.body.classList.remove('sidebar-peeking');
    };
    const expand = (e: MouseEvent) => {
      if (!tablet.matches || document.body.classList.contains('sidebar-peeking')) return;
      if (e.detail === 0) return; // keyboard or screen-reader activation: navigate at once
      const inRail = (e.target as Element | null)?.closest?.('#sidebar .sidebar-nav a, #sidebar .logo, #sidebar .sb-user');
      if (!inRail) return;
      e.preventDefault();
      e.stopPropagation();
      peekHold.delete('sidebar-peeking');
      document.body.classList.add('sidebar-peeking');
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('click', expand, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('click', expand, true);
    };
  }, []);

  // The rail's open state lives on body.sidebar-peeking; the drawer button mirrors it for assistive tech.
  const [railOpen, setRailOpen] = useState(false);
  useEffect(() => {
    const sync = () => setRailOpen(document.body.classList.contains('sidebar-peeking'));
    sync();
    const seen = new MutationObserver(sync);
    seen.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => seen.disconnect();
  }, []);

  // A menu taller than the rail fades at the edge that has more items past it, so it reads as one that scrolls.
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;
    const mark = () => {
      nav.toggleAttribute('data-more-above', nav.scrollTop > 2);
      nav.toggleAttribute('data-more-below', nav.scrollTop + nav.clientHeight < nav.scrollHeight - 2);
    };
    mark();
    nav.addEventListener('scroll', mark, { passive: true });
    const ro = new ResizeObserver(mark);
    ro.observe(nav);
    return () => {
      nav.removeEventListener('scroll', mark);
      ro.disconnect();
    };
  }, [p.main]);

  // A pinned-open panel ends its peek.
  useEffect(() => {
    if (!folded) document.body.classList.remove('sidebar-peeking');
    if (!subHidden) document.body.classList.remove('subnav-peeking');
  }, [folded, subHidden]);

  // ---- Pallav's pms.js adds .in to every .reveal as it appears; without it the block stays transparent ----
  useEffect(() => {
    const mark = () => document.querySelectorAll('.reveal:not(.in)').forEach((el) => el.classList.add('in'));
    mark();
    const seen = new MutationObserver(mark);
    seen.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    return () => seen.disconnect();
  }, []);

  // ---- The header gains depth once the page scrolls under it ----
  useEffect(() => {
    const sync = () => document.body.classList.toggle('tb-scrolled', window.scrollY > 4);
    window.addEventListener('scroll', sync, { passive: true });
    sync();
    return () => window.removeEventListener('scroll', sync);
  }, []);

  // Picking a page ends a peek. In Pallav every menu click loads a new page, which drops the peek; in this one-page app the
  // pointer is still on the rail, so the peeked rail (244px over a phone-width page) would stay open. A mouse click also holds
  // the peek shut until the pointer leaves the rail or panel.
  const endPeek = (e: ReactMouseEvent) => {
    document.body.classList.remove('sidebar-peeking', 'subnav-peeking');
    if (e.detail === 0) return; // keyboard: the pointer is not on the rail
    const at = e.target as Element;
    if (at.closest('#sidebar')) peekHold.add('sidebar-peeking');
    if (at.closest('#subnav')) peekHold.add('subnav-peeking');
  };
  const go = (fn: () => void) => (e: ReactMouseEvent) => {
    e.preventDefault();
    endPeek(e);
    fn();
  };
  const force = useForceMode();

  return (
    <>
      <div className="sidebar" id="sidebar" ref={sidebarRef}>
        <div className="sb-bg" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <a className="logo" href="#" onClick={go(p.onHome)} title={p.brandName} aria-label={sw.chrome.goToDashboard(p.brandName)}>
          {/* the brand's building mark (public/brand), the day or the night file by html[data-theme]; the hotel's own name stays the brand text */}
          <span className="logo-mark" data-mark={p.brandMarkText ?? brandMark(p.brandName)}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a static file of the site, no sizing by next/image */}
            <img className="brand-day" src="/brand/mark-day.svg" alt="" width="40" height="40" />
            {/* eslint-disable-next-line @next/next/no-img-element -- a static file of the site, no sizing by next/image */}
            <img className="brand-night" src="/brand/mark-night.svg" alt="" width="40" height="40" />
          </span>
          {/* one long word ("EasyHotelSolutions") cannot wrap: it gets the smallest size so it never breaks inside the word */}
          <span className={p.brandName.length > 30 || /\S{16,}/.test(p.brandName) ? 'logo-text logo-long logo-xlong' : p.brandName.length > 18 ? 'logo-text logo-long' : 'logo-text'}>
            {/* The hotel's name is data and can be long: two lines at most (hms-overrides.css). Not a span: Pallav's ".logo span" rules style every span. */}
            <b className="logo-name">{p.brandName}</b>
            <span>{p.brandLine ?? tr("Management Suite")}</span>
          </span>
        </a>

        {p.sidebarTop}

        <nav className="sidebar-nav" ref={navRef} aria-label={sw.chrome.pages}>
          {p.main.map((section) => (
            <div key={section.title} style={{ display: 'contents' }}>
              <div className="sidebar-section">{tn(section.title)}</div>
              {section.items.map((item) => (
                <a
                  key={item.id}
                  href="#"
                  className={item.id === p.activeId ? 'active' : ''}
                  title={tn(item.label)}
                  data-label={tn(item.label)}
                  aria-current={item.id === p.activeId ? 'page' : undefined}
                  onClick={go(() => p.onMain(item.id))}
                >
                  <Bi name={item.icon} />
                  <span>
                    {tn(item.label)}
                    {item.upcoming ? <em className="sb-soon">{sw.chrome.upcoming}</em> : null}
                  </span>
                  {p.badges?.[item.id] ? (
                    <b className="sb-count" role="status" aria-label={sw.chrome.unread(p.badges[item.id]!)}>
                      {p.badges[item.id]! > 99 ? '99+' : p.badges[item.id]}
                    </b>
                  ) : null}
                </a>
              ))}
            </div>
          ))}
        </nav>

        <div className="sb-foot">
          <a className="sb-user" href="#" title={sw.menu.profile} onClick={go(p.onProfile)}>
            <span className={`avatar ${roleAv(p.user.role)} sb-user-av`}>
              <Face name={p.user.displayName} />
              <i className="sb-online" />
            </span>
            <span className="sb-user-text">
              <span className="sb-user-name">{p.user.displayName}</span>
              <span className="sb-user-role">{language === 'en' ? roleLabel[p.user.role] : sw.roles[p.user.role]}</span>
            </span>
          </a>
          <button
            type="button"
            className="nav-collapse"
            id="sidebarToggle"
            aria-expanded={!folded}
            title={folded ? sw.chrome.expandMenu : sw.chrome.collapseMenu}
            aria-label={folded ? sw.chrome.expandMenu : sw.chrome.collapseMenu}
            onClick={toggleSidebar}
          >
            <Bi name="chevron-double-left" />
            <span>{folded ? tr("Expand") : tr("Collapse menu")}</span>
          </button>
        </div>
      </div>

      {p.sub && (
        <>
          <aside className="subnav" id="subnav" ref={subnavRef}>
            <div className="subnav-head">
              <div className="sb-head-bg" aria-hidden="true">
                <span />
                <span />
              </div>
              <div className="subnav-top">
                <span className="subnav-title">
                  <Bi name={p.sub.icon} /> {tn(p.sub.title)}
                </span>
                <button
                  type="button"
                  className="panel-toggle panel-close"
                  id="subnavToggle"
                  title={subHidden ? sw.chrome.showPanel : sw.chrome.hidePanel}
                  aria-label={subHidden ? sw.chrome.showPanel : sw.chrome.hidePanel}
                  aria-expanded={!subHidden}
                  onClick={() => toggleSub(!subHidden)}
                >
                  <Bi name="chevron-double-left" />
                </button>
              </div>
              {p.sub.head}
              <div id="sub-head-slot" ref={setPanelHeadSlot} />
            </div>
            <nav className="subnav-body" aria-label={trf('{0} pages', [tn(p.sub.title)])}>
              {p.sub.note}
              {p.sub.sections.map((section) => (
                <div className="rail-group" key={section.title}>
                  {section.title !== 'Company' && <div className="rail-label">{tn(section.title)}</div>}
                  {section.items.map((item) => (
                    <a
                      key={item.id}
                      href="#"
                      className={`rail-item ${item.id === p.sub?.activeId ? 'active' : ''}`}
                      aria-current={item.id === p.sub?.activeId ? 'page' : undefined}
                      onClick={go(() => p.sub?.onSelect(item.id))}
                    >
                      <Bi name={item.icon} />
                      <span>{tn(item.label)}</span>
                    </a>
                  ))}
                </div>
              ))}
            </nav>
          </aside>
          <button
            type="button"
            className="subnav-peek"
            id="subnavPeek"
            ref={peekRef}
            title={trf('Show the {0} panel', [tn(p.sub.title)])}
            onClick={() => toggleSub(false)}
          >
            <Bi name="chevron-double-right" /> {trf('{0} menu', [tn(p.sub.title)])}
          </button>
        </>
      )}

      {solo && (
        <>
          <aside className="subnav" id="subnav" ref={subnavRef}>
            <div className="subnav-head">
              <div className="sb-head-bg" aria-hidden="true">
                <span />
                <span />
              </div>
              <div className="subnav-top">
                <span className="subnav-title">
                  <Bi name={solo.icon} /> {tn(solo.title)}
                </span>
                <button
                  type="button"
                  className="panel-toggle panel-close"
                  id="subnavToggle"
                  title={subHidden ? sw.chrome.showPanel : sw.chrome.hidePanel}
                  aria-label={subHidden ? sw.chrome.showPanel : sw.chrome.hidePanel}
                  aria-expanded={!subHidden}
                  onClick={() => toggleSub(!subHidden)}
                >
                  <Bi name="chevron-double-left" />
                </button>
              </div>
            </div>
            <div ref={setPanel2Slot} style={{ display: 'contents' }} />
          </aside>
          <button /* check-shared-ignore: the shell side-panel peek tab */ type="button" className="subnav-peek" id="subnavPeek" ref={peekRef} title={trf('Show the {0} panel', [tn(solo.title)])} onClick={() => toggleSub(false)}>
            <Bi name="chevron-double-right" /> {trf('{0} menu', [tn(solo.title)])}
          </button>
        </>
      )}

      {has2 && panel2 && (
        <>
          <aside className="subnav subnav-2" id="subnav2">
            <div className="subnav-head">
              <div className="sb-head-bg" aria-hidden="true">
                <span />
                <span />
              </div>
              <div className="subnav-top">
                <span className="subnav-title">
                  <Bi name={panel2.icon} /> {tn(panel2.title)}
                </span>
                <button
                  type="button"
                  className="panel-toggle panel-close"
                  id="subnav2Toggle"
                  title={sub2Hidden ? sw.chrome.showPanel : sw.chrome.hidePanel}
                  aria-label={sub2Hidden ? sw.chrome.showPanel : sw.chrome.hidePanel}
                  aria-expanded={!sub2Hidden}
                  onClick={() => toggleSub2(!sub2Hidden)}
                >
                  <Bi name="chevron-double-left" />
                </button>
              </div>
            </div>
            <div ref={setPanel2Slot} style={{ display: 'contents' }} />
          </aside>
          <button /* check-shared-ignore: the shell side-panel peek tab */ type="button" className="subnav-peek" id="subnav2Peek" title={trf('Show the {0} panel', [tn(panel2.title)])} onClick={() => toggleSub2(false)}>
            <Bi name="chevron-double-right" /> {tn(panel2.title)}
          </button>
        </>
      )}

      <div className="main" data-hms-dash="1">
        <div className="topbar">
          {/* Phones only (hms-overrides.css): the rail is a drawer there, opened by this button (Pallav has none). */}
          <button /* check-shared-ignore: the shell top-bar button */ type="button" className="theme-btn tb-drawer-btn" aria-controls="sidebar" aria-expanded={railOpen} title={sw.chrome.menu} aria-label={sw.chrome.openMenu} onClick={() => document.body.classList.toggle('sidebar-peeking')}>
            <Bi name="list" />
          </button>
          {p.onBack ? (
            <button /* check-shared-ignore: the shell top-bar button */ type="button" className="theme-btn tb-back" title={sw.chrome.back} aria-label={sw.chrome.back} onClick={p.onBack}>
              <Bi name="arrow-left" />
            </button>
          ) : null}
          {/* the portals (they carry the hotel selector bar) also find their own pages from a page with no search box of its own */}
          <PhoneSearch
            title={p.header.title}
            pages={p.mobileBar ? p.main.flatMap((s) => s.items.filter((i) => !i.hidden).map((i) => ({ id: i.id, label: i.label, icon: i.icon }))) : undefined}
            onGoPage={p.mobileBar ? p.onMain : undefined}
          />
          {/* phones: a tap on the title opens the page search (PhoneSearch listens); the search button stays for the keyboard and a screen reader */}
          <div className="tb-title" onClick={() => { if (window.matchMedia('(max-width: 768px)').matches) window.dispatchEvent(new Event('hms:phone-search')); }}>
            <span className="tb-icon" aria-hidden="true">
              <Bi name={p.header.icon} />
            </span>
            <div className="tb-text">
              <span className="tb-eyebrow">{tn(p.header.eyebrow)}<UpdatedNote /></span>
              <h1>{tn(p.header.title)}</h1>
            </div>
          </div>
          {p.info ?? <TodayStrip firstName={p.user.displayName.trim().split(/\s+/)[0] ?? ''} initialNow={p.initialNow} />}
          <div className="tb-actions">
              {p.bell}
              {p.yearMenu && <YearMenu role={p.user.role} onBooks={p.onBooks} />}
            {p.onHelp ? (
              <button /* check-shared-ignore: the shell top-bar button */ type="button" className="theme-btn tb-help" title={tr(supportChatCopy.menu)} aria-label={tr(supportChatCopy.open)} onClick={p.onHelp}>
                <Bi name="chat-dots" />
              </button>
            ) : null}
            <button
              className="theme-btn"
              id="themeToggle"
              type="button"
              title={p.theme === 'dark' ? sw.chrome.switchToDay : sw.chrome.switchToNight}
              aria-label={p.theme === 'dark' ? sw.chrome.switchToDay : sw.chrome.switchToNight}
              onClick={() => {
                const next = p.theme === 'dark' ? 'light' : 'dark';
                chooseTheme(p.user.id, next);
                p.onTheme(next);
              }}
            >
              <Bi name={p.theme === 'dark' ? 'sun' : 'moon-stars'} />
            </button>
            {p.canForce && (
              <button
                className={`force-btn ${force.on ? 'on' : ''}`}
                type="button"
                title={force.on ? 'Force mode is armed - click to turn it off' : 'Arm force mode: validation and record locks off for your account'}
                onClick={() => force.set(!force.on)}
              >
                <Bi name="lightning-charge-fill" />
                <span>{tr("Force mode:")} {force.on ? tr("ON") : tr("OFF")}</span>
              </button>
            )}
            <UserMenu
              user={p.user}
              onProfile={p.onProfile}
              onLock={p.onLock}
              onSignOut={p.onSignOut}
              dark={p.theme === 'dark'}
              onTheme={() => {
                const next = p.theme === 'dark' ? 'light' : 'dark';
                chooseTheme(p.user.id, next);
                p.onTheme(next);
              }}
              force={p.canForce ? { on: force.on, set: force.set } : null}
              onHelp={p.onHelp}
            />
            {/* The language icon: the last thing in the header, at its right-hand corner. The same choice as the row in the user menu (one language store). */}
            <LanguageMenu />
          </div>
        </div>

        {force.on && (
          <div className="force-banner">
            <Bi name="lightning-charge-fill" />
            <span>{tr("Force mode is armed. Field checks and record locks are off for your account, and every override is written to the audit log.")}</span>
            <button type="button" onClick={() => force.set(false)}>
              {tr("Turn off")}
            </button>
          </div>
        )}

        {p.banner}

        <div className="nx-dock" id="hms-dock" />

        {p.mobileBar ? <div className="pt-m-bar">{p.mobileBar}</div> : null}

        <div className="content">{p.children}</div>
      </div>
      {p.bottomNav}
    </>
  );
}

/** Greeting and live clock between the title and the controls (Pallav's "today" strip). */
function TodayStrip({ firstName, initialNow }: { firstName: string; initialNow?: number }) {
  // a page the server drew starts on the server's time (the same text on both sides); the tick below moves it to this browser's clock at once
  const [now, setNow] = useState<Date | null>(() => (initialNow !== undefined ? new Date(initialNow) : null));
  const room = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLDivElement>(null);
  const waiting = now === null;
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Takes chips out, highest data-tb-fit first, until the pill fits the room (pms-sidebar.js makeFitter).
  useEffect(() => {
    const r = room.current;
    const pl = pill.current;
    if (!r || !pl) return;
    const chips = [...pl.querySelectorAll<HTMLElement>('[data-tb-fit]')].sort((a, b) => Number(b.dataset.tbFit) - Number(a.dataset.tbFit));
    const fit = () => {
      chips.forEach((c) => c.classList.remove('tb-off'));
      pl.classList.remove('tb-empty');
      for (const chip of chips) {
        if (pl.offsetWidth <= r.clientWidth - 32) break;
        chip.classList.add('tb-off');
      }
      if (!chips.some((c) => !c.classList.contains('tb-off')) || pl.offsetWidth > r.clientWidth - 32) pl.classList.add('tb-empty');
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(r);
    return () => ro.disconnect();
  }, [waiting]);

  if (!now) return <div className="tb-info" ref={room} />;
  // The hotel's clock (IST), whatever zone the browser is in.
  const ist = istWallClock(now.getTime());
  const h = ist.hh;
  const g = GREETINGS.find(([until]) => h < until) ?? GREETINGS[0];
  const h12 = h % 12 || 12;
  const date = formatWeekdayDate(ist.date);
  return (
    <div className="tb-info" ref={room}>
      <div className="tb-pill" ref={pill}>
        <span className="tb-chip" data-tb-fit="3">
          <span className="tb-tile">
            <Bi name={g?.[2] ?? 'sun'} />
          </span>
          <span className="tb-lines">
            <span className="tb-lbl">{g?.[1]}</span>
            <span className="tb-val">{firstName}</span>
          </span>
        </span>
        <span className="tb-chip tb-clock" data-tb-fit="1">
          <span className="tb-tile">
            <Bi name="clock" />
          </span>
          <span className="tb-lines">
            <span className="tb-lbl">{date}</span>
            <span className="tb-val">
              {h12}:{String(ist.mm).padStart(2, '0')} <small>{h >= 12 ? 'pm' : 'am'}</small>
            </span>
          </span>
        </span>
      </div>
    </div>
  );
}

/** A Bootstrap-style dropdown without Bootstrap's JavaScript: closes on outside press and Escape. */
function useDropdown() {
  const [open, setOpen] = useState(false);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (el && !el.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, el]);
  return { open, setOpen, setEl };
}

const MENU_OFFSET = { top: '100%', right: 0, left: 'auto', transform: 'translate3d(0, 18px, 0)' } as const;

/** The language icon at the right-hand corner of the header: a globe that opens the list of languages, each written in its own script. Choosing one changes every screen at once. */
function LanguageMenu() {
  const { open, setOpen, setEl } = useDropdown();
  const [language, setLanguage] = useLanguage();
  const words = useCopy(languageSwitchCopyByLanguage);
  return (
    <div className="dropdown lang-menu" ref={setEl}>
      <button /* check-shared-ignore: the header's language icon, the trigger of its own menu */ className="theme-btn lang-btn" type="button" title={words.label} aria-label={words.group} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        <Bi name="translate" />
      </button>
      <div className={`dropdown-menu dropdown-menu-end pms-dropdown tb-menu ${open ? 'show' : ''}`} style={MENU_OFFSET} role="menu" aria-label={words.group}>
        {LANGUAGES.map((l) => (
          <button /* check-shared-ignore: a language choice inside the header language menu */
            key={l}
            type="button"
            role="menuitemradio"
            aria-checked={l === language}
            lang={l}
            className="dropdown-item d-flex align-items-center justify-content-between gap-3"
            onClick={() => {
              setLanguage(l);
              setOpen(false);
            }}
          >
            <span>{LANGUAGE_NAMES[l]}</span>
            {l === language ? <Bi name="check2" /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function UserMenu({ user, onProfile, onLock, onSignOut, dark, onTheme, force, onHelp }: { user: HmsUser; onProfile: () => void; onLock: () => void; onSignOut: () => void; dark: boolean; onTheme: () => void; force: { on: boolean; set: (on: boolean) => void } | null; onHelp?: () => void }) {
  const { open, setOpen, setEl } = useDropdown();
  const sw = useCopy(shellCopyByLanguage);
  const [language] = useLanguage();
  const roleText = language === 'en' ? roleLabel[user.role] : sw.roles[user.role];
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className="dropdown" ref={setEl}>
      <button /* check-shared-ignore: the shell user menu trigger */ className="user-menu-btn" type="button" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        <span className={`avatar avatar-sm ${roleAv(user.role)}`}>
          <Face name={user.displayName} />
        </span>
        <span className="um-text">
          <span className="um-name">{user.displayName}</span>
          <span className="um-role">{roleText}</span>
        </span>
        <Bi name="chevron-down" />
      </button>
      <div className={`dropdown-menu dropdown-menu-end pms-dropdown tb-menu ${open ? 'show' : ''}`} style={MENU_OFFSET}>
        <div className="tbm-head">
          <span className={`avatar ${roleAv(user.role)} tbm-av`}>
            <Face name={user.displayName} />
          </span>
          <span className="tbm-who">
            <span className="tbm-name">{user.displayName}</span>
            {user.username && <span className="tbm-user">@{user.username}</span>}
          </span>
          <span className="tbm-role">{roleText}</span>
        </div>
        <a className="dropdown-item" href="#" onClick={(e) => { e.preventDefault(); pick(onProfile)(); }}>
          <span className="tbm-ic"><Bi name="person" /></span>
          <span className="tbm-txt"><span>{sw.menu.profile}</span></span>
          <Bi name="chevron-right" className="tbm-go" />
        </a>
        {/* Phones only (pms-header.css): the night-mode and force-mode buttons leave the top bar there, so the page title keeps its room */}
        <a className="dropdown-item tbm-phone-only" href="#" onClick={(e) => { e.preventDefault(); pick(onTheme)(); }}>
          <span className="tbm-ic"><Bi name={dark ? 'sun' : 'moon-stars'} /></span>
          <span className="tbm-txt"><span>{dark ? sw.menu.dayMode : sw.menu.nightMode}</span></span>
        </a>
        {force ? (
          <a className="dropdown-item tbm-phone-only" href="#" onClick={(e) => { e.preventDefault(); pick(() => force.set(!force.on))(); }}>
            <span className="tbm-ic"><Bi name="lightning-charge-fill" /></span>
            <span className="tbm-txt"><span>{tr("Force mode:")} {force.on ? tr("ON") : tr("OFF")}</span></span>
          </a>
        ) : null}
        {onHelp ? (
          <a className="dropdown-item tbm-help" href="#" onClick={(e) => { e.preventDefault(); pick(onHelp)(); }}>
            <span className="tbm-ic"><Bi name="chat-dots" /></span>
            <span className="tbm-txt"><span>{tr(supportChatCopy.menu)}</span></span>
            <Bi name="chevron-right" className="tbm-go" />
          </a>
        ) : null}
        <a className="dropdown-item" href="#" onClick={(e) => { e.preventDefault(); pick(onLock)(); }}>
          <span className="tbm-ic"><Bi name="lock" /></span>
          <span className="tbm-txt"><span>{sw.menu.lock}</span></span>
          <Bi name="chevron-right" className="tbm-go" />
        </a>
        {/* The ONE language switch (MJ, 3 Nov 2026): a row inside the user menu on every dashboard. */}
        <LanguageSwitch variant="menu" />
        <div className="dropdown-divider" />
        <button /* check-shared-ignore: a menu item inside the shell user menu */ type="button" className="dropdown-item tbm-out" onClick={pick(onSignOut)}>
          <span className="tbm-ic"><Bi name="box-arrow-right" /></span>
          <span className="tbm-txt"><span>{sw.menu.signOut}</span></span>
        </button>
      </div>
    </div>
  );
}

/** The accounting year in the header (partials/_year-menu.blade.php): which years are on screen. */
type YearData = { years: { id: string; label: string; span: string; open: boolean }[]; viewing: string[]; currentId: string; due: boolean; nextLabel: string };

/** The menu's own shape of the accounting years (GET admin/books): null when there is no year yet. */
function yearData(books: BooksOverview): YearData | null {
  const cur = books.years.find((y) => y.current) ?? books.years[0];
  if (!cur) return null;
  return {
    years: books.years.map((y) => ({ id: y.id, label: y.label, span: `${formatDate(y.startsOn)} - ${formatDate(y.endsOn)}`, open: y.current })),
    viewing: [cur.id],
    currentId: cur.id,
    due: books.cannotStart === null,
    nextLabel: books.next.label,
  };
}

function YearMenu({ role, onBooks }: { role: string; onBooks?: () => void }) {
  const { open, setOpen, setEl } = useDropdown();
  // The years are read here, in the browser (the server no longer reads them with the page: that read kept the page waiting); the slot below holds the size until they arrive.
  const [data, setData] = useState<YearData | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    void overviewApi.getBooks().then((res) => {
      if (!alive || !res.ok) return;
      const next = yearData(res.data);
      if (!next) return;
      setData(next);
      setPicked([next.currentId]);
    });
    return () => {
      alive = false;
    };
  }, [role]);
  // Until the years arrive the slot already has its size (same markup, invisible text), so the top bar does not move when the menu fills in (R48: no layout shift).
  if (!data) {
    return (
      <div className="dropdown tb-year" aria-hidden="true" style={{ visibility: 'hidden' }}>
        <span className="tb-year-btn">
          <span className="tb-tile"><Bi name="journal-bookmark" /></span>
          <span className="tb-lines">
            <span className="tb-lbl">{tr("Accounting year")}</span>
            <span className="tb-val">{tr("FY 0000-00")}</span>
          </span>
          <Bi name="chevron-down" className="tb-year-caret" />
        </span>
      </div>
    );
  }
  const labelOf = (ids: string[]) => data.years.filter((y) => ids.includes(y.id)).map((y) => y.label).join(' + ');
  const viewingCurrent = data.viewing.length === 1 && data.viewing[0] === data.currentId;
  const show = (ids: string[]) => {
    // The server keeps no "years on screen" state: this choice lives only in this menu.
    setData((d) => (d ? { ...d, viewing: ids } : d));
    setPicked(ids);
    setOpen(false);
  };
  return (
    <div className={`dropdown tb-year ${viewingCurrent ? '' : 'is-other'}`} ref={setEl}>
      <button /* check-shared-ignore: the shell accounting-year picker trigger */ className="tb-year-btn" type="button" aria-expanded={open} onClick={() => setOpen(!open)} title={trf("Accounting year {0}", [data.years.find((y) => y.id === data.currentId)?.label ?? ''])}>
        <span className="tb-tile"><Bi name="journal-bookmark" /></span>
        <span className="tb-lines">
          <span className="tb-lbl">{viewingCurrent ? tr("Accounting year") : tr("Viewing")}</span>
          <span className="tb-val">{tr("FY")} {labelOf(data.viewing)}</span>
        </span>
        {data.due && role !== 'hotel_user' && <span className="tb-year-dot" title={tr("The next year can be started")} />}
        <Bi name="chevron-down" className="tb-year-caret" />
      </button>
      <div className={`dropdown-menu dropdown-menu-end tb-year-menu ${open ? 'show' : ''}`} style={MENU_OFFSET}>
        <div className="ym-head">
          <strong>{tr("Years on screen")}</strong>
          <span>{tr("Tick more than one to see them together.")}</span>
        </div>
        <div className="ym-list">
          {[...data.years].reverse().map((y) => {
            const on = picked.includes(y.id);
            return (
              <label key={y.id} className={`ym-year ${on ? 'on' : ''}`}>
                <input type="checkbox" checked={on} onChange={() => setPicked((s) => (s.includes(y.id) ? s.filter((x) => x !== y.id) : [...s, y.id]))} />
                <span className="ym-check"><Bi name="check-lg" /></span>
                <span className="ym-text">
                  <b>{tr("FY")} {y.label}</b>
                  <small>{y.span}</small>
                </span>
                {y.open ? (
                  <span className="ym-tag open">{tr("Open")}</span>
                ) : (
                  <span className="ym-tag"><Bi name="lock" /> {tr("Closed")}</span>
                )}
              </label>
            );
          })}
        </div>
        <div className="ym-foot">
          <Button size="sm" variant="ghost" onClick={() => show([data.currentId])}>{tr("Current year")}</Button>
          <Button size="sm" onClick={() => show(picked.length ? picked : [data.currentId])}>{tr("Show")}</Button>
        </div>
        {onBooks && role !== 'hotel_user' && (
          <a href="#" className={`ym-manage ${data.due ? 'due' : ''}`} onClick={(e) => { e.preventDefault(); setOpen(false); onBooks(); }}>
            <Bi name={data.due ? 'stars' : 'gear'} />
            <span>{data.due ? `Start FY ${data.nextLabel}` : tr("Manage accounting years")}</span>
            <Bi name="chevron-right" className="ms-auto" />
          </a>
        )}
      </div>
    </div>
  );
}
