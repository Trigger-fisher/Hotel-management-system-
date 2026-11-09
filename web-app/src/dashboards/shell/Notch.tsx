'use client';

// Notifications (MJ, 5 Nov 2026): a permanent message (an important announcement or notice, kept until Accept) is docked in the page under the top bar and takes
// its own space. A normal one floats over the page at the top, counts down a few seconds with a bar, waits while the pointer, the focus or a finger is on it,
// widens to show the whole text, and leaves on its own. Several at once wait in a line. The look lives in areas/shell.css (.nx-).
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { PortalNotification } from '@shared/dashboards/notifications';
import type { HotelAnnouncement } from '@shared/dashboards/overview';
import { notchCopyByLanguage } from '@shared/dashboards/notchCopy.lang';
import { trf, useCopy } from '@/lib/i18n/language';

import { Bi } from '@/dashboards/pallav/ui';
import { deferIdle } from '@/lib/idle';

import { overviewApi } from '../groups/overview/api';
import { browserAlert } from '../groups/notifications/NoticeToaster';
import { onNewNotices } from '../groups/notifications/unread';

const OPEN_MS = 8000;
const LEAVE_MS = 260;
const TICK_MS = 100;
const LIVE_MS = 10_000;

type Copy = typeof notchCopyByLanguage.en;

interface Message {
  key: string;
  kind: 'announcement' | 'notice';
  title: string;
  from: string;
  body: string;
  /** Permanent: docked until Accept. */
  important: boolean;
  /** The announcement id to mark as read when it is closed. */
  announcementId?: string;
}

const ofAnnouncement = (a: HotelAnnouncement, T: Copy): Message => ({ key: `a-${a.id}`, kind: 'announcement', title: a.title, from: T.announcement, body: a.body, important: a.important, announcementId: a.id });
const ofNotice = (n: PortalNotification, T: Copy): Message => ({ key: `n-${n.id}`, kind: 'notice', title: n.title, from: n.hotelName || T.notice, body: n.body, important: n.priority === 'important' });
const iconOf = (m: Message) => (m.important ? 'exclamation-circle-fill' : m.kind === 'announcement' ? 'megaphone-fill' : 'bell-fill');

export function Notch({ announcements, onViewNotice }: { announcements: boolean; onViewNotice?: () => void }) {
  const T = useCopy(notchCopyByLanguage);
  const [items, setItems] = useState<Message[]>([]);
  const [dock, setDock] = useState<HTMLElement | null>(null);
  const seen = useRef(new Set<string>());

  useEffect(() => setDock(document.getElementById('hms-dock')), []);

  const enqueue = useCallback((fresh: Message[]) => {
    const add = fresh.filter((m) => !seen.current.has(m.key));
    if (add.length === 0) return;
    add.forEach((m) => seen.current.add(m.key));
    setItems((cur) => [...cur, ...add]);
  }, []);

  // announcements (hotel): read when the browser is idle, then every 10 seconds while the tab is on screen and at once when it comes back, so a new one shows live
  const [tick, setTick] = useState(0);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (!announcements) return;
    const again = () => {
      if (document.visibilityState === 'visible') setTick((n) => n + 1);
    };
    const timer = window.setInterval(again, LIVE_MS);
    window.addEventListener('hms:check-session', again);
    document.addEventListener('visibilitychange', again);
    window.addEventListener('focus', again);
    window.addEventListener('online', again);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('hms:check-session', again);
      document.removeEventListener('visibilitychange', again);
      window.removeEventListener('focus', again);
      window.removeEventListener('online', again);
    };
  }, [announcements]);
  useEffect(() => (announcements ? deferIdle(() => setStarted(true), 1500) : undefined), [announcements]);
  useEffect(() => {
    if (!announcements || !started) return;
    let live = true;
    void overviewApi.getAnnouncements().then((res) => {
      if (live && res.ok) enqueue(res.data.map((a) => ofAnnouncement(a, T)));
    });
    return () => {
      live = false;
    };
  }, [announcements, started, tick, enqueue, T]);
  // notices (portal): the ones that just arrived
  useEffect(
    () =>
      onNewNotices((fresh) => {
        enqueue(fresh.map((n) => ofNotice(n, T)));
        const first = fresh[0];
        if (first) browserAlert(first);
      }),
    [enqueue, T],
  );

  // gone: a normal announcement counts as read once it has been shown; a permanent one was accepted
  const finish = useCallback((m: Message) => {
    if (m.announcementId) void overviewApi.dismissAnnouncement(m.announcementId);
    setItems((cur) => cur.filter((x) => x.key !== m.key));
  }, []);

  const permanent = items.find((m) => m.important);
  const floating = items.find((m) => !m.important);
  const waiting = items.length - Number(Boolean(permanent)) - Number(Boolean(floating));

  const docked = permanent ? (
    <div className="nx-docked" role="alert" aria-label={T.region}>
      <span className="nx-ico" aria-hidden="true">
        <Bi name={iconOf(permanent)} />
      </span>
      <div className="nx-text">
        <span className="nx-from">{`${T.important} · ${permanent.from}`}{waiting + Number(Boolean(floating)) > 0 ? ` · ${T.more(waiting + Number(Boolean(floating)))}` : ''}</span>
        <strong className="nx-title">{permanent.title}</strong>
        {permanent.body ? <p className="nx-body">{permanent.body}</p> : null}
      </div>
      {/* check-shared-ignore: the notice's own Accept button */}
      <button type="button" className="nx-btn is-main" onClick={() => finish(permanent)}>
        {T.accept}
      </button>
    </div>
  ) : null;

  return (
    <>
      {docked ? (dock ? createPortal(docked, dock) : docked) : null}
      {floating ? <Floating key={floating.key} m={floating} more={waiting} T={T} onDone={finish} onView={floating.kind === 'notice' ? onViewNotice : undefined} /> : null}
    </>
  );
}

