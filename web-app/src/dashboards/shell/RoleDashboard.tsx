'use client';

import { useAfterHydration } from '@/lib/useAfterHydration';
import { deferIdle } from '@/lib/idle';
import { Component, createElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Role } from '@shared/auth/types';
import type { HmsUser, Session } from '@shared/auth-pallav/types';
import { applyHotelNamesToAdminCopy } from '@shared/dashboards/admin';
import { ABILITY, dashLabels, hasAbility, isNewMockHotel, sessionHotelNames, setMockEmptyHotel, setSessionHotelNames } from '@shared/dashboards/common';
import { dashboardForRole, dashboardKindFor, dashboardTitle, drillParent, subNav, type DashboardKind } from '@shared/dashboards/nav';
import { setUserGrants } from '@shared/dashboards/features';
import { formatTime } from '@shared/dashboards/format';
import { OfflineBanner, ToastProvider, useMedia, useOnline, useToast } from '@/components/ui';
import { WEBSITE_URL } from '@shared/dashboards/website';
import { Bi, Button } from '../pallav/ui';
import { apiMode, setReadOnlyView } from '@/lib/api/mode';
import { authApi } from '@/lib/auth/api';
import { PageSkeleton } from '../pallav/ui';
import { PallavFrame } from '../pallav/PallavFrame';
import { PallavShell } from '../pallav/PallavShell';
import { pageSheetsFor } from '../pallav/pageCss';
import { adoptSavedTheme, applyTheme, startTheme } from '../pallav/theme';
import { usePayrollCompanyOpen } from '../groups/payrollCore/shared';
import { usePortalBrand, usePortalHotel } from '../groups/portal/HotelSwitch';
import { PortalBottomNav, StaffBottomNav } from '../groups/portal/MobileNav';
import { prefetchFor } from '../prefetch';
import { KpiSlot, PageKpis } from '../kpis';
import { loadScreen, peekScreen, preloadGroupsFor } from '../registry';
import { lastViews, type LastView } from './lastView';
import { INSIDE_PREFIX, isPortalKind, pathForRoute, portalHotelFromSearch, routeForPath, withPortalHotel, type Route } from '@shared/dashboards/routes';
import { PORTAL_ALL_HOTELS, portalHotelStore } from '@shared/dashboards/portalHotel';
import { isPhoneSearchClosing, onPhoneSearchEntry } from './PhoneSearch';
import { isTempClosing, onTempEntry } from './tempHistory';
import { GuestTopInfo } from '../groups/guest/kit/topInfo';
import { CorporateTopInfo } from '../groups/corporate/TopInfo';
import { menuFor, openableIds, type Viewer } from '@shared/dashboards/access';
import { CutTextTitles } from './CutTextTitles';
import { RefreshLine } from './RefreshLine';
import { SoftRefresh } from './SoftRefresh';
import { PullToRefresh } from './PullToRefresh';
import { AttentionBell } from './AttentionBell';
import { PortalBell } from './PortalBell';
import { Notch } from './Notch';
import { usePortalUnread, usePortalUnreadPolling } from '../groups/notifications/unread';
import { useConversationsPolling, useConversationsUnread, usePersonalUnread } from './conversationsUnread';
import { OPEN_HELP_EVENT, SupportChat } from './SupportChat';
import { supportChatFor } from '@shared/dashboards/supportChat';
import { markDashboardOpen } from './shellFlag';
import { saveShellSnapshot } from './shellSnapshot';
import type { Params, ScreenProps } from '../types';
import {
  findItem,
  isMenuId,
  menuItems,
  pageItem,
  profileViewId,
  rootFor,
  sectionTitleFor,
  subActiveFor,
  subKeyFor,
} from './navModel';
import { loadMyPhoto } from '../groups/admin/profilePhoto';

import { tr, useTranslationKey, trf } from '@/lib/i18n/language';
import { useMailSignalConnection } from '@/lib/mailSignal';
import type { ConvScope } from '@shared/dashboards/conversations';
import { claimConvCache } from '../groups/conversations/convCache';
import { useConvLiveConnection } from '../groups/conversations/liveConnection';
import { liveFamilyOf, pageKeyOf } from './pageKey';
/** True for roles that have a dashboard (the rest keep the auth placeholder). */
export function hasDashboard(role: Role): boolean {
  return role in dashboardForRole;
}

/**
 * One entry of the navigation stack; `rootId` is the menu entry this view lives under (highlighted in the sidebar). `reset` counts clicks on
 * the menu entry of the page already shown: it is part of the view key, so the page starts afresh (filters, tabs, params).
 */
type View = LastView & { reset?: number };

/** How many history entries this dashboard has added before the current one (kept in the entry itself, so Back and Forward carry it). */
function hmsDepth(): number {
  const depth = (window.history.state as { hmsDepth?: unknown } | null)?.hmsDepth;
  return typeof depth === 'number' ? depth : 0;
}

/** The `reset` of a menu entry opened from `prev`: one more when it is the page already shown alone, else 0. */
function againCount(prev: View[], viewId: string): number {
  return prev.length === 1 && prev[0]?.viewId === viewId ? (prev[0].reset ?? 0) + 1 : 0;
}


/** A group chunk that would not load (offline, or a new version deployed): the screen offers a retry instead of loading forever. */
const LOAD_FAILED = 'load-failed' as const;

/** Tablets (768 to 1180 px): a record page listed here is drawn beside its list (the list on the left, the record on the right) instead of replacing it. */
const PANE_LISTS: Record<string, string> = { 'hotel.fo.reservation': 'hotel.fo.reservations', 'hotel.fo.stay': 'hotel.fo.inHouse' };
const PANE_MEDIA = '(min-width: 768px) and (max-width: 1180px)';

/** The screen for a view id: undefined while its group loads, null when the view does not exist yet, LOAD_FAILED when its chunk failed. */
function useScreen(viewId: string, attempt: number) {
  const [loaded, setLoaded] = useState<{ id: string; attempt: number; screen: ReturnType<typeof peekScreen> | typeof LOAD_FAILED } | null>(null);
  const cached = peekScreen(viewId);
  // the reads the view's frame will make start now, in parallel with its chunk (dashboards/prefetch.ts)
  useEffect(() => {
    if (apiMode() === 'real') prefetchFor(viewId);
  }, [viewId]);
  useEffect(() => {
    if (cached !== undefined) return;
    let alive = true;
    loadScreen(viewId).then(
      (screen) => {
        if (alive) setLoaded({ id: viewId, attempt, screen });
      },
      () => {
        if (alive) setLoaded({ id: viewId, attempt, screen: LOAD_FAILED });
      },
    );
    return () => {
      alive = false;
    };
  }, [viewId, cached, attempt]);
  if (cached !== undefined) return cached;
  return loaded?.id === viewId && loaded.attempt === attempt ? loaded.screen : undefined;
}

/** One screen that throws shows a calm card inside the shell; the menu, search and sign-out keep working. */
class ScreenBoundary extends Component<{ children: ReactNode; onHome: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error('Screen error', error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <ShellNote
        icon="exclamation-triangle"
        title={dashLabels.screenErrorTitle}
        text={dashLabels.screenErrorBody}
        retry={() => this.setState({ failed: false })}
        onHome={this.props.onHome}
        marker
      />
    );
  }
}

