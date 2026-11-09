"use client";

import dynamic from "next/dynamic";
import { useContext, useEffect, useRef, useState } from "react";
import { copy, fill, productName, roleHome, roleLabel } from "@shared/auth/copy";
import { dashboardForRole } from "@shared/dashboards/nav";
import { apiMode } from "@/lib/api/mode";
import { signOutInBackground } from "@/lib/auth/signOut";
import { DashboardPlaceholder } from "../DashboardPlaceholder";
import { DirectDashboard } from "../directDashboard";
import { LinkButton, PrimaryButton, SecondaryButton, Avatar, StatusIcon, Spinner } from "@/components/ui";
import { useAuth } from "../AuthContext";
import { BrandMark } from "../AuthShell";
import { noteSignedOut } from "../AuthBanner";
import { DemoAccounts } from "../DemoAccounts";

// The role dashboards load on demand, so the sign-in screens stay small and a role only downloads its own code.
const RoleDashboard = dynamic(() => import("@/dashboards/shell").then((m) => m.RoleDashboard), {
  loading: () => <DashboardPlaceholder />,
});

/**
 * "You'll be locked in {seconds} s" as a modal alertdialog (WCAG 2.2.1), open while the idle
 * warning runs. Esc counts as "Stay signed in"; any other activity is handled by AuthApp.
 */