function Floating({ m, more, T, onDone, onView }: { m: Message; more: number; T: Copy; onDone: (m: Message) => void; onView?: () => void }) {
  const [left, setLeft] = useState(OPEN_MS);
  const [leaving, setLeaving] = useState(false);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [touch, setTouch] = useState(false);
  const rest = useRef(OPEN_MS);
  const paused = hover || focus || touch;

  const close = useCallback(() => setLeaving(true), []);
  useEffect(() => {
    if (!leaving) return undefined;
    const gone = window.setTimeout(() => onDone(m), LEAVE_MS);
    return () => window.clearTimeout(gone);
  }, [leaving, onDone, m]);

  // the countdown stands still while it is held
  useEffect(() => {
    if (paused || leaving) return undefined;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      rest.current -= now - last;
      last = now;
      setLeft(Math.max(0, rest.current));
      if (rest.current <= 0) {
        window.clearInterval(id);
        close();
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [paused, leaving, close]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  const seconds = Math.ceil(left / 1000);
  return (
    <div
      className={`nx-float${leaving ? ' is-out' : ''}${paused ? ' is-held' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={T.region}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
      }}
      onTouchStart={() => setTouch(true)}
      onTouchEnd={() => {
        rest.current = Math.max(rest.current, 3000);
        setTouch(false);
      }}
    >
      <span className="nx-ico" aria-hidden="true">
        <Bi name={iconOf(m)} />
      </span>
      <div className="nx-text">
        <span className="nx-from">
          {m.from}
          {more > 0 ? ` · ${T.more(more)}` : ''}
        </span>
        <strong className="nx-title">{m.title}</strong>
        {m.body ? <p className="nx-body">{m.body}</p> : null}
      </div>
      <div className="nx-side">
        {onView ? (
          // check-shared-ignore: the notice's own View button
          <button type="button" className="nx-btn" onClick={() => { close(); onView(); }}>
            {T.view}
          </button>
        ) : null}
        {/* check-shared-ignore: the notice's own close button */}
        <button type="button" className="nx-x" title={T.close} aria-label={T.close} onClick={close}>
          <Bi name="x-lg" />
        </button>
      </div>
      <span className="nx-count" aria-hidden="true">{trf('Closes in {0} s', [String(seconds)])}</span>
      <span className="nx-bar" aria-hidden="true">
        <span style={{ transform: `scaleX(${left / OPEN_MS})` }} />
      </span>
    </div>
  );
}
