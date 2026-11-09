"use client";

import { useEffect, useRef } from "react";
import type { FormEventHandler, ReactNode } from "react";
import { productName } from "@shared/auth/copy";
import { Note, OfflineNote, StatusIcon, StepPill, type IconName } from "@/components/ui";
import { useAuth } from "./AuthContext";

/**
 * The card every auth step sits in (Pallav frame, spec 09 §3). With `onSubmit` it renders a
 * <form>, so Enter submits. The offline note always comes first (agreement §0.2).
 */
export function AuthCard({
  children,
  onSubmit,
  busy,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  onSubmit?: FormEventHandler<HTMLFormElement>;
  busy?: boolean;
  "aria-label"?: string;
}) {
  const { online } = useAuth();
  const body = (
    <>
      {!online && <OfflineNote />}
      {children}
    </>
  );
  return onSubmit ? (
    <form
      noValidate
      aria-label={ariaLabel}
      aria-busy={busy || undefined}
      className="hms-auth-card"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(e);
      }}
    >
      {body}
    </form>
  ) : (
    <section aria-label={ariaLabel} aria-busy={busy || undefined} className="hms-auth-card">
      {body}
    </section>
  );
}

/**
 * Step pill, status icon (result screens only), title and lead line. Sets the tab title,
 * announces the step, and on status steps (`focusTitle`) moves focus to the title.
 */
export function StepHeader({
  title,
  lead,
  pill,
  icon,
  focusTitle = false,
}: {
  title: string;
  lead?: ReactNode;
  pill?: string;
  icon?: IconName;
  focusTitle?: boolean;
}) {
  const { announce } = useAuth();
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = `${title} · ${productName}`;
    announce(title);
    if (focusTitle) ref.current?.focus({ preventScroll: true });
  }, [title, focusTitle, announce]);

  return (
    <div className="mb-[22px]">
      {pill && <StepPill>{pill}</StepPill>}
      {icon && <StatusIcon name={icon} />}
      <h1
        ref={ref}
        tabIndex={-1}
        className="hms-focus-target text-[length:var(--hms-auth-title)] leading-[1.2] font-extrabold tracking-[-0.03em] text-balance break-words text-ink outline-hidden max-[480px]:text-[length:var(--hms-auth-title-phone)]"
      >
        {title}
      </h1>
      {lead && <div className="mt-1.5 text-[13.5px] leading-[1.55] text-pretty break-words text-ink-muted">{lead}</div>}
    </div>
  );
}

/** This step's own error, or a notice carried from the previous step (e.g. "That took too long…"). */
export function FormNote({ error, className = "mb-4" }: { error: string | null; className?: string }) {
  const { notice, announce } = useAuth();
  // A carried notice mounts with its text already in place, which polite regions skip; read it out.
  const noticeText = !error && notice && notice.tone !== "danger" ? notice.text : null;
  useEffect(() => {
    if (noticeText) announce(noticeText);
  }, [noticeText, announce]);
  if (error) {
    return (
      <Note tone="danger" focusOnShow className={className}>
        {error}
      </Note>
    );
  }
  if (notice) {
    return (
      <Note tone={notice.tone} className={className}>
        {notice.text}
      </Note>
    );
  }
  return null;
}

/** Old name, kept so existing screens keep compiling. */
export const FormBanner = FormNote;

/** Centred secondary actions under the primary button. */
export function CardActions({ children }: { children: ReactNode }) {
  return <div className="mt-2.5 flex flex-col items-center">{children}</div>;
}

/** Small centred print under the actions. */
export function FinePrint({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-center text-[12px] leading-[1.5] text-ink-muted">{children}</p>;
}

/** Card footer with a hairline above (e.g. "New here? …"). */
export function CardFooter({ children }: { children: ReactNode }) {
  return (
    <p className="mt-[22px] border-t border-hairline pt-4 text-center text-[12.5px] leading-[1.5] text-ink-muted">{children}</p>
  );
}