/** Pallav's empty-state card, used for "coming soon", a failed screen and a chunk that would not load. */
function ShellNote({ icon, title, text, retry, onHome, marker }: { icon: string; title: string; text: string; retry?: () => void; onHome: () => void; marker?: boolean }) {
  return (
    <div className="card" data-screen-error={marker ? '1' : undefined}>
      <div className="empty-state">
        <div className="es-icon">
          <i className={`bi bi-${icon}`} />
        </div>
        <div className="es-title">{title}</div>
        <div className="es-text">{text}</div>
        <div className="d-flex flex-wrap justify-content-center gap-2 mt-3">
          {retry && (
            <Button variant="outline" icon="arrow-clockwise" onClick={retry}>
              {dashLabels.tryAgain}
            </Button>
          )}
          <Button icon="house" onClick={onHome}>
            {dashLabels.backToDashboard}
          </Button>
        </div>
      </div>
    </div>
  );
}

export interface RoleDashboardProps {
  user: HmsUser;
  onSignOut: () => void;
  onLockScreen: () => void;
  /** True when this dashboard was rendered on the server and is being hydrated (R48): the first client render must equal the server HTML, so the remembered page and theme are applied right after. */
  hydrating?: boolean;
  /** The saved sidebar and panel choices the server read from the preference cookie (only with a server render). */
  panels?: import('@/lib/shellPanels').ShellPanels | null;
  /** The page the address names, as the server read it (src/server/shell/seed.ts): the first render must equal the server's, so it is passed in, not read here. */
  initialRoute?: Route | null;
  /** When the server drew the page (ms), for the top bar's clock strip (only with a server render). */
  initialHeader?: { at: number } | null;
  /** The visit the seed's session carries (platform and group staff inside a hotel; null = none), so the server-rendered dashboard resumes it without a session read of its own. Undefined = ask the server (every mount that is not the server render). */
  initialVisit?: Session['visit'] | null;
  /** The address bar follows the page (decision 49: the URL decides). Off for the /dev/dashboard previews, which live at their own address. */
  urlSync?: boolean;
}

/**
 * A hotel entered from the Platform console (docs/plans/RESEARCH-PLATFORM-CONSOLE.md MUST 4): the hotel's own dashboard shows, read-only,
 * for at most 60 minutes, after a written reason; a banner says until when and offers Exit.
 */
interface InsideHotel {
  id: string;
  name: string;
  reason: string;
  /** Epoch ms when the visit ends on its own. */
  endsAt: number;
  /** 'view' = read only; 'full' = the hotel's screens save, within the server's deny list (platform 0135). Fixed for the visit; "Extend" decides it again. */
  access: 'view' | 'full';
}

const INSIDE_MINUTES = 60;
const READ_ONLY_TITLE = 'Read-only while viewing as platform staff';

/** Real server: the hotel's own names for every screen that labels the hotel and the food business (instead of the mock demo names). */
function showHotelNames(h: { name: string; foodName?: string | null } | null): void {
  // The mock sign-in carries the demo hotel's names (the contracts only hold neutral fallbacks), so the mock reads like the real thing.
  setSessionHotelNames(h);
  const names = sessionHotelNames();
  if (names) applyHotelNamesToAdminCopy(names);
}

export function RoleDashboard(props: RoleDashboardProps) {
  // Mock only: a brand-new hotel's admin (common.ts isNewMockHotel: 'h-new' Hotel Pearl, or 'h-new-<id>' onboarded by the Platform console)
  // gets EMPTY module mocks. Set once, in this initializer, before Frame renders and before any screen group (and its mock store) loads;
  // the mock sign-out reloads the page (SignedInStep), so the next account starts clean. A hotel entered from the Platform console does not
  // pass through here, so it keeps the platform user's (false) flag. Real mode: always off.
  useState(() => {
    setMockEmptyHotel(apiMode() === 'mock' && isNewMockHotel(props.user.hotel?.id));
    // Real mode: the hotel's own names instead of the mock demo names (a visit sets the visited hotel's, below).
    showHotelNames(props.user.hotel);
    // The menu lists only what the person's hotel role may open (real sessions carry user.grants; mock and old sessions list everything).
    setUserGrants(props.user.grants);
    return 0;
  });
  // 'platform' only for the mock Platform Admin / Super Admin logins (nav.ts dashboardKindFor); every other account keeps dashboardForRole.
  const baseKind = dashboardKindFor(props.user.role, apiMode() === 'mock', props.user.username);
  if (!baseKind) return null;
  // The toasts (time is up, read-only) need the provider, so the console lives one level down.
  return (
    <ToastProvider>
      <Console baseKind={baseKind} {...props} />
    </ToastProvider>
  );
}

