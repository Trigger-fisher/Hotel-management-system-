"use client";

// Dev-only helper under the card (agreement section 3). Never ships in a normal production build (gate in
// DemoAccounts.tsx, docs/UI.md) and renders only in mock mode, so its few English labels are hard-coded here on purpose.
// It sits on the graphite page, so it uses the brand-row glass look and on-brand text (not the card roles).

import { useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactNode } from "react";
import { roleLabel } from "@shared/auth/copy";
import { dashboardKindFor } from "@shared/dashboards/nav";
import { Icon } from "@/components/ui";
import type { MockModule } from "@/lib/api/mockLoader";
import {
  devQuickSignIn,
  getDevOffline,
  quickLoginAllowed,
  setDevOffline,
  simulateSessionEnd,
  subscribeOnline,
} from "@/lib/auth/api";
import { useAuth } from "./AuthContext";
import { noteSignedOut } from "./AuthBanner";


import { tr } from '@/lib/i18n/language';
/** Same frosted tile as the brand mark, so the panel reads as part of the graphite page. */
const glass: CSSProperties = {
  background: "var(--hms-auth-tile-fill)",
  borderColor: "var(--hms-auth-tile-border)",
};
const hairline: CSSProperties = { borderColor: "var(--hms-auth-tile-border)" };

// The global :focus-visible outline is graphite (invisible on this page), so the panel forces an on-brand one.
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-brand!";

// Text stays full on-brand white: lighter tints drop under 4.5:1 on the glass fill over the lighter graphite.
const rowButton =
  `flex min-h-11 w-full flex-col items-start rounded-field px-3 py-2 text-left text-small text-on-brand ${focusRing} ` +
  "transition-colors duration-150 hover:bg-on-brand/10 disabled:cursor-not-allowed disabled:opacity-50";

const smallButton =
  `hms-press inline-flex min-h-11 items-center justify-center rounded-field border px-4 text-small font-semibold ${focusRing} ` +
  "text-on-brand hover:bg-on-brand/10 disabled:cursor-not-allowed disabled:opacity-50";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h2 className="px-3 text-caption font-bold tracking-[0.08em] text-on-brand uppercase">{title}</h2>
      <div className="mt-1">{children}</div>
    </section>
  );
}

/** On-brand checkbox (the kit Checkbox uses card colours, unreadable on the graphite page). */
function GlassCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange(checked: boolean): void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-small text-on-brand">
      <span className="relative flex size-5 shrink-0 items-center justify-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className={`peer absolute inset-0 size-5 cursor-pointer appearance-none rounded-[6px] border-[1.5px] border-on-brand checked:bg-on-brand ${focusRing}`}
        />
        <Icon name="check" size={14} className="pointer-events-none relative text-graphite-800 opacity-0 peer-checked:opacity-100" />
      </span>
      <span>{label}</span>
    </label>
  );
}

/** The auth mock's demo accounts (ui-shared/auth-pallav/mock.ts): DemoAccounts.tsx loads them with the mocks (lib/api/mockLoader.ts). */
export type PallavDemo = Pick<MockModule, "PALLAV_DEMO_ACCOUNTS" | "PALLAV_DEMO_CODE" | "PALLAV_DEMO_PASSWORD" | "PALLAV_DEMO_TITLE" | "PALLAV_QUICK_USERS">;
type PallavQuickGroup = PallavDemo["PALLAV_QUICK_USERS"][number]["group"];

const QUICK_GROUPS: [PallavQuickGroup, string][] = [
  ["hotel", "Hotel"],
  ["portal", "Portal"],
  ["platform", "Platform console"],
  ["other", "Other"],
];

/** Event time for the flow (outside render: only called from the click handler). */
const clock = () => Date.now();

const LANDS_ON = { hotel: "Hotel dashboard", guest: "Guest Portal", corporate: "Company Portal", platform: "Platform console", group: "Group console" } as const;

/**
 * Dev quick login (docs/UI.md): one click opens any mock user's own dashboard. No password, no emailed code,
 * no first-password change; the session is marked devQuick, so AuthApp skips the idle lock and the periodic check.
 */
