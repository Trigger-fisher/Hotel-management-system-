"use client";

import { onScreenLocked, onSessionEnded } from "@/lib/api/sessionEvents";
import {
  addTransitionType,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  ViewTransition,
} from "react";
import { initialPallavAuthState, pallavAuthReducer, SCREEN_LOCK_AFTER_MS, SCREEN_LOCK_WARNING_MS } from "@shared/auth-pallav";
import type { PallavAuthEvent, PallavAuthState, Session } from "@shared/auth-pallav";
import type { ShellPanels } from "@/lib/shellPanels";
import { authApi, getOnlineServerSnapshot, getOnlineSnapshot, hasStoredMockSession, quickLoginAllowed, subscribeOnline } from "@/lib/auth/api";
import { webDevice } from "@/lib/auth/device";
import { apiMode } from "@/lib/api/mode";
import { restoreOutcome } from "@/lib/auth/restore";
import { deferIdle } from "@/lib/idle";
import { dashboardWasOpen, markDashboardOpen } from "@/dashboards/shell/shellFlag";
import { DashboardPlaceholder } from "./DashboardPlaceholder";
import { lastViews } from "@/dashboards/shell/lastView";
import { decidePop, SAFE_STEPS, SIGN_IN_PATH, urlFor } from "@/lib/auth/navigation";
import { isAppPath } from "@shared/dashboards/routes";
import { AuthContext } from "./AuthContext";
import type { AuthContextValue, Direction, Notice, Prefill } from "./AuthContext";
import { AuthShell, AuthShellSkeleton, AuthShellUnreachable } from "./AuthShell";
import { clearResetToken, takeResetToken } from "@/lib/auth/resetLink";
import { StepView } from "./steps";
import { ResetLinkStep } from "./steps/ResetLinkStep";
import { SignedInStep } from "./steps/SignedInStep";

const SESSION_CHECK_MS = 60_000;
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

type WebEvent = PallavAuthEvent | { type: "RESTORE"; state: PallavAuthState };

function webReducer(state: PallavAuthState, e: WebEvent): PallavAuthState {
  return e.type === "RESTORE" ? e.state : pallavAuthReducer(state, e);
}

/** Steps during which the dashboard is (or comes back) on screen: it owns the address bar then. */
const DASHBOARD_STEPS: ReadonlySet<PallavAuthState["step"]> = new Set(["signedIn", "screenLocked"]);

/** The address to show while signed out: a dashboard page's address (a copied link) is kept, only same-site table paths; anything else is `fallback`. */
function keptAddress(fallback: string): string {
  const { pathname, search } = window.location;
  return pathname !== "/" && isAppPath(pathname) ? pathname + search : fallback;
}

interface HistoryEntry {
  hms?: number;
  load?: string;
}

/**
 * `seed`: the display-only session the server read from the verified cookie (R48, app/page.tsx). With it the app starts signed in, so the dashboard shell is part of the first
 * HTML and is hydrated, and the session is verified once more in the browser (below). Without it the ordinary start (restore, then sign-in) runs.
 */
