"use client";

import { useEffect, useState, ViewTransition } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { pallavCopyByLanguage } from "@shared/auth-pallav/copy.lang";
import { authWordsCopyByLanguage } from "@shared/auth/copy.lang";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { BrandLogo } from "@/components/BrandLogo";
import { useCopy } from "@/lib/i18n/language";
import type { PallavAuthStep } from "@shared/auth-pallav";
import { PrimaryButton } from "@/components/ui";
import { AppShellSkeleton } from "@/components/ui/AppShellSkeleton";
import { useAuth } from "./AuthContext";
import { AuthBanner, BannerOverride, bannerPageFor, clearSignedOutNote, peekSignedOutNote, type BannerPage } from "./AuthBanner";
import { DemoAccounts } from "./DemoAccounts";

import { tr } from '@/lib/i18n/language';
/** The full brand logo (components/BrandLogo.tsx): the day file, or the night file when the device is in dark mode. */
export function BrandMark({ size = "md" }: { size?: "md" | "lg" }) {
  return <BrandLogo size={size} />;
}

/** The page behind the frame: one seamless glass page (decision 69; .hms-glass in globals.css hides the old rings). Never remounts between steps. */
function AuthPage() {
  return (
    <div aria-hidden="true" className="hms-auth-page pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <span className="hms-ring hms-ring-1" />
      <span className="hms-ring hms-ring-2" />
    </div>
  );
}

/** The maker's mark (MJ, 26 Oct 2026): "Engineered by ∞ ELPHINIX", then "Rise beyond limits". Elphinix's infinity mark keeps its own brand colours (globals.css). */
function Collaboration() {
  const p = useCopy(authWordsCopyByLanguage).partner;
  return (
    <div className="hms-collab">
      <p className="hms-collab-pill" role="img" aria-label={p.label}>
        <span aria-hidden="true" className="hms-collab-by">
          {p.by}
        </span>
        <svg aria-hidden="true" className="hms-collab-mark" viewBox="0 0 48 24" focusable="false">
          <defs>
            <linearGradient id="hms-elx-ink" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" className="hms-elx-s1" />
              <stop offset="0.38" className="hms-elx-s2" />
              <stop offset="0.7" className="hms-elx-s3" />
              <stop offset="1" className="hms-elx-s4" />
            </linearGradient>
          </defs>
          <path pathLength={100} d="M24 12C21 8.2 18.4 4 13 4a8 8 0 0 0 0 16c5.4 0 8-4.2 11-8s5.6-8 11-8a8 8 0 0 1 0 16c-5.4 0-8-4.2-11-8z" />
          <path pathLength={100} d="M24 12c-2.6-3.3-4.9-6.2-9.6-6.2a6.2 6.2 0 0 0 0 12.4c4.7 0 7-2.9 9.6-6.2s4.9-6.2 9.6-6.2a6.2 6.2 0 0 1 0 12.4c-4.7 0-7-2.9-9.6-6.2z" />
        </svg>
        <span aria-hidden="true" className="hms-collab-name">
          {p.name}
        </span>
      </p>
      <p className="hms-collab-line hms-collab-tag">{p.tagline}</p>
    </div>
  );
}

/** Banner on the left (a header on phones), then the column with the card, all on ONE page (.hms-glass, globals.css, decision 69). */
function AuthFrame({ page, children, ...rest }: { page: BannerPage; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={`hms-glass hms-auth-layout relative isolate ${rest.className ?? ""}`}>
      <AuthPage />
      <AuthBanner page={page} />
      <div className="hms-auth-main px-4 py-10 min-[481px]:items-center max-[480px]:py-7">{children}</div>
    </div>
  );
}

/**
 * One page for every auth step (spec 09 §0): page, banner, card frame and copyright stay;
 * only the card content and the banner's words change. The column rises once on first load.
 */
export function AuthShell({ step, children }: { step: Exclude<PallavAuthStep, "signedIn">; children: ReactNode }) {
  const { notice } = useAuth();
  const [override, setOverride] = useState<BannerPage | null>(null);
  // Sign in right after a sign-out button: "See you soon." until the person leaves the sign-in screen. Decided while rendering (a fresh mount after the
  // dashboard, or the lock screen's step change), so the sign-in words never flash; the note is cleared once shown.
  const [signedOut, setSignedOut] = useState(() => step === "signIn" && peekSignedOutNote());
  const [shownStep, setShownStep] = useState(step);
  if (shownStep !== step) {
    setShownStep(step);
    setSignedOut(step === "signIn" && peekSignedOutNote());
  }
  useEffect(() => {
    if (step === "signIn") clearSignedOutNote();
  }, [step]);
  // MJ, 5 Nov 2026: the sign-in screens are always light, whatever the device says; night is a signed-in person's own choice (the lock screen keeps it)
  useEffect(() => {
    if (step !== "screenLocked") document.documentElement.dataset.theme = "light";
  }, [step]);
  // Back on sign in after a new password was saved from the emailed link: "All set".
  const changed = step === "signIn" && notice?.tone === "success" && [pallavCopyByLanguage.en, pallavCopyByLanguage.hi, pallavCopyByLanguage.gu].some((w) => w?.resetLink.changed === notice.text);
  const page = override ?? (changed ? "passwordChanged" : signedOut && step === "signIn" ? "signedOut" : bannerPageFor(step));
  return (
    <AuthFrame page={page}>
      <main className="hms-rise w-full max-w-[var(--hms-auth-card-max)]">
        {/* The sign-in page has no user menu, so the one shared language switch sits here, above the card (MJ, 3 Nov 2026). */}
        <LanguageSwitch variant="page" />
        {/* One shared name: the card morphs between steps (height eases); content slides and fades. */}
        <ViewTransition
          key={step}
          name="hms-auth-card"
          share={{ forward: "hms-step-forward", back: "hms-step-back", default: "none" }}
          default="none"
        >
          <BannerOverride value={setOverride}>{children}</BannerOverride>
        </ViewTransition>
        {/* MJ, 26 Oct 2026: the copyright and "Visit our website" line is gone; the collaboration lockup closes the column. */}
        <Collaboration />
        <DemoAccounts />
      </main>
    </AuthFrame>
  );
}

/** The start-up check could not reach the server after every try: the session may be fine, so the sign-in form is NOT shown; the person can try again. */
export function AuthShellUnreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <AuthFrame page="signIn">
      <main className="w-full max-w-[var(--hms-auth-card-max)]">
        <div className="hms-auth-card" role="alert">
          <h1 className="text-[20px] font-extrabold">{tr("We could not reach the server")}</h1>
          <p className="mt-2 text-[14px]">{tr("Your sign-in is kept. Check the connection and try again; you do not need to sign in again.")}</p>
          <PrimaryButton type="button" className="mt-6" onClick={onRetry}>
            {tr("Try again")}
          </PrimaryButton>
        </div>
      </main>
    </AuthFrame>
  );
}

/** Server placeholder while the client app loads: the same page, banner and an empty card. */
export function AuthShellSkeleton() {
  return (
    <>
      <AuthFrame page="signIn" className="hms-sk-auth" aria-busy="true">
        <div className="w-full max-w-[var(--hms-auth-card-max)]">
          <div className="hms-auth-card h-[420px]" />
        </div>
      </AuthFrame>
      {/* A browser that had a dashboard open sees the dashboard outline instead (globals.css picks by <html data-shell>): a reload never flashes graphite. */}
      <AppShellSkeleton />
    </>
  );
}
