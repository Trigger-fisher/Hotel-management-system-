"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { copy, errorText } from "@shared/auth/copy";
import { newPasswordChecks } from "@shared/auth/validation";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

export type Tone = "danger" | "warning" | "info" | "success";

const toneClass: Record<Tone, string> = {
  danger: "border-note-error-border bg-note-error-bg text-note-error-fg",
  warning: "border-note-warning-border bg-note-warning-bg text-note-warning-fg",
  info: "border-note-info-border bg-note-info-bg text-note-info-fg",
  success: "border-note-success-border bg-note-success-bg text-note-success-fg",
};

const toneIcon: Record<Tone, IconName> = {
  danger: "error",
  warning: "warning",
  info: "info",
  success: "check_circle",
};

/**
 * Form-level message (Pallav note). Danger is announced at once (role=alert); others politely.
 * `focusOnShow` moves keyboard focus to it whenever its text changes (server errors).
 * No outer margin: callers pass it in `className`.
 */
export function Note({
  tone,
  title,
  children,
  focusOnShow = false,
  className = "",
}: {
  tone: Tone;
  title?: string;
  children: ReactNode;
  focusOnShow?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const text = typeof children === "string" ? children : null;
  useEffect(() => {
    if (focusOnShow) ref.current?.focus();
  }, [focusOnShow, text]);

  return (
    <div
      ref={ref}
      tabIndex={focusOnShow ? -1 : undefined}
      role={tone === "danger" ? "alert" : "status"}
      className={`hms-note flex items-start gap-[9px] rounded-field border px-3 py-2.5 text-[13px] leading-[1.45] ${toneClass[tone]} ${className}`}
    >
      <Icon name={toneIcon[tone]} size={15} className="mt-[2px] shrink-0" />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  );
}

/** Old name, same component. */
export const Banner = Note;

/** Shown at the very top of the card while the device has no internet. */
export function OfflineNote() {
  return (
    <Note tone="info" className="mb-4">
      {errorText.NETWORK_OFFLINE}
    </Note>
  );
}

/** Old name, same component. */
export const OfflineBanner = OfflineNote;

/** 48px graphite circle with a 24px line icon, above the title on result screens. */
export function StatusIcon({ name }: { name: IconName }) {
  return (
    <div aria-hidden="true" className="mb-4 flex size-12 items-center justify-center rounded-full bg-status text-status-ink">
      <Icon name={name} size={24} />
    </div>
  );
}

/** Uppercase step pill (e.g. "Step 2 of 2"), on its own line above the title. */
export function StepPill({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2.5 flex w-fit items-center rounded-full bg-pill px-[9px] py-[3px] text-[10.5px] leading-[14px] font-extrabold tracking-[0.07em] text-pill-ink uppercase">
      {children}
    </p>
  );
}

export function initials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const preset = size === 56 || size === 40;
  return (
    <div
      aria-hidden="true"
      // check-shared-ignore: the initials scale with the avatar's own size prop (a computed value, not a fixed size)
      style={preset ? undefined : { width: size, height: size, fontSize: Math.round(size * 0.36) }}
      className={`flex shrink-0 items-center justify-center rounded-full bg-status font-bold text-status-ink ${
        !preset ? "" : size === 56 ? "size-14 text-[20px]" : "size-10 text-[13px]"
      }`}
    >
      {initials(name)}
    </div>
  );
}

/** "Who" chip: shows who you are instead of asking again (identifier, masked email, name). */
export function WhoChip({ label, icon = "person", initials: tileText }: { label: string; icon?: IconName; initials?: string }) {
  return (
    <div className="flex h-12 min-w-0 items-center gap-2.5 rounded-field border border-chip-border bg-chip-bg pr-3 pl-1.5">
      <span
        aria-hidden="true"
        className="flex size-[30px] shrink-0 items-center justify-center rounded-[8px] bg-chip-tile text-chip-tile-ink"
      >
        {tileText ? <span className="text-[12px] leading-none font-extrabold">{tileText}</span> : <Icon name={icon} size={14} />}
      </span>
      <span title={label} className="min-w-0 truncate text-[14px] leading-5 font-bold text-ink">
        {label}
      </span>
    </div>
  );
}