function IdleWarningDialog({ seconds, onStay }: { seconds: number | null; onStay(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = seconds !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const shown = seconds ?? 0;
  // Screen readers hear the countdown every 10 s, rounded down (never more time than is left).
  const spoken = Math.max(1, Math.floor(shown / 10) * 10);

  return (
    <dialog
      ref={ref}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="idle-warning-title"
      onCancel={(e) => {
        e.preventDefault();
        onStay();
      }}
      className="m-auto w-[calc(100%-32px)] max-w-[360px] rounded-card border border-dialog-border bg-dialog p-7 text-ink shadow-auth-card backdrop:bg-scrim"
    >
      <StatusIcon name="lock" />
      <h2 id="idle-warning-title" className="text-heading font-extrabold tracking-[-0.02em] text-balance text-ink">
        <span aria-hidden="true">{open ? fill(copy.screenLocked.warning, { seconds: shown }) : ""}</span>
        <span className="sr-only" aria-live="polite">
          {open ? fill(copy.screenLocked.warning, { seconds: spoken }) : ""}
        </span>
      </h2>
      <PrimaryButton className="mt-6" autoFocus onClick={onStay}>
        {copy.screenLocked.staySignedIn}
      </PrimaryButton>
    </dialog>
  );
}

/**
 * Step 16: where each role lands. Roles with a dashboard (dashboardForRole: guest, corporate, hotel)
 * open it; the other roles keep the placeholder landing page (agreement section 6) until theirs is built.
 */
export function SignedInStep() {
  const { state, send, api, announce, idleWarningSeconds, staySignedIn, seeded, panels } = useAuth();
  // A server-rendered page (R48) gets the dashboard straight, with no lazy placeholder in front of it; elsewhere it loads on demand.
  const direct = useContext(DirectDashboard);
  const [signingOut, setSigningOut] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const user = state.session?.user ?? null;
  const title = fill(copy.signedIn.title, { name: user?.displayName ?? "" });
  const hasDashboard = user !== null && user.role in dashboardForRole;

  // Placeholder landing only: tab title, live-region announcement, focus on the heading.
  // (A dashboard sets its own tab title.)
  useEffect(() => {
    if (hasDashboard) return;
    document.title = `${title} · ${productName}`;
    announce(title);
    titleRef.current?.focus({ preventScroll: true });
  }, [title, announce, hasDashboard]);

  async function signOut() {
    setSigningOut(true);
    if (apiMode() !== "mock") {
      // the real server: the sign-in page at once; the session is ended on the server in the background (lib/auth/signOut.ts)
      signOutInBackground();
      noteSignedOut();
      send({ type: "SIGNED_OUT" }, { direction: "back" });
      return;
    }
    try {
      await api.signOut();
    } catch {
      // Signed out locally either way.
    }
    noteSignedOut();
    send({ type: "SIGNED_OUT" }, { direction: "back" });
    // Mock only: the module mock stores are built once per page load (and a brand-new hotel empties them: common.ts setMockEmptyHotel),
    // so the next account starts from a clean page. Accounts made at runtime survive in sessionStorage. Real mode never reloads.
    // The reload starts at the sign-in page, so the next account does not open on the page (and record) the previous one was on ("/" is the website).
    if (apiMode() === "mock") window.location.replace("/login");
  }

  if (!user) return null;

  if (hasDashboard) {
    const dashboardProps = { user, urlSync: true, hydrating: seeded, panels: seeded ? panels : null, onSignOut: () => void signOut(), onLockScreen: () => send({ type: "SCREEN_LOCK" }) };
    return (
      <>
        {direct ? direct(dashboardProps) : <RoleDashboard {...dashboardProps} />}
        <IdleWarningDialog seconds={idleWarningSeconds} onStay={staySignedIn} />
      </>
    );
  }

  const place = user.hotel
    ? fill(copy.signedIn.placeAt, { hotel: user.hotel.name })
    : user.group
      ? fill(copy.signedIn.placeFor, { group: user.group.name })
      : "";
  const home = roleHome[user.role];

  return (
    <div className="min-h-dvh bg-app pt-2.5">
      {/* Glass app bar, 10px from the screen edges. 22px is the spec's app-bar radius (spec 7). */}
      <header className="sticky top-2.5 z-10 mx-2.5 rounded-[22px] border border-appbar-border bg-appbar shadow-soft backdrop-blur-[16px] backdrop-saturate-[1.7]">
        <div className="flex h-16 items-center justify-between gap-4 px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark />
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <span className="hidden truncate text-small font-semibold text-ink-2 sm:block">{user.displayName}</span>
            <Avatar name={user.displayName} size={40} />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[960px] px-4 pt-8 pb-10 sm:px-6 sm:pt-10">
        <h1
          ref={titleRef}
          tabIndex={-1}
          className="hms-focus-target text-[length:var(--hms-auth-title-phone)] leading-[var(--hms-auth-title-leading)] font-extrabold tracking-[-0.03em] text-balance break-words text-ink outline-none min-[481px]:text-[length:var(--hms-auth-title)]"
        >
          {title}
        </h1>
        <p className="mt-1.5 text-[13.5px] leading-[1.55] text-pretty break-words text-ink-muted">
          {fill(copy.signedIn.subtitle, { role: roleLabel[user.role], place })}
        </p>

        <section
          aria-labelledby="role-home-title"
          className="mt-6 rounded-panel border border-role-card-border bg-role-card p-6 shadow-soft sm:p-7"
        >
          <h2 id="role-home-title" className="text-body-lg font-bold tracking-[-0.01em] text-ink">
            {home.title}
          </h2>
          <p className="mt-1 text-[13.5px] leading-[1.55] text-ink-muted">{home.scope}</p>
          {/* border-dashed sets both the dashed style and the `dashed` role colour. */}
          <div className="mt-5 flex min-h-36 items-center justify-center rounded-field border border-dashed px-6 py-8 text-center text-small text-ink-muted">
            {copy.signedIn.placeholder}
          </div>
        </section>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <SecondaryButton className="sm:w-auto sm:px-6" disabled={signingOut} onClick={() => send({ type: "SCREEN_LOCK" })}>
            {copy.signedIn.lockNow}
          </SecondaryButton>
          <LinkButton
            className="w-full sm:w-auto sm:px-3"
            disabled={signingOut}
            aria-busy={signingOut || undefined}
            onClick={() => void signOut()}
          >
            {signingOut && <Spinner />}
            {signingOut ? copy.signedIn.signingOut : copy.signedIn.signOut}
          </LinkButton>
        </div>

        <div className="mx-auto mt-10 max-w-[440px]">
          <DemoAccounts />
        </div>
      </main>

      <IdleWarningDialog seconds={idleWarningSeconds} onStay={staySignedIn} />
    </div>
  );
}
