"use client";

import { createContext, useContext, useLayoutEffect } from "react";
import { copy } from "@shared/auth/copy";
import type { PallavAuthStep } from "@shared/auth-pallav";
import { authWordsCopyByLanguage } from "@shared/auth/copy.lang";
import { useCopy } from "@/lib/i18n/language";
import { BrandMark } from "./AuthShell";

import { tr } from '@/lib/i18n/language';
export type BannerPage = keyof typeof copy.banner.pages;

/** The banner page for each auth step. */
const STEP_PAGE: Record<Exclude<PallavAuthStep, "signedIn">, BannerPage> = {
  signIn: "signIn",
  emailCode: "emailCode",
  changePassword: "welcome",
  forgotPassword: "forgotPassword",
  resetPassword: "newPassword",
  resetDone: "passwordChanged",
  locked: "locked",
  blocked: "blocked",
  sessionEnded: "signedOut",
  screenLocked: "screenLocked",
};

export function bannerPageFor(step: Exclude<PallavAuthStep, "signedIn">): BannerPage {
  return STEP_PAGE[step];
}

// A plain sign-out (not a session that ended) sets this right before SIGNED_OUT; the next sign-in screen shows "See you soon." once and clears it.
let signedOutNote = false;

/** Called by every sign-out button (dashboard, lock screen, demo panel) just before it sends SIGNED_OUT. Never by the session-ended path. */
export function noteSignedOut(): void {
  signedOutNote = true;
}

/** Whether a sign-out button was just pressed (read while rendering; it does not clear the note). */
export function peekSignedOutNote(): boolean {
  return signedOutNote;
}

/** Clears the note once the sign-in screen has shown it. */
export function clearSignedOutNote(): void {
  signedOutNote = false;
}

/** A step that shows a second state inside one step (the "check your inbox" card, the emailed reset link) names its own banner page while it is on screen. */
export const BannerOverride = createContext<(page: BannerPage | null) => void>(() => undefined);

/** Sets the banner page while `page` is not null; before paint, so the banner never flashes the step's default words. A null page touches nothing. */
export function useBannerPage(page: BannerPage | null): void {
  const set = useContext(BannerOverride);
  useLayoutEffect(() => {
    if (page === null) return;
    set(page);
    return () => set(null);
  }, [page, set]);
}

/**
 * The graphite brand panel beside the sign-in card (MJ 2026-10-18, option 1). Decoration and words only: no links, no form, no heading (the card keeps the page's
 * one h1). From 768 px it is the left column (about 40 % from 1024 px); below 768 px it is a short header with the logo and the headline only.
 */
export function AuthBanner({ page, pills = page === "signIn" }: { page: BannerPage; pills?: boolean }) {
  const bw = useCopy(authWordsCopyByLanguage).banner;
  const words: { headline: string; line?: string } = bw.pages[page];
  return (
    <aside aria-label={bw.label} className="hms-auth-banner">
      <span aria-hidden="true" className="hms-brand-pattern pointer-events-none absolute inset-0" />
      <div className="relative flex items-center gap-3">
        <BrandMark size="lg" />
      </div>
      {/* A new key per page: the words fade in when the step changes. */}
      <div key={page} className="hms-fade-in relative hms-auth-banner-words">
        <p className="hms-auth-banner-headline">
          {/* one sentence per line, so a narrow column never leaves a lone word ("Every") above the rest of its sentence */}
          {words.headline.split(/(?<=[.।!?])\s+/).map((s) => (
            <span key={s} className="block">
              {s}
            </span>
          ))}
        </p>
        {words.line && <p className="hms-auth-banner-line">{words.line}</p>}
      </div>
      {pills ? (
        <ul className="hms-auth-banner-pills relative" aria-label={tr("Features")}>
          {bw.pills.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : (
        <span className="hms-auth-banner-pills" aria-hidden="true" />
      )}
    </aside>
  );
}