/** Soft graphite hint box. No outer margin: callers pass it in `className`. */
export function Aside({
  icon = "info",
  id,
  className = "",
  children,
}: {
  icon?: IconName;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div id={id} className={`flex items-start gap-[9px] rounded-field bg-aside px-3 py-2.5 text-[12.5px] leading-[1.5] text-aside-ink ${className}`}>
      <Icon name={icon} size={14} className="mt-[2.5px] shrink-0 text-aside-icon" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Three stacked 13px state icons that cross-fade (no flicker when a rule flips). */
function StateIcon({ state }: { state: "unmet" | "met" | "bad" }) {
  const layer = "absolute inset-0 transition-opacity duration-200";
  return (
    <span aria-hidden="true" className="relative mt-[2.5px] size-[13px] shrink-0">
      <Icon name="radio_button_unchecked" size={13} className={`${layer} ${state === "unmet" ? "opacity-100" : "opacity-0"}`} />
      <Icon name="check_circle" size={13} className={`${layer} ${state === "met" ? "opacity-100" : "opacity-0"}`} />
      <Icon name="error" size={13} className={`${layer} ${state === "bad" ? "opacity-100" : "opacity-0"}`} />
    </span>
  );
}

const ruleTone = { unmet: "text-rule-unmet", met: "text-rule-met", bad: "text-rule-bad" } as const;

/**
 * Live password rules (all 7 from ui-shared), 2 columns, 1 under 400px. Met rules turn green;
 * with `showErrors` (after a failed save) unmet rules turn red. Colour transitions only, no shake.
 * Not a live region (too noisy per keystroke): each row ends with ": Done" / ": Not yet" for screen readers.
 */
export function PasswordRules({
  password,
  avoid,
  showErrors,
  id,
}: {
  password: string;
  avoid: string[];
  showErrors: boolean;
  id?: string;
}) {
  const checks = newPasswordChecks(password, avoid);
  return (
    <ul id={id} className="mt-2.5 grid grid-cols-2 gap-x-3.5 gap-y-[5px] max-[400px]:grid-cols-1">
      {checks.map((c) => {
        const state = c.ok ? "met" : showErrors ? "bad" : "unmet";
        return (
          <li
            key={c.id}
            aria-atomic="true"
            className={`flex items-start gap-1.5 text-[12.5px] leading-[18px] transition-colors duration-200 ${ruleTone[state]}`}
          >
            <StateIcon state={state} />
            <span className="min-w-0">
              {copy.newPassword.rules[c.id]}
              <span className="sr-only">: {c.ok ? copy.newPassword.ruleMet : copy.newPassword.ruleNotMet}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Old name: the rules without the after-save red state. */
export function PasswordChecklist(props: { password: string; avoid: string[]; id?: string }) {
  return <PasswordRules {...props} showErrors={false} />;
}

/**
 * "Passwords match" line under the confirm field. The text never changes (no layout shift):
 * only the colour and icon turn green when both fields are filled and equal.
 */
export function MatchLine({ password, confirm, id }: { password: string; confirm: string; id?: string }) {
  const match = password.length > 0 && password === confirm;
  return (
    <p
      id={id}
      className={`mt-2 flex items-start gap-1.5 text-[12.5px] leading-[18px] transition-colors duration-200 ${match ? "text-rule-met" : "text-rule-unmet"}`}
    >
      <StateIcon state={match ? "met" : "unmet"} />
      <span>
        {copy.newPassword.passwordsMatch}
        <span className="sr-only">: {match ? copy.newPassword.ruleMet : copy.newPassword.ruleNotMet}</span>
      </span>
    </p>
  );
}