function QuickLogin({ demo }: { demo: PallavDemo }) {
  const { state, send, api } = useAuth();
  const [opening, setOpening] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function open(username: string) {
    setProblem(null);
    setOpening(username);
    if (state.session !== null) {
      await api.signOut(); // Offline or failing: the local state is cleared anyway below.
      send({ type: "SIGNED_OUT" }, { direction: "back" });
    }
    const r = await devQuickSignIn(username);
    setOpening(null);
    if (r.ok) send({ type: "RESULT", result: r.data, now: clock() });
    else setProblem(r.error.code === "NETWORK_OFFLINE" ? "Offline: untick “Simulate offline” first." : "Could not open that account.");
  }

  return (
    <details open className="group/quick mt-6 rounded-panel border text-on-brand backdrop-blur-md" style={glass}>
      <summary
        className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-panel px-4 py-2 text-small font-semibold text-on-brand [&::-webkit-details-marker]:hidden ${focusRing}`}
      >
        {tr("Quick login (mock only, one click)")}
        <Icon name="chevron_down" size={18} className="shrink-0 transition-transform duration-200 group-open/quick:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="border-t px-1 pb-4" style={hairline}>
        {problem && (
          <p role="status" className="mt-3 px-3 text-small font-semibold text-on-brand">
            {problem}
          </p>
        )}
        {QUICK_GROUPS.map(([group, title]) => {
          const people = demo.PALLAV_QUICK_USERS.filter((p) => p.group === group);
          if (people.length === 0) return null;
          return (
            <Section key={group} title={title}>
              <ul className="grid grid-cols-1 gap-1 min-[420px]:grid-cols-2">
                {people.map((p) => {
                  const kind = dashboardKindFor(p.role, true, p.username);
                  const lands = kind ? LANDS_ON[kind] : "Landing page";
                  return (
                    <li key={p.username}>
                      <button
                        type="button"
                        className={rowButton}
                        disabled={opening !== null}
                        aria-busy={opening === p.username || undefined}
                        onClick={() => void open(p.username)}
                      >
                        <span className="font-semibold">{roleLabel[p.role]}</span>
                        <span className="break-words">{p.displayName}</span>
                        <span className="text-caption break-words">
                          {opening === p.username ? tr("Opening…") : `${lands}${p.note ? ` · ${p.note}` : ""}`}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Section>
          );
        })}
      </div>
    </details>
  );
}

export function DemoPanel({ demo }: { demo: PallavDemo }) {
  // Gate (docs/UI.md): mock mode only. Real mode (?api=real) never renders the panel or the quick login.
  const [allowed] = useState(quickLoginAllowed);
  return allowed ? <DemoPanelBody demo={demo} /> : null;
}

function DemoPanelBody({ demo }: { demo: PallavDemo }) {
  const { state, send, api, setPrefill } = useAuth();
  const [leaving, setLeaving] = useState(false);
  const devOffline = useSyncExternalStore(subscribeOnline, getDevOffline, () => false);
  const hasSession = state.session !== null;

  /** Ends a live session first (GO signIn is not valid from signedIn / screenLocked). */
  async function leaveSession(): Promise<void> {
    if (!hasSession) return;
    setLeaving(true);
    await api.signOut(); // Offline or failing: the local state is cleared anyway below.
    setLeaving(false);
  }

  async function pickAccount(username: string) {
    setPrefill({ username, password: demo.PALLAV_DEMO_PASSWORD });
    if (hasSession) {
      await leaveSession();
      // the quick login above signs straight into another account, so only this path (back to the sign-in form) says "See you soon."
      noteSignedOut();
      send({ type: "SIGNED_OUT" }, { direction: "back" });
    } else if (state.step !== "signIn") {
      send({ type: "GO", step: "signIn" }, { direction: "back" });
    }
  }

  return (
    <>
    <QuickLogin demo={demo} />
    <details className="group mt-6 rounded-panel border text-on-brand backdrop-blur-md" style={glass}>
      <summary
        className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-panel px-4 py-2 text-small font-semibold text-on-brand [&::-webkit-details-marker]:hidden ${focusRing}`}
      >
        {demo.PALLAV_DEMO_TITLE}
        <Icon name="chevron_down" size={18} className="shrink-0 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" />
      </summary>

      <div className="border-t px-1 pb-4" style={hairline}>
        <p className="mt-3 px-3 text-small text-on-brand">
          {tr("Password:")} <code className="font-mono font-semibold">{demo.PALLAV_DEMO_PASSWORD}</code> {tr("· Emailed code (only for an account that switched it on in My Profile):")}{" "}
          <code className="font-mono font-semibold">{demo.PALLAV_DEMO_CODE}</code>
        </p>

        <Section title={tr("Usernames (fills the sign-in form)")}>
          <ul>
            {demo.PALLAV_DEMO_ACCOUNTS.map((a) => (
              <li key={a.username}>
                <button /* check-shared-ignore: a row of the dev-only demo accounts list */ type="button" className={rowButton} disabled={leaving} onClick={() => void pickAccount(a.username)}>
                  <span className="font-mono font-semibold break-all">{a.username}</span>
                  <span>{a.shows}</span>
                </button>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={tr("Test states")}>
          <div className="flex flex-col gap-2 px-3">
            <GlassCheckbox label={tr("Simulate offline")} checked={devOffline} onChange={setDevOffline} />
            {(
              [
                ["SESSION_REPLACED", "Simulate sign-in on another device"],
                ["SESSION_REVOKED", "Simulate admin changing my account"],
                ["SESSION_EXPIRED", "Simulate idle session expiry"],
              ] as const
            ).map(([code, label]) => (
              <button
                key={code}
                type="button"
                className={smallButton}
                style={hairline}
                disabled={!hasSession}
                onClick={() => {
                  simulateSessionEnd(code);
                  window.dispatchEvent(new Event("hms:check-session"));
                }}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className={smallButton}
              style={hairline}
              disabled={state.step !== "signedIn"}
              onClick={() => send({ type: "SCREEN_LOCK" })}
            >
              {tr("Lock screen now")}
            </button>
          </div>
        </Section>
      </div>
    </details>
    </>
  );
}