function Console({ baseKind, ...props }: RoleDashboardProps & { baseKind: DashboardKind }) {
  const toast = useToast();
  const [inside, setInside] = useState<InsideHotel | null>(null);
  // True once a visit began or ended in this session: the dashboard that then comes up adds a history entry instead of replacing the current one.
  const [moved, setMoved] = useState(false);

  // A visit goes through the console the person works in: the Platform console's routes, or the Group console's own (a group admin has no
  // platform routes). The reason was already sent by the page that opened the visit.
  const hotelNameOf = async (hotelId: string) => {
    if (baseKind === 'group') {
      const g = await import('../groups/group/api');
      return g.groupApiFor(props.user).getMyHotel(hotelId);
    }
    const m = await import('../groups/platform/api');
    return m.platformApi.getHotel(hotelId);
  };
  const leaveHotel = async (hotelId: string) => {
    if (baseKind === 'group') {
      const g = await import('../groups/group/api');
      return g.groupApiFor(props.user).exitMemberHotel(hotelId);
    }
    const m = await import('../groups/platform/api');
    return m.platformApi.exitHotel(hotelId);
  };

  // The Platform page has already asked for the written reason and written the audited entry (groups/platform/enter.ts,
  // hotelParts EnterHotelModal) before it calls this: the shell only switches to the hotel and starts the 60-minute read-only visit.
  // `reason` (optional) is shown as the banner's tooltip when the page passes it. `expiresAt` (ISO) is the REAL server's end of the visit: used for
  // the banner and the automatic exit when it is a valid time in the future; the local 60-minute clock is the mock's (and the fallback).
  const enterHotel = (hotelId: string, reason?: string, expiresAt?: string, access: 'view' | 'full' = 'view') => {
    // On at once (not only in the effect below): the hotel's screens mount, and make their first calls, before this component's effects run.
    // Only a view visit is read only here; in a full visit the server refuses what its deny list names (403 with the reason) and the screen shows it.
    setReadOnlyView(access === 'full' ? null : readOnlyMessage(''));
    // A visitor (platform or group staff) sees the whole hotel; their own grants are not the hotel role's.
    setUserGrants(null);
    const server =expiresAt ? Date.parse(expiresAt) : NaN;
    const endsAt = Number.isFinite(server) && server > Date.now() ? server : Date.now() + INSIDE_MINUTES * 60_000;
    setMoved(true);
    setInside({ id: hotelId, name: '', reason: reason?.trim() ?? '', endsAt, access });
    void hotelNameOf(hotelId)
      .then((res) => {
        if (res.ok) {
          showHotelNames({ name: res.data.hotel.name });
          setInside((cur) => (cur && cur.id === hotelId && !cur.name ? { ...cur, name: res.data.hotel.name } : cur));
        }
      });
  };
  // "Extend 60 minutes": the server ends the live visit and starts a linked one (same reason; the access is decided again). 409 = the visit already ended.
  const extendVisit = async () => {
    const left = inside;
    if (!left) return;
    let res;
    if (baseKind === 'group') {
      const g = await import('../groups/group/api');
      res = await g.groupApiFor(props.user).extendMemberHotel(left.id);
    } else {
      const m = await import('../groups/platform/api');
      res = await m.platformApi.extendHotelVisit(left.id);
    }
    if (res.ok) {
      const server = res.data.expiresAt ? Date.parse(res.data.expiresAt) : NaN;
      const endsAt = Number.isFinite(server) && server > Date.now() ? server : Date.now() + INSIDE_MINUTES * 60_000;
      const access = res.data.access ?? (res.data.readOnly === false ? 'full' : 'view');
      setReadOnlyView(access === 'full' ? null : readOnlyMessage(left.name));
      setInside((cur) => (cur && cur.id === left.id ? { ...cur, endsAt, access } : cur));
      toast.show({ tone: 'success', text: trf("{0} more minutes inside {1}", [INSIDE_MINUTES, left.name || 'the hotel']) });
      return;
    }
    if (res.error.code === 'CONFLICT') {
      // The visit had ended on the server (time up, or left in another tab): back to the console, with the server's sentence.
      showHotelNames(props.user.hotel);
      setUserGrants(props.user.grants);
      setReadOnlyView(null);
      setMoved(true);
      setInside(null);
      toast.show({ tone: 'info', text: res.error.message || 'This visit has ended. Enter the hotel again.' });
      return;
    }
    toast.show({ tone: 'error', text: res.error.message || 'The visit could not be extended.' });
  };
  const exitHotel = () => {
    const left = inside;
    showHotelNames(props.user.hotel);
    setUserGrants(props.user.grants);
    setReadOnlyView(null);
    setMoved(true);
    setInside(null);
    // The audit entry of leaving is the platform API's (Frontend 2's mock); this only switches back.
    if (left) void leaveHotel(left.id);
  };

  // The 60-minute limit: when the time is up the visit ends on its own (audited like Exit) with a toast.
  const leaveRef = useRef(leaveHotel);
  useEffect(() => {
    leaveRef.current = leaveHotel;
  });
  useEffect(() => {
    if (!inside) return;
    const left = inside;
    // A clock check every few seconds rather than one long timeout: it also ends the visit right after the laptop wakes from sleep.
    const timer = window.setInterval(() => {
      if (Date.now() < left.endsAt) return;
      window.clearInterval(timer);
      setReadOnlyView(null);
      setMoved(true);
      setInside(null);
      void leaveRef.current(left.id);
      toast.show({ tone: 'info', text: trf("Your {0} minutes inside {1} ended", [INSIDE_MINUTES, left.name || 'the hotel']) });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [inside, toast]);

  // A reload inside a visit (real server): the session says which hotel, until when and with what access (GET /auth/session `visit`), so the banner and
  // the hotel come back instead of the console. The reason is not sent back, so the banner has no tooltip then.
  // The dashboard the server rendered (hydrating) already has that answer: the seed's session carries the visit (speed, 24 Oct 2026); a later mount
  // (an unlock) asks the server, as the visit may have ended meanwhile.
  const resumeRef = useRef(enterHotel);
  useEffect(() => {
    resumeRef.current = enterHotel;
  });
  const seededVisit = props.hydrating === true ? props.initialVisit : undefined;
  useEffect(() => {
    if (apiMode() !== 'real' || (baseKind !== 'platform' && baseKind !== 'group')) return;
    if (seededVisit !== undefined) {
      if (seededVisit) resumeRef.current(seededVisit.hotelId, undefined, seededVisit.expiresAt, seededVisit.access);
      return;
    }
    let live = true;
    void authApi.getSession().then((r) => {
      const v = r.ok ? r.data.visit : undefined;
      if (live && v) resumeRef.current(v.hotelId, undefined, v.expiresAt, v.access);
    });
    return () => {
      live = false;
    };
    // once per mount: the seeded visit is the first render's only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKind]);

  useReadOnlyInside(inside && inside.access !== 'full' ? inside.name : null);

  return <Frame key={inside ? `inside:${inside.id}` : baseKind} kind={inside ? 'hotel' : baseKind} inside={inside} onEnterHotel={enterHotel} onExitHotel={exitHotel} onExtendHotel={extendVisit} arrived={moved} {...props} />;
}

/**
 * The banner of a hotel visit: "Viewing" (read only) or "Full access", the hotel, the time left and the IST end, Extend 60 minutes and Exit.
 * The written reason shows as the tooltip when the page that opened the visit passed it. The minutes left tick on their own every 20 seconds.
 */
function VisitBanner({ inside, who, onExit, onExtend }: { inside: InsideHotel; who: string; onExit: () => void; onExtend: () => Promise<void> }) {
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 20_000);
    return () => window.clearInterval(timer);
  }, []);
  const minutes = Math.max(0, Math.ceil((inside.endsAt - now) / 60_000));
  const full = inside.access === 'full';
  const extend = async () => {
    setBusy(true);
    try {
      await onExtend();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="force-banner" role="status" title={inside.reason ? `Reason: ${inside.reason}` : undefined}>
      <i className={`bi ${full ? 'bi-pencil-square' : 'bi-eye'}`} />
      <span>
        <strong>{full ? tr("Full access") : tr("Viewing")}</strong> {inside.name || tr("this hotel")} {tr("as")} {who}: {minutes} {tr("min left, ends")} {formatTime(new Date(inside.endsAt).toISOString())}.
      </span>
      <button type="button" onClick={() => void extend()} disabled={busy}>
        {tr("Extend 60 minutes")}
      </button>
      <button type="button" onClick={onExit}>
        {tr("Exit")}
      </button>
    </div>
  );
}

const readOnlyMessage = (hotelName: string) => `You are viewing ${hotelName || 'this hotel'} as platform staff. This is read-only.`; // the server's own 403 sentence

/** Write verbs a button's visible text starts with (anywhere in the page or a dialog): the click itself changes data. */
const WRITE_TEXT =
  /^(save|delete|remove|purge|mark|restore|reverse|undo|approve|reject|disable|enable|reset|unlock|lock|archive|upload|import|send|resend|cancel (reservation|booking|bill|invitation|stay)|update|confirm|yes|decline|convert|unblock|block|toggle|start|stop|reactivate|deactivate|activate|suspend|take out of order|make|guest did not arrive|email|turn (on|off)|back in service|submit|assign|void|clear|publish)\b/i;
/** Verbs that, on the page, OPEN a form (to look at it: its final button is marked and the api refuses it); inside a dialog they are the write. */
const OPENER_TEXT = /^(new|add|create|record|invite|book|refund|settle|check[ -]?in|check[ -]?out|extend|move|pay|generate|regenerate|process|issue|rejoin)\b/i;
/** Buttons in a dialog's body that only change the form being filled. */
const FORM_LOCAL_TEXT = /^(reset|remove|clear)$/i;
/** Never marked: navigation, wizard steps, filters, pagers, search, theme, Exit. */
const NEVER_TEXT = /^(cancel(?! (reservation|booking|bill|invitation|stay))|reset$|clear$|close|back(?! in service)|next|continue|previous|prev|done|ok|exit|search|filter|clear filters?|apply|reset filters?|view|open|show|hide|print|download|export|pdf|preview|edit)\b/i;

/** True when this element (a button or menu item in the page or a dialog) is a write while the view is read-only. */
function isWriteControl(el: HTMLElement): boolean {
  if (!el.closest('#dash-content, .modal, .pms-dialog, [role=dialog]')) return false;
  if (el.matches('.btn-close, [role=tab], .nav-link, .page-link') || el.closest('.pagination, [role=tablist], .seg-tabs')) return false;
  const text = (el.textContent ?? '').replace(/[+\s]+/g, ' ').trim();
  const inDialog = !!el.closest('.modal, .pms-dialog, [role=dialog]');
  if (el.matches('.pd-confirm')) return true;
  if (text) {
    if (NEVER_TEXT.test(text)) return false;
    // Inside a dialog its final buttons count ("Create bill", "Add room", "Save"), and write verbs in its body ("Delete", "Reset and email
    // password", "Deactivate"), but not the body's form-only buttons (add a row, reset the counts, remove a line).
    if (inDialog) {
      if (el.closest('.modal-footer, .pd-actions') || el.matches('[type=submit]')) return WRITE_TEXT.test(text) || OPENER_TEXT.test(text);
      return WRITE_TEXT.test(text) && !FORM_LOCAL_TEXT.test(text);
    }
    // On the page an opener verb opens a form, except as the submit button of a form drawn in the page ("Create reservation").
    return WRITE_TEXT.test(text) || (el.matches('[type=submit]') && OPENER_TEXT.test(text));
  }
  // Icon-only: a delete / trash / danger button in the page (a pencil opens the edit form to look at it, so it stays; a row's trash inside a form only edits the form).
  if (inDialog) return false;
  const label = `${el.getAttribute('title') ?? ''} ${el.getAttribute('aria-label') ?? ''}`;
  return /delete|remove|trash/i.test(label) || !!el.querySelector('.bi-trash, .bi-trash3, .bi-trash-fill, .bi-trash3-fill, .bi-x-circle') || el.matches('.btn-danger, .btn-outline-danger, .btn-danger-solid');
}

const CONTROL = 'button, [role=button], a.btn, a.dropdown-item, [role=menuitem], input[type=submit]';

/**
 * Inside an entered hotel nothing can be changed (read-only by default; a later step adds the hotel's consent for changes). The rule that
 * stops a change is the api's (lib/api/mode.ts `setReadOnlyView`: every write method of a hotel module answers FORBIDDEN with the read-only
 * sentence, so a blocked save shows the screen's own error and the form stays open). The shell only marks the write buttons so the person sees it:
 * body class `hms-readonly`; a write button (WRITE_TEXT, or a dialog's final button, or an icon-only delete) gets `.hms-ro-write`,
 * aria-disabled and a title, and its click is cancelled with the toast. Forms, wizards (Continue / Back), tabs, filters, search, theme,
 * sign-out and Exit are untouched, so every form can still be opened and looked at.
 */
function useReadOnlyInside(hotelName: string | null) {
  const toast = useToast();
  useEffect(() => {
    if (hotelName === null) return;
    const message = readOnlyMessage(hotelName);
    setReadOnlyView(message);
    const mark = (el: HTMLElement) => {
      const write = isWriteControl(el);
      if (write === el.classList.contains('hms-ro-write')) return;
      if (write) {
        el.classList.add('hms-ro-write');
        el.setAttribute('aria-disabled', 'true');
        if (!el.dataset.roTitle) el.dataset.roTitle = el.getAttribute('title') ?? '';
        el.setAttribute('title', READ_ONLY_TITLE);
      } else {
        el.classList.remove('hms-ro-write');
        el.removeAttribute('aria-disabled');
        const was = el.dataset.roTitle;
        if (was) el.setAttribute('title', was);
        else el.removeAttribute('title');
        delete el.dataset.roTitle;
      }
    };
    const scan = (node: Node) => {
      if (!(node instanceof HTMLElement)) return;
      if (node.matches(CONTROL)) mark(node);
      node.querySelectorAll<HTMLElement>(CONTROL).forEach(mark);
    };
    // Only what changes is looked at: added nodes, and a button whose text changed (a wizard's "Continue" that becomes "Create bill").
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'characterData') {
          const b = r.target.parentElement?.closest<HTMLElement>(CONTROL);
          if (b) mark(b);
          continue;
        }
        r.addedNodes.forEach((n) => {
          if (n.nodeType === Node.TEXT_NODE) {
            const b = n.parentElement?.closest<HTMLElement>(CONTROL);
            if (b) mark(b);
          } else scan(n);
        });
      }
    });
    scan(document.body);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const onClick = (e: MouseEvent) => {
      const b = e.target instanceof Element ? e.target.closest<HTMLElement>('.hms-ro-write') : null;
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      toast.show({ tone: 'info', text: message });
    };
    document.body.classList.add('hms-readonly');
    document.addEventListener('click', onClick, true);
    return () => {
      setReadOnlyView(null);
      observer.disconnect();
      document.body.classList.remove('hms-readonly');
      document.removeEventListener('click', onClick, true);
      document.querySelectorAll<HTMLElement>('.hms-ro-write').forEach((el) => {
        el.classList.remove('hms-ro-write');
        el.removeAttribute('aria-disabled');
        const was = el.dataset.roTitle;
        if (was) el.setAttribute('title', was);
        else el.removeAttribute('title');
        delete el.dataset.roTitle;
      });
    };
  }, [hotelName, toast]);
}