export function AuthApp({ seed = null, panels = null, ended = null, noSession = false }: { seed?: Session | null; panels?: ShellPanels | null; ended?: "SESSION_REPLACED" | "SESSION_REVOKED" | "SESSION_EXPIRED" | null; noSession?: boolean } = {}) {
  // `ended` (no seed): the server found this browser's session over. A browser that had the dashboard open opens straight on "your session ended" and why
  // (signed in on another device, ended by an admin, expired), without asking the server again and without the dashboard outline; any other just signs in.
  const [endedHere] = useState(() => (ended !== null && seed === null && dashboardWasOpen() ? ended : null));
  const [state, dispatch] = useReducer(webReducer, seed, (s): PallavAuthState =>
    s ? { ...initialPallavAuthState, step: "signedIn", session: s } : endedHere ? { ...initialPallavAuthState, step: "sessionEnded", problem: endedHere } : initialPallavAuthState,
  );
  useEffect(() => {
    if (ended === null) return;
    // the ended session's remembered page, outline and address are not kept for the next sign-in
    lastViews.forgetAll();
    markDashboardOpen(false);
    if (endedHere && window.location.pathname !== SIGN_IN_PATH) window.history.replaceState(window.history.state, "", SIGN_IN_PATH);
  }, [ended, endedHere]);
  // True only for the dashboard that came from the server render: its first client render must equal the server HTML, so it restores the remembered page after hydration.
  const [seeded, setSeeded] = useState(seed !== null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // An emailed "forgot password" link opens /?reset=<token>: the token leaves the address bar at once and the new-password page shows first.
  const [resetToken, setResetToken] = useState<string | null>(() => (seed ? null : takeResetToken()));
  // A page reload keeps the person signed in: on start (real server only) the live session cookie is asked for the user (GET /auth/session, which does
  // not extend the idle window). Until it answers the page shows the empty sign-in frame, never a flash of the sign-in form. The mock keeps its session in the tab (sessionStorage) and restores it the same way.
  // A page the server already rendered from a verified session (R48 seed) has nothing to restore: it shows the dashboard and re-checks the session in the background.
  // `noSession` (sign-in speed, 18 Oct 2026): the server render saw no session cookie at all, so there is nothing to restore and the sign-in form shows at once.
  const [restoring, setRestoring] = useState(() => seed === null && ended === null && resetToken === null && !(noSession && apiMode() === "real") && (apiMode() === "real" || hasStoredMockSession()));
  // The dashboard's code downloads while the person types (it used to download only while a session was being restored), so it is ready when the sign-in answers.
  useEffect(() => {
    if (seed !== null) return;
    const load = () => void import("@/dashboards/shell").catch(() => undefined);
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (idle) idle(load);
    else setTimeout(load, 300);
  }, [seed]);
  // A server that stays unreachable after every try is NOT "sign in": the session cookie may be fine, so the person gets a "try again" page, never the form.
  const [unreachable, setUnreachable] = useState(false);
  const [restoreRun, setRestoreRun] = useState(0);
  useEffect(() => {
    if (!restoring) return;
    let live = true;
    // the dashboard's code downloads while the session is asked for, so the real shell is ready as soon as the answer arrives
    void import("@/dashboards/shell").catch(() => undefined);
    void restoreOutcome(authApi).then((found) => {
      if (!live) return;
      if (found.kind === "session") {
        dispatch({ type: "RESULT", result: { status: "signed_in", session: found.session }, now: Date.now() });
        // a screen locked before the reload stays locked
        if (found.session.locked) dispatch({ type: "SCREEN_LOCK" });
      }
      else if (found.kind === "over") {
        // The session ended between visits: forget the previous person's remembered page and dashboard outline (so the next visit starts as the sign-in page).
        // A page address left from that session (its record id included) is not kept for the next person either. A copied link opened in a browser
        // where no dashboard was open is kept, so it opens after sign-in.
        const stale = dashboardWasOpen();
        lastViews.forgetAll();
        markDashboardOpen(false);
        if (stale && window.location.pathname !== SIGN_IN_PATH) window.history.replaceState(window.history.state, "", SIGN_IN_PATH);
        // a dashboard was open here: say why it closed (signed in on another device, ended by an admin, expired) instead of a bare sign-in form
        if (stale) dispatch({ type: "SESSION_ENDED", code: found.code });
      }
      setUnreachable(found.kind === "unreachable");
      setRestoring(false);
    });
    return () => {
      live = false;
    };
    // runs on start and on every "try again"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreRun]);
  // A seeded start: the shell is already on screen; the session is verified in the background. A live session swaps the display-only seed for the full user,
  // an ended one (401) goes to sign-in, a server that cannot be reached keeps the shell (every screen then says so itself).
  // Not at mount (speed, 24 Oct 2026): the server verified the seed a moment ago, and this call only fills in e-mail, user name and visit, so it waits until the
  // browser is idle (2.5 s at the latest) and the first screen's own data request is on its way; two tries are enough. The display-only seed stands until then;
  // My profile reads /profile itself.
  useEffect(() => {
    if (!seed || apiMode() !== "real") return;
    let live = true;
    const cancel = deferIdle(() => {
      void restoreOutcome(authApi, { attempts: 2 }).then((found) => {
        if (!live) return;
        if (found.kind === "session") {
          dispatch({ type: "RESULT", result: { status: "signed_in", session: found.session }, now: Date.now() });
          if (found.session.locked) dispatch({ type: "SCREEN_LOCK" });
        } else if (found.kind === "over") dispatch({ type: "SESSION_ENDED", code: found.code });
      });
    }, 2500);
    return () => {
      live = false;
      cancel();
    };
    // once, on start
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [prefill, setPrefillState] = useState<Prefill | null>(null);
  const [idleWarningSeconds, setIdleWarningSeconds] = useState<number | null>(null);
  const online = useSyncExternalStore(subscribeOnline, getOnlineSnapshot, getOnlineServerSnapshot);
  const device = useMemo(() => webDevice(), []);
  const liveRef = useRef<HTMLDivElement>(null);

  // ---- Moving between steps ----

  const send = useCallback((event: WebEvent, opts?: { direction?: Direction; notice?: Notice }) => {
    const direction: Direction = opts?.direction ?? "forward";
    startTransition(() => {
      addTransitionType(direction);
      setNotice(opts?.notice ?? null);
      dispatch(event);
    });
  }, []);

  const setUsername = useCallback((username: string) => {
    dispatch({ type: "USERNAME_CHANGED", username });
  }, []);

  const setPrefill = useCallback((p: Omit<Prefill, "nonce">) => {
    // The username goes into the flow state, so Back and sign-out keep the latest one.
    dispatch({ type: "USERNAME_CHANGED", username: p.username });
    setPrefillState((old) => ({ ...p, nonce: (old?.nonce ?? 0) + 1 }));
  }, []);

  const announce = useCallback((text: string) => {
    const el = liveRef.current;
    if (!el) return;
    el.textContent = "";
    window.setTimeout(() => {
      el.textContent = text;
    }, 50);
  }, []);

  // ---- Browser history: every step is a history entry, so Back works (agreement section 9) ----

  const stateRef = useRef(state);
  // Entries from before a reload carry another load id, so their snapshots are never trusted.
  // crypto.randomUUID exists only on https or localhost; another PC opening the dev server by IP (http) must still load.
  const [loadId] = useState(() =>
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(""),
  );
  const seq = useRef({ current: 0, next: 1 });
  const snapshots = useRef(new Map<number, PallavAuthState>());
  const fromPop = useRef(false);
  const lastStep = useRef<PallavAuthState["step"] | null>(null);

  useEffect(() => {
    stateRef.current = state;
    const s = seq.current;
    const entry: HistoryEntry = { hms: s.current, load: loadId };
    const wasDashboard = lastStep.current !== null && DASHBOARD_STEPS.has(lastStep.current);
    if (DASHBOARD_STEPS.has(state.step)) {
      // Signed in (or locked): the dashboard owns the address bar and the history entries (decision 49: the URL decides).
      fromPop.current = false;
    } else if (wasDashboard) {
      // The session ended (sign-out, expiry): the sign-in page is at SIGN_IN_PATH ("/login"; "/" is the website), and the address of the last page is not kept for the next person.
      s.current = s.next++;
      window.history.replaceState({ hms: s.current, load: loadId }, "", SIGN_IN_PATH);
    } else if (lastStep.current === null || fromPop.current) {
      // First render, or the browser moved: keep the entry, fix the address bar. A page address (a copied link) stays while signing in, so the
      // dashboard opens that page afterwards when the person may see it; anything else becomes the sign-in page's address.
      // Only our own keys: Next.js adds its router state and keeps its URL in sync.
      window.history.replaceState(entry, "", keptAddress(urlFor(state)));
      fromPop.current = false;
    } else if (state.step !== lastStep.current) {
      s.current = s.next++;
      window.history.pushState({ hms: s.current, load: loadId }, "", keptAddress(urlFor(state)));
    }
    // Only steps Back may return to are kept; they hold no session, codes or link tokens.
    if (SAFE_STEPS.has(state.step)) snapshots.current.set(s.current, state);
    else snapshots.current.delete(s.current);
    lastStep.current = state.step;
  }, [state, loadId]);

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      // Signed in or locked: Back and Forward move between dashboard pages (RoleDashboard follows the address); nothing to do here.
      if (DASHBOARD_STEPS.has(stateRef.current.step)) return;
      const entry = (e.state ?? {}) as HistoryEntry;
      const ours = entry.load === loadId && typeof entry.hms === "number" ? entry.hms : null;
      const target = ours === null ? undefined : snapshots.current.get(ours);
      const current = stateRef.current;
      const s = seq.current;
      const decision = decidePop(current, target);

      if (decision.kind === "stay") {
        window.history.pushState({ hms: s.current, load: loadId }, "", urlFor(current));
        return;
      }
      const direction: Direction = ours !== null && ours > s.current ? "forward" : "back";
      s.current = ours ?? s.next++;
      if (decision.kind === "adopt" || (decision.kind === "restore" && decision.state === current)) {
        // Nothing to change on screen; this entry now stands for the current step.
        window.history.replaceState({ hms: s.current, load: loadId }, "", urlFor(current));
        if (SAFE_STEPS.has(current.step)) snapshots.current.set(s.current, current);
        return;
      }
      fromPop.current = true;
      if (decision.kind === "restore") send({ type: "RESTORE", state: decision.state }, { direction });
      else send({ type: "GO", step: "signIn" }, { direction });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [send, loadId]);

  // ---- Signed in: idle screen lock and session checks ----

  const signedIn = state.step === "signedIn";
  // Dev quick login (docs/UI.md): mock-only sessions marked devQuick get no idle lock and no periodic check.
  // The real server never sets devQuick and quickLoginAllowed() is false in real mode, so this is always false there.
  const quickSession = state.session?.devQuick === true && quickLoginAllowed();
  const idleTimers = useRef<{ warn?: number; lock?: number; tick?: number; lockAt: number }>({ lockAt: 0 });

  /** Starts (or restarts) the warning and lock timers. Only sets state from timer callbacks. */
  const armIdle = useCallback(() => {
    const t = idleTimers.current;
    window.clearTimeout(t.warn);
    window.clearTimeout(t.lock);
    window.clearInterval(t.tick);
    t.lockAt = Date.now() + SCREEN_LOCK_AFTER_MS;
    t.warn = window.setTimeout(() => {
      const left = () => Math.max(0, Math.ceil((t.lockAt - Date.now()) / 1000));
      setIdleWarningSeconds(left());
      t.tick = window.setInterval(() => setIdleWarningSeconds(left()), 1000);
    }, SCREEN_LOCK_AFTER_MS - SCREEN_LOCK_WARNING_MS);
    t.lock = window.setTimeout(() => {
      window.clearInterval(t.tick);
      setIdleWarningSeconds(null);
      send({ type: "SCREEN_LOCK" });
    }, SCREEN_LOCK_AFTER_MS);
  }, [send]);

  /** User activity or "Stay signed in": hide the warning and start over. */
  const resetIdle = useCallback(() => {
    setIdleWarningSeconds(null);
    armIdle();
  }, [armIdle]);

  useEffect(() => {
    if (!signedIn || quickSession) return;
    const t = idleTimers.current;
    armIdle();
    let last = 0;
    const onActivity = () => {
      // At most once a second; activity during the warning also counts as "still here".
      const now = Date.now();
      if (now - last < 1000) return;
      last = now;
      resetIdle();
    };
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, onActivity, { passive: true });
    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, onActivity);
      window.clearTimeout(t.warn);
      window.clearTimeout(t.lock);
      window.clearInterval(t.tick);
    };
  }, [signedIn, quickSession, armIdle, resetIdle]);

  // the lock is the server's (and this tab's), not only this screen's: a reload or another tab opens on it too. Locking twice is harmless.
  const screenLocked = state.step === "screenLocked";
  useEffect(() => {
    if (screenLocked) void authApi.lockScreen?.();
  }, [screenLocked]);

  const hasSession = state.session !== null;
  // The seed only stands while its session does; once it ends, the sign-in screens take over (adjusted while rendering, as React advises)
  // The seed describes only the dashboard the server rendered. Once that dashboard leaves the screen (lock screen, sign-out, session end), a later mount is an ordinary client mount.
  if (seeded && state.step !== "signedIn") setSeeded(false);
  // A screen lock and a page reload keep the dashboard page to return to (decision 49); any end of the session (sign-out, expiry, switch user) forgets it.
  // Only a session that really ENDS counts: on the first render there is no session yet because the restore (above) has not answered, and the page remembered
  // from before the reload must survive that.
  const hadSession = useRef(false);
  useEffect(() => {
    if (hasSession) hadSession.current = true;
    else if (hadSession.current) {
      hadSession.current = false;
      lastViews.forgetAll();
      // The next reload starts as the sign-in page again, not as a dashboard outline.
      markDashboardOpen(false);
    }
  }, [hasSession]);
  useEffect(() => {
    if (!hasSession) return;
    let cancelled = false;
    const check = async () => {
      const r = await authApi.getSession();
      if (cancelled || r.ok) return;
      if (r.error.code === "SESSION_REPLACED" || r.error.code === "SESSION_EXPIRED" || r.error.code === "SESSION_REVOKED") {
        send({ type: "SESSION_ENDED", code: r.error.code });
      }
      // Offline or server trouble: keep the user where they are and try again later.
    };
    // Quick-login sessions skip the periodic check; the demo panel's session-end buttons still work through hms:check-session.
    const timer = quickSession ? undefined : window.setInterval(check, SESSION_CHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("hms:check-session", onVisible);
    // Any call from the dashboard that the server answers with 401 ends the session here too (src/lib/api/client.ts).
    const offEnded = onSessionEnded((code) => {
      const known = code === "SESSION_REPLACED" || code === "SESSION_REVOKED" ? code : "SESSION_EXPIRED";
      send({ type: "SESSION_ENDED", code: known });
    });
    // a call answered 423 SCREEN_LOCKED (locked in another tab): this tab shows the lock screen too
    const offLocked = onScreenLocked(() => send({ type: "SCREEN_LOCK" }));
    return () => {
      offEnded();
      offLocked();
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("hms:check-session", onVisible);
    };
  }, [hasSession, quickSession, send]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      send,
      setUsername,
      api: authApi,
      device,
      online,
      notice,
      prefill,
      setPrefill,
      announce,
      // A warning left over from an earlier session never shows on the next one.
      idleWarningSeconds: signedIn ? idleWarningSeconds : null,
      staySignedIn: resetIdle,
      seeded,
      panels,
    }),
    [state, send, setUsername, device, online, notice, prefill, setPrefill, announce, signedIn, idleWarningSeconds, resetIdle, seeded, panels],
  );

  // A browser that had a dashboard open draws the real sidebar and top bar from the last shell snapshot while the session answers (never a blank rail).
  if (restoring) return dashboardWasOpen() ? <DashboardPlaceholder /> : <AuthShellSkeleton />;
  if (unreachable) {
    return (
      <AuthShellUnreachable
        onRetry={() => {
          setUnreachable(false);
          setRestoring(true);
          setRestoreRun((n) => n + 1);
        }}
      />
    );
  }
  return (
    <AuthContext.Provider value={value}>
      <div ref={liveRef} aria-live="polite" aria-atomic="true" className="sr-only" />
      {state.step === "signedIn" ? (
        // The dashboard that came from the server render is already on screen: no enter animation, or the whole page would slide (R48: no layout shift).
        seeded ? (
          <SignedInStep />
        ) : (
          <ViewTransition key="app" enter="hms-step-in-forward" exit="hms-step-out" default="none">
            <SignedInStep />
          </ViewTransition>
        )
      ) : (
        <ViewTransition key="auth" enter="hms-step-in-back" exit="hms-step-out" default="none">
          <AuthShell step={state.step}>
            {resetToken ? <ResetLinkStep token={resetToken} onClose={() => { clearResetToken(); setResetToken(null); }} /> : <StepView step={state.step} prefillNonce={prefill?.nonce ?? 0} />}
          </AuthShell>
        </ViewTransition>
      )}
    </AuthContext.Provider>
  );
}