/**
 * Mock mode only: the session's user is fixed at sign-in, so after a guest renames in My account the top bar would keep the old name. After
 * any form is sent on a guest screen the shell re-reads the guest's profile. The read is started on the next tick, after the screen's own
 * save has started: mock calls share one latency, so it is answered after the save.
 */
function useMockGuestName(kind: DashboardKind, userId: string): string | null {
  const [name, setName] = useState<{ userId: string; name: string } | null>(null);
  useEffect(() => {
    if (kind !== 'guest' || apiMode() !== 'mock') return;
    let alive = true;
    let timer: number | undefined;
    const read = () => {
      void import('../groups/guest/api').then((m) => m.guestApi.getProfile()).then((res) => {
        if (alive && res.ok && res.data.name) setName({ userId, name: res.data.name });
      });
    };
    const onSubmit = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(read, 0);
    };
    document.addEventListener('submit', onSubmit);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener('submit', onSubmit);
    };
  }, [kind, userId]);
  return name?.userId === userId ? name.name : null;
}

function Frame({
  kind,
  user,
  onSignOut,
  onLockScreen,
  hydrating,
  panels,
  initialRoute,
  initialHeader,
  urlSync = false,
  arrived = false,
  inside,
  onEnterHotel,
  onExitHotel,
  onExtendHotel,
}: RoleDashboardProps & { kind: DashboardKind; inside: InsideHotel | null; onEnterHotel: (hotelId: string) => void; onExitHotel: () => void; onExtendHotel: () => Promise<void>; arrived?: boolean }) {
  // Changes when the language (or its phrase book) changes: the page content below is keyed by it, so every text of the page is drawn again in the new language.
  const languageKey = useTranslationKey();
  // What this person may open, from their own session values (ui-shared/dashboards/access.ts): the server draws the same menu and redirects an address
  // they may not open. During a visit the visitor sees the whole hotel (no grants).
  const userGrants = user.grants ?? null;
  const viewer = useMemo<Viewer>(
    () => ({ kind, role: user.role, grants: inside ? null : userGrants }),
    [kind, user.role, inside, userGrants],
  );
  const sections = useMemo(() => menuFor(viewer), [viewer]);
  const supportChat = supportChatFor(kind, inside !== null);
  const firstId = sections[0]?.items[0]?.id ?? menuItems(kind)[0]?.id ?? '';

  // Back where the person was after a lock / unlock (or a dev reload of the shell): the stack is kept per user until sign-out.
  // (One entry per console: the Platform console and a hotel entered from it each keep their own place.)
  const placeKey = `${user.id}:${inside ? `inside:${inside.id}` : kind}`;
  // After a reload (decision 49) the page comes from this tab's copy; a page the role does not have any more falls back to the dashboard.
  const rememberedStack = useCallback((): View[] | null => {
    const kept = lastViews.get(placeKey);
    return kept && kept.length > 0 && kept.every((v) => findItem(kind, v.viewId) !== undefined || drillParent[v.viewId] !== undefined) ? kept : null;
  }, [placeKey, kind]);
  const ready = useAfterHydration();
  // The page the address names (decision 49: the URL decides; ui-shared/dashboards/routes.ts): "/" is the first page, a hotel visit lives under /inside.
  // Only pages this person may open count: a page of another role, or one hidden from them, opens the first page instead and the address is corrected.
  // Pages hidden from the menu (My Profile, Books, Check-in) still have an address: the same rules as the menu, without "hidden".
  const allowed = useMemo(() => openableIds(viewer), [viewer]);
  // The stack a page stands on: a menu page alone; a detail page (drillParent) on top of its parent, so Back inside the app goes to the parent.
  const stackFor = useCallback(
    (route: Route | null): View[] | null => {
      const build = (r: Route): View[] | null => {
        if (allowed.has(r.viewId)) return [{ viewId: r.viewId, params: r.params, rootId: rootFor(kind, r.viewId, firstId) }];
        const parent = drillParent[r.viewId];
        if (!parent) return null;
        const below = build({ viewId: parent, params: {} });
        return below ? [...below, { viewId: r.viewId, params: r.params, rootId: below[below.length - 1].rootId }] : null;
      };
      return route ? build(route) : null;
    },
    [allowed, kind, firstId],
  );
  const routeOpts = { home: firstId, inside: inside !== null };
  const readAddress = (): Route | null => (typeof window === 'undefined' ? null : routeForPath(kind, window.location.pathname, window.location.search, routeOpts));
  // While the server HTML is being hydrated, the page is the one the server read from the address (the first render must equal the server's);
  // any later mount (a visit entered or left, an unlock) reads the address itself.
  const [addressRoute] = useState<Route | null>(() => (urlSync ? (hydrating && !ready ? (initialRoute ?? null) : readAddress()) : null));
  // The opening stack, kept as ONE object while its inputs stay the same (the page shown compares its params by identity, so a new object on
  // every render would make it re-render without end).
  // "/" and an address this person may not open: the first page (the address is corrected). The one exception: a /inside address in a console
  // whose visit has ended goes back to the page this person was on before the visit. The /dev previews keep the remembered page as before.
  const baseStack = useMemo<View[]>(() => {
    const fromAddress = stackFor(addressRoute);
    if (fromAddress) return fromAddress;
    const first: View[] = [{ viewId: firstId, params: {}, rootId: firstId }];
    const visitEnded = urlSync && ready && !inside && typeof window !== 'undefined' && (window.location.pathname === INSIDE_PREFIX || window.location.pathname.startsWith(`${INSIDE_PREFIX}/`));
    if (!urlSync || visitEnded) return ready ? (rememberedStack() ?? first) : first;
    return first;
  }, [stackFor, addressRoute, firstId, urlSync, ready, inside, rememberedStack]);
  const [ownStack, setOwnStack] = useState<View[] | null>(null);
  const stack = ownStack ?? baseStack;
  const baseRef = useRef(baseStack);
  useEffect(() => {
    baseRef.current = baseStack;
  });
  const setStack = useCallback((next: View[] | ((prev: View[]) => View[])) => setOwnStack((prev) => (typeof next === 'function' ? next(prev ?? baseRef.current) : next)), []);
  useEffect(() => {
    if (ready) lastViews.set(placeKey, stack);
  }, [placeKey, stack, ready]);
  // How the next page change goes into the address bar: the first one corrects the address the dashboard opened on (replace), later ones are new
  // history entries (push); a Back or Forward of the browser has already moved the address.
  // A dashboard that comes up because a visit began or ended adds an entry, so the page it came from stays in the history.
  const addressWrite = useRef<'replace' | 'push'>(arrived ? 'push' : 'replace');
  // The server drew the light theme and the inline script in <head> already set the right one before the first paint; the browser copy shows from the render after hydration.
  const [chosenTheme, setTheme] = useState<'light' | 'dark' | null>(null);
  const theme: 'light' | 'dark' = chosenTheme ?? (ready ? startTheme() : 'light');
  const signOut = () => {
    lastViews.forgetAll();
    onSignOut();
  };
  // The browser copy (or the device) first, so there is no flash; the saved choice below then wins.
  const online = useOnline();
  const shownName = useMockGuestName(kind, user.id);
  const shellUser = shownName && shownName !== user.displayName ? { ...user, displayName: shownName } : user;
  // Pallav shows the second panel from 761px up; below that it is hidden (the rail stays as icons). The server cannot know the width, so the page it
  // draws has the panel (Pallav's CSS hides it on a phone) and so does the hydration render; the real width counts from the render right after.
  const wide = useMedia('(min-width: 761px)') || (hydrating === true && !ready);
  const paneWidth = useMedia(PANE_MEDIA) && ready;

  const current = stack[stack.length - 1] ?? { viewId: firstId, params: {}, rootId: firstId };
  // the list a record page stands on (its stack entry right below it), while the tablet draws the two side by side
  const under = stack.length > 1 ? stack[stack.length - 2] : undefined;
  const paneList = paneWidth && under && PANE_LISTS[current.viewId] === under.viewId ? under : null;

  // The Company and Guest portals' hotel selector (decision 48): choosing a hotel re-opens the current page, so every page reloads for it.
  const portalHotel = usePortalHotel();
  const portal = isPortalKind(kind);
  // the portals' sidebar brand follows the selector: the product mark with "All hotels · N", or the chosen hotel's name (PM, 18 Oct)
  const portalBrand = usePortalBrand(kind === 'guest' || kind === 'corporate' ? kind : null);

  // ---- The address bar follows the page (decision 49: the URL decides). Same document, no server request: the browser's own history API. ----
  // In the portals the address also carries the hotel choice (`?hotel=<id>`), so a link keeps it.
  const addressFor = (viewId: string, params: Params, opts: { home?: string; inside?: boolean } = routeOpts): string | null => {
    const path = pathForRoute(kind, { viewId, params }, opts);
    return path !== null && portal ? withPortalHotel(path, portalHotel) : path;
  };
  const address = urlSync ? addressFor(current.viewId, current.params) : null;
  const addressOf = (s: View[]): string | null => {
    const top = s[s.length - 1];
    return top ? addressFor(top.viewId, top.params) : null;
  };
  // Each entry also carries its whole page stack (plain page ids and their small params, the same as lastView keeps), so Back and Forward bring
  // back what the address cannot say: a list's filter, the page under a detail page.
  const stackJson = JSON.stringify(stack.map((v) => ({ viewId: v.viewId, params: v.params, rootId: v.rootId })));
  useEffect(() => {
    if (!ready || address === null) return;
    const mode = addressWrite.current;
    addressWrite.current = 'push';
    const hmsStack = JSON.parse(stackJson) as View[];
    // Only our own keys: Next.js copies its router state into the entry itself and then follows the new address (a spread of its old state would stop that).
    if (window.location.pathname + window.location.search === address || mode === 'replace') window.history.replaceState({ hmsDepth: hmsDepth(), hmsStack }, '', address);
    // the phone page search's own entry (PhoneSearch.tsx) has the same address and stack as the page under it: the new page takes its place (one step above that
    // page, as a push would be), so opening a row while the search is open leaves no extra Back
    // (the same for an overlay's own entry, tempHistory.ts: a guest bottom sheet open when the page changes)
    else if (onPhoneSearchEntry() || onTempEntry()) window.history.replaceState({ hmsDepth: hmsDepth() + 1, hmsStack }, '', address);
    else window.history.pushState({ hmsDepth: hmsDepth() + 1, hmsStack }, '', address);
  }, [ready, address, stackJson]);
  // Back / Forward of the browser: show the page of the address it moved to.
  useEffect(() => {
    if (!urlSync) return undefined;
    const onPop = () => {
      // the phone page search stepping back out of its own entry (Esc, the arrow): the same page, nothing to show again (no new stack, no refetch)
      // and an overlay (a guest bottom sheet, tempHistory.ts) closing by Back or by its own X: the page stays as it is
      if (isPhoneSearchClosing() || isTempClosing()) return;
      const atInside = window.location.pathname === INSIDE_PREFIX || window.location.pathname.startsWith(`${INSIDE_PREFIX}/`);
      // Back out of a hotel visit leaves the visit; the console that comes up shows the page of the address.
      if (inside && !atInside) {
        onExitHotel();
        return;
      }
      // the portals' hotel choice comes back with the address (no `hotel` = All hotels)
      if (portal) portalHotelStore.set(portalHotelFromSearch(window.location.search) ?? PORTAL_ALL_HOTELS);
      const route = readAddress();
      const saved =(window.history.state as { hmsStack?: unknown } | null)?.hmsStack;
      const savedOk =
        route !== null &&
        Array.isArray(saved) &&
        saved.length > 0 &&
        saved.every((v: View) => v && typeof v.viewId === 'string' && typeof v.rootId === 'string' && v.params && typeof v.params === 'object' && (allowed.has(v.viewId) || v.viewId in drillParent)) &&
        (saved[saved.length - 1] as View).viewId === route.viewId &&
        ((saved[saved.length - 1] as View).params.id ?? null) === (route.params.id ?? null);
      let next: View[] | null = savedOk ? (saved as View[]) : stackFor(route);
      // An address this person may not open, or a visit's address after the visit ended: the first page, or the page from before the visit.
      if (!next) next = (!inside && atInside ? rememberedStack() : null) ?? [{ viewId: firstId, params: {}, rootId: firstId }];
      const to = addressOf(next);
      if (to && to !== window.location.pathname + window.location.search) window.history.replaceState({ hmsDepth: hmsDepth(), hmsStack: next }, '', to);
      setStack(next);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  });
  const subKey = subKeyFor(kind, current.viewId, current.rootId);
  const subs = useMemo(() => (subKey ? menuFor(viewer, subNav[subKey] ?? []) : []), [subKey, viewer]);
  const showSub = wide && subs.length > 0;
  // Pallav shows the payroll rail only once a company is chosen; before that the panel holds just the company card and a note.
  const payrollOpen = usePayrollCompanyOpen();
  // The company portal's unread notifications: the sidebar badge, the phone bar and the bell all read this one store.
  usePortalUnreadPolling(kind === 'corporate');
  // the person's own photo for the avatars (read once per tab; real server only), once the browser is idle (1.5 s at the latest): the first screen's data goes first (speed, 24 Oct 2026)
  useEffect(() => deferIdle(loadMyPhoto, 1500), []);
  const unread = usePortalUnread().unread;
  // The Conversations badge (decision 66): hotel staff who may open Conversations, outside a visit, and the platform console. One background check every 90 s.
  // the menu badge sits on Email (the team's unread count of the main list); WhatsApp has its own page beside it
  // ONE Email entry per console (MJ, 5 Nov 2026): its badge sums the boxes this person can see (the shared inbox, if theirs, and their own mailbox)
  const emailId = kind === 'platform' ? 'platform.email' : kind === 'group' ? 'group.email' : 'hotel.email';
  const sharedId = kind === 'platform' ? 'platform.email' : 'hotel.conversations';
  const convOn = ((kind === 'hotel' && !inside) || kind === 'platform') && allowed.has(sharedId);
  useConversationsPolling(convOn, kind === 'platform' ? 'platform' : 'hotel');
  // My mailbox (platform 0178, 0179): the signed-in person's own mailbox only; a hotel's staff outside a visit
  const personalId = kind === 'platform' ? 'platform.myMailbox' : kind === 'group' ? 'group.myMailbox' : 'hotel.myMailbox';
  const personalOn = (kind === 'platform' || kind === 'group' || (kind === 'hotel' && !inside)) && allowed.has(personalId);
  useConversationsPolling(personalOn, 'personal');
  // the "new mail" ping: one socket for this dashboard, off when the server has no ping set up (the timed checks above stay as the safety net)
  useMailSignalConnection(convOn || personalOn);
  // live Email and WhatsApp (pageKey.ts, groups/conversations/liveConnection.ts): one line for the pages this person has in this console
  // what the Email and WhatsApp pages have seen belongs to this person in this console and this visit: another one (another hotel visited) starts empty
  claimConvCache(`${user.id}|${kind}|${inside?.id ?? ''}`);
  const hubOn = kind === 'group' ? allowed.has('group.email') : ((kind === 'hotel' && !inside) || kind === 'platform') && (allowed.has(sharedId) || allowed.has(`${kind}.whatsapp`));
  const liveScopes = useMemo<ConvScope[]>(() => [...(hubOn ? [kind === 'platform' ? 'platform' : kind === 'group' ? 'group' : 'hotel'] as ConvScope[] : []), ...(personalOn ? ['personal' as const] : [])], [hubOn, kind, personalOn]);
  useConvLiveConnection(liveScopes.length > 0, liveScopes);
  const personalUnread = usePersonalUnread();
  const convUnread = useConversationsUnread();
  const emailUnread = (convOn ? convUnread : 0) + (personalOn ? personalUnread : 0);
  const staffBadgeMap: Record<string, number> = emailUnread > 0 ? { [emailId]: emailUnread } : {};
  const staffBadges = Object.keys(staffBadgeMap).length > 0 ? staffBadgeMap : undefined;
  const railClosed = subKey === 'hotel.payroll.home' && !payrollOpen;

  // The attribute follows the state: leaving the dashboard (or React's dev remount) clears it, so it is written again every time it is shown.
  useEffect(() => {
    if (ready) applyTheme(theme);
  }, [theme, ready]);

  // A choice made elsewhere (My profile > Theme) moves the top bar's moon / sun too.
  useEffect(() => {
    const on = (e: Event) => {
      const next = (e as CustomEvent<{ theme?: string }>).detail?.theme;
      if (next === 'light' || next === 'dark') queueMicrotask(() => setTheme(next));
    };
    document.addEventListener('pms:theme', on);
    return () => document.removeEventListener('pms:theme', on);
  }, []);

  // The person's saved day / night choice wins over this browser's.
  useEffect(() => {
    let alive = true;
    void adoptSavedTheme(user.id).then((saved) => {
      if (alive && saved) setTheme(saved);
    });
    return () => {
      alive = false;
    };
  }, [user.id]);

  // ---- Navigation: menu entries replace the stack, drill-in views push onto it ----

  const navigate = useCallback(
    (viewId: string, params: Params = {}) => {
      setStack((prev) => {
        const cur = prev[prev.length - 1];
        // A hidden menu item that has a drill parent (Platform: New hotel, Hotel details, Group details) is a drill-in: it is pushed
        // (so Back works) and its parent's menu entry stays lit; otherwise it would count as its own, invisible, menu entry.
        const parent = drillParent[viewId];
        const drillIn = !!parent && findItem(kind, viewId)?.hidden === true;
        const rootId = drillIn ? rootFor(kind, parent, cur?.rootId ?? firstId) : rootFor(kind, viewId, cur?.rootId ?? firstId);
        if (!drillIn && isMenuId(kind, viewId)) return [{ viewId, params, rootId, reset: againCount(prev, viewId) }];
        // tablet two panes: another record opened from the list takes the open one's place (the list stays under it)
        if (paneWidth && cur && PANE_LISTS[viewId] && PANE_LISTS[cur.viewId] === PANE_LISTS[viewId] && prev.length > 1 && prev[prev.length - 2]?.viewId === PANE_LISTS[viewId]) {
          return [...prev.slice(0, -1), { viewId, params, rootId }];
        }
        return [...prev, { viewId, params, rootId }];
      });
    },
    [kind, firstId, setStack, paneWidth],
  );

  const back = useCallback(() => {
    // The app's own Back is the browser's Back while this dashboard added the entry; a page opened straight from a link has nothing to go back to
    // in the browser (that would leave the site), so it steps down its own stack and corrects the address instead.
    if (urlSync && hmsDepth() > 0) {
      window.history.back();
      return;
    }
    const below = stack.length > 1 ? stack[stack.length - 2] : undefined;
    const path = urlSync && below ? pathForRoute(kind, { viewId: below.viewId, params: below.params }, { home: firstId, inside: inside !== null }) : null;
    const to = path !== null && portal ? withPortalHotel(path, portalHotel) : path;
    if (to) window.history.replaceState({ hmsDepth: 0, hmsStack: stack.slice(0, -1) }, '', to);
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, [setStack, urlSync, stack, kind, firstId, inside, portal, portalHotel]);

  /** A click in the second panel keeps the parent menu entry highlighted. */
  const openSub = useCallback(
    (viewId: string) => {
      setStack((prev) => {
        const cur = prev[prev.length - 1];
        const key = subKeyFor(kind, viewId, cur?.rootId ?? firstId);
        return [{ viewId, params: {}, rootId: key ?? viewId, reset: againCount(prev, viewId) }];
      });
    },
    [kind, firstId, setStack],
  );

  // ---- Page title, focus and scroll on view change ----

  const item = pageItem(kind, current.viewId, current.rootId);
  const title = item?.pageTitle ?? item?.label ?? dashboardTitle[kind].name;
  const stackPageKey = pageKeyOf(stack);
  const contentRef = useRef<HTMLDivElement>(null);
  const seen = useRef<string | null>(null);

  useEffect(() => {
    document.title = `${title} · ${dashboardTitle[kind].name}`;
    // the Email and WhatsApp pages keep their place while a thread opens or closes (pageKey.ts)
    const key = liveFamilyOf(current.viewId) ? stackPageKey : `${current.viewId}:${stack.length}`;
    if (seen.current !== null && seen.current !== key) window.scrollTo({ top: 0 });
    seen.current = key;
  }, [title, kind, current.viewId, stack.length, stackPageKey]);

  // Keep the highlighted menu entry visible when the menu is long.
  useEffect(() => {
    // Nothing moves while the active entry is already on screen; otherwise the list scrolls just enough to show it.
    const item = document.querySelector<HTMLElement>('#sidebar .sidebar-nav a.active');
    const box = item?.closest<HTMLElement>('.sidebar-nav');
    if (!item || !box) return;
    const a = item.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (a.top < b.top) box.scrollTop -= b.top - a.top + 8;
    else if (a.bottom > b.bottom) box.scrollTop += a.bottom - b.bottom + 8;
  }, [current.rootId]);

  // A reload of this browser starts as the dashboard outline, not as the sign-in page (shellFlag.ts; cleared when the session ends).
  useEffect(() => markDashboardOpen(true), []);

  // which way the page moved (phones slide the new page in from the right going deeper, from the left coming back)
  const [navDir, setNavDir] = useState<{ depth: number; viewId: string; dir: 'forward' | 'back' | 'switch' }>({ depth: stack.length, viewId: current.viewId, dir: 'switch' });
  if (navDir.depth !== stack.length || navDir.viewId !== current.viewId) {
    setNavDir({ depth: stack.length, viewId: current.viewId, dir: stack.length > navDir.depth ? 'forward' : stack.length < navDir.depth ? 'back' : 'switch' });
  }
  const [attempt, setAttempt] = useState(0);
  const screen = useScreen(current.viewId, attempt);
  const listScreen = useScreen(paneList?.viewId ?? current.viewId, attempt);
  // The old screen stays on display until the new one is ready (no skeleton flash); the very first screen shows the skeleton.
  const viewKey = `${stackPageKey}${kind === 'guest' || kind === 'corporate' ? `:${portalHotel}` : ''}`;
  const [shown, setShown] = useState<{ key: string; screen: Exclude<typeof screen, undefined>; params: Params } | null>(null);
  if (screen !== undefined && (shown?.key !== viewKey || shown.screen !== screen || shown.params !== current.params)) {
    setShown({ key: viewKey, screen, params: current.params });
  }
  const showing = screen !== undefined ? { key: viewKey, screen, params: current.params } : shown;
  // Decision 51: there is no search in the header; every list page has its own search box. The screen groups of the pages this person may open still load
  // quietly in the background, so a menu click finds them ready: 3 seconds after the first screen is on display (its data has normally answered by then), one
  // group per idle slot (registry.ts); never before, so they do not compete with the first screen's own request (speed, 24 Oct 2026).
  const firstShown = showing !== null;
  const openable = useMemo(() => [...allowed], [allowed]);
  useEffect(() => {
    if (!firstShown) return;
    let stop: (() => void) | undefined;
    const t = setTimeout(() => {
      stop = preloadGroupsFor(openable);
    }, 3000);
    return () => {
      clearTimeout(t);
      stop?.();
    };
  }, [firstShown, openable]);
  const screenProps: ScreenProps = { user, params: showing?.params ?? current.params, navigate, back, signOut, enterHotel: onEnterHotel, exitHotel: onExitHotel };
  const goHome = () => navigate(firstId);
  const listProps: ScreenProps | null = paneList ? { ...screenProps, params: paneList.params } : null;
  // The brand is data: the signed-in hotel (or group, or portal) name. "Management Suite" is Pallav's tagline.
  const brandName = inside ? inside.name || user.hotel?.name || dashboardTitle.hotel.name : portalBrand ? portalBrand.name : kind === 'platform' ? dashboardTitle.platform.name : (user.hotel?.name ?? user.group?.name ?? dashboardTitle[kind].name);
  const subOwner = subKey ? findItem(kind, subKey) : undefined;
  const sectionTitle = sectionTitleFor(kind, current.rootId) ?? brandName;
  // The company list (no company open yet): the page sits in the menu's Staff section.
  // Owner and section are shown once when they are the same word (Website's panel owner is also its section: "Website", not "Website · Website").
  const pair = (a: string, b: string) => (a.trim().toLowerCase() === b.trim().toLowerCase() ? a : `${a} · ${b}`);
  const eyebrow =
    current.viewId === 'hotel.payroll.home'
      ? 'Staff'
      : showSub && subKey
        ? pair(subOwner?.label ?? sectionTitle, sectionTitleFor(kind, subActiveFor(current.viewId)) ?? sectionTitle)
        : sectionTitle;

  // The shell as drawn now, for the next reload's first frame (SnapshotShell): written after every change of brand, menu, page or theme.
  const headerIcon = item?.icon ?? 'house';
  useEffect(() => {
    saveShellSnapshot({
      v: 1,
      brandName,
      user: { id: user.id, displayName: shellUser.displayName, role: user.role },
      sections,
      activeId: current.rootId,
      header: { icon: headerIcon, eyebrow, title },
      theme,
      portal: kind === 'guest' || kind === 'corporate',
    });
  }, [brandName, user.id, shellUser.displayName, user.role, sections, current.rootId, headerIcon, eyebrow, title, theme, kind]);

  return (
    <PallavFrame sheets={pageSheetsFor(current.viewId)} preloaded={hydrating}>
      <PallavShell
        hydrating={hydrating}
        initialPanels={panels ?? null}
        user={shellUser}
        brandName={brandName}
        brandLine={inside ? undefined : portalBrand?.line}
        brandMarkText={inside ? undefined : portalBrand?.mark}
        look={kind === 'guest' ? 'guest' : kind === 'corporate' ? 'corporate' : 'staff'}
        // the guest's top bar shows the stay status and one action instead of the greeting and clock (MJ, 26 Oct 2026)
        info={
          kind === 'guest' ? (
            <GuestTopInfo firstName={shellUser.displayName.trim().split(/\s+/)[0] ?? ''} onGo={navigate} />
          ) : kind === 'corporate' && !inside ? (
            <CorporateTopInfo firstName={shellUser.displayName.trim().split(/\s+/)[0] ?? ''} onGo={navigate} />
          ) : undefined
        }
        // MJ, 26 Oct 2026: the hotel is changed from the top bar, on every screen size (the portals' top bar carries the drop-down; no second copy here)
        sidebarTop={undefined}
        // MJ, 26 Oct 2026: the hotel is chosen from the side menu's drop-down only: no hotel bar under the phone's top bar (the phone's side menu is the
        // company portal's More sheet and the guest's Account page, which carry the same drop-down)
        mobileBar={undefined}
        bottomNav={
          kind === 'guest' || kind === 'corporate' ? (
            <PortalBottomNav kind={kind} activeId={current.rootId} viewId={current.viewId} onGo={navigate} onSignOut={signOut} unread={kind === 'corporate' ? unread : 0} />
          ) : kind === 'hotel' || kind === 'platform' || kind === 'group' ? (
            // the staff dashboards get the same phone bottom bar (four main jobs and a More sheet with every entry); phones only (CSS)
            <StaffBottomNav
              kind={kind}
              sections={sections}
              activeId={current.rootId}
              onGo={navigate}
              onSignOut={signOut}
              profileId={profileViewId[kind]}
              profileName={shellUser.displayName}
              badges={staffBadges}
              sub={subs.length > 0 && !railClosed ? { title: subOwner?.label ?? brandName, sections: subs, activeId: subActiveFor(current.viewId), onSelect: openSub } : undefined}
            />
          ) : undefined
        }
        main={sections}
        activeId={current.rootId}
        onMain={navigate}
        onHome={goHome}
        wide={wide}
        sub={
          showSub
            ? { title: subOwner?.label ?? brandName, icon: subOwner?.icon ?? 'list', sections: railClosed ? [] : subs, activeId: subActiveFor(current.viewId), onSelect: openSub,
                note: railClosed ? <p className="rail-note"><i className="bi bi-info-circle" /> {tr("Open a company to reach Staff, Attendance, Salary and the rest.")}</p> : subKey === 'hotel.web.overview' ? (
                  // the live website, at the top of the Website panel (the pages' own tab strip hides on a desktop: the panel already lists them)
                  <a className="rail-item rail-site" href={WEBSITE_URL} target="_blank" rel="noopener" title={tr("Open the live website")}><Bi name="box-arrow-up-right" /><span>{tr("View site")}</span></a>
                ) : undefined }
            : undefined
        }
        header={{ icon: headerIcon, eyebrow, title }}
        onProfile={() => navigate(profileViewId[kind])}
        onLock={onLockScreen}
        onSignOut={signOut}
        // Force mode (backdate, edit closed days) is a hotel feature: not offered on the Platform console, nor in a hotel entered read-only.
        canForce={kind !== 'platform' && !inside && hasAbility(user, ABILITY.force)}
        theme={theme}
        yearMenu={kind === 'hotel'}
        initialNow={hydrating && !ready ? initialHeader?.at : undefined}
        banner={
          inside ? <VisitBanner inside={inside} who={user.role === 'group_hotel_admin' ? 'the Group Hotel Admin' : 'platform staff'} onExit={onExitHotel} onExtend={onExtendHotel} /> : undefined
        }
        onBooks={kind === 'hotel' ? () => navigate('hotel.books') : undefined}
        // the guest's Account is a tab of its own (decision 71): no Back arrow there
        onBack={drillParent[current.viewId] !== undefined || (current.viewId === profileViewId[kind] && kind !== 'guest') ? back : undefined}
        badges={kind === 'corporate' ? { 'corporate.notifications': unread } : staffBadges}
        bell={kind === 'corporate' ? (
          <>
            <PortalBell navigate={navigate} />
          </>
        ) : kind === 'hotel' && !inside ? <AttentionBell navigate={navigate} role={user.role} /> : undefined}
        onTheme={setTheme}
        onHelp={supportChat ? () => window.dispatchEvent(new Event(OPEN_HELP_EVENT)) : undefined}
      >
        <div id="dash-content" ref={contentRef} tabIndex={-1} aria-label={title} style={{ outline: 'none' }} data-nav={navDir.dir}>
          <RefreshLine />
          <SoftRefresh />
          <PullToRefresh />
          <CutTextTitles />
          {!online && (
            <div style={{ marginBottom: 16 }}>
              <OfflineBanner />
            </div>
          )}
          <div className={paneList ? 'hms-panes' : undefined}>
            {paneList && listProps ? (
              <section key={`list:${paneList.viewId}:${languageKey}`} className="hms-pane hms-pane-list" aria-label={pageItem(kind, paneList.viewId, paneList.rootId)?.pageTitle ?? paneList.viewId}>
                {listScreen && listScreen !== LOAD_FAILED ? <ScreenBoundary onHome={goHome}>{createElement(listScreen, listProps)}</ScreenBoundary> : <PageSkeleton tiles={false} />}
              </section>
            ) : null}
            <div key={`${showing?.key ?? viewKey}:${languageKey}`} className={paneList ? 'hms-page hms-pane hms-pane-detail' : 'hms-page'}>
              {/* The server draws the sidebar and top bar only; the page itself is its skeleton until the browser has it (its data loads there anyway),
                  so no screen ever renders on the server with values meant for another request. */}
              {showing === null || (hydrating === true && !ready) ? (
                <PageSkeleton />
              ) : showing.screen === LOAD_FAILED ? (
                <ShellNote icon="wifi-off" title={dashLabels.loadFailedTitle} text={dashLabels.loadFailedBody} retry={() => setAttempt((n) => n + 1)} onHome={goHome} />
              ) : showing.screen ? (
                <ScreenBoundary onHome={goHome}>
                  <KpiSlot.Provider value={kind === 'guest' ? <PageKpis viewId={showing.key.split(':')[0]} user={user} params={showing.params} navigate={navigate} /> : null}>
                    {kind === 'guest' ? null : <PageKpis viewId={showing.key.split(':')[0]} user={user} params={showing.params} navigate={navigate} />}
                    {createElement(showing.screen, screenProps)}
                  </KpiSlot.Provider>
                </ScreenBoundary>
              ) : (
                <ShellNote icon="clock" title={dashLabels.comingSoonTitle} text={dashLabels.comingSoonBody} onHome={goHome} />
              )}
            </div>
          </div>
        </div>
        {supportChat ? <SupportChat chat={supportChat} /> : null}
        {kind === 'hotel' || kind === 'guest' || kind === 'corporate' ? <Notch announcements={kind === 'hotel' && !inside} onViewNotice={kind === 'corporate' ? () => navigate('corporate.notifications') : undefined} /> : null}
      </PallavShell>
    </PallavFrame>
  );
}
