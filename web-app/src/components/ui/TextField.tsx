"use client";

import { useId, useState } from "react";
import type { InputHTMLAttributes, KeyboardEvent, ReactNode, Ref } from "react";
import { authWordsCopyByLanguage } from "@shared/auth/copy.lang";
import { useCopy } from "@/lib/i18n/language";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import { fieldAria, inputAttrs } from "./inputProps";

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label: string;
  hint?: string;
  /** Error text under the input; also marks the input invalid. */
  error?: string | null;
  /** 14px line icon inside the input on the left (person, lock, mail, shield, key). */
  leadingIcon?: IconName;
  /** Right side of the label row, baseline aligned (e.g. "Forgot password?"). Comes after the input in tab order. */
  labelAction?: ReactNode;
  /** Extra content under the input (e.g. PasswordRules, MatchLine). */
  below?: ReactNode;
  /** Content inside the input, on the right (e.g. the reveal button). */
  trailing?: ReactNode;
  inputRef?: Ref<HTMLInputElement>;
  inputClassName?: string;
  /** "code" = 56px one-time-code box; "recovery" = same box sized so 11 characters fit at 320px. */
  size?: "default" | "code" | "recovery";
  /** Extra id(s) for aria-describedby, e.g. the Caps Lock warning while it shows. */
  describedByExtra?: string;
}

/**
 * A line that eases its height open/closed (CSS grid 0fr -> 1fr) instead of jumping.
 * Hidden lines are visibility:hidden, so they are not read or reachable.
 */
function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className="hms-collapse col-span-full" data-open={open}>
      <div>{children}</div>
    </div>
  );
}

/** Keeps the last non-empty text so a line can fade/collapse out with its words still in it. */
function useLastText(text: string | null | undefined): string {
  const [last, setLast] = useState(text ?? "");
  if (text && text !== last) setLast(text);
  return text || last;
}

const sizeClass: Record<NonNullable<TextFieldProps["size"]>, string> = {
  // Pallav: 42px field, 14px text; 16px on phones so iOS does not zoom on focus (unavoidable phone adaptation).
  default: "h-[42px] text-[14px] leading-5 max-[480px]:text-[16px]",
  code: "h-14 text-center font-mono text-[26px] font-bold leading-8 tabular-nums tracking-[12px] indent-[12px]",
  recovery: "h-14 text-center font-mono text-[18px] font-bold leading-6 tabular-nums tracking-[4px] indent-[4px]",
};

/** Label row, optional hint, 48px input with optional icons, error line that eases in (spec 09 section 5). */
export function TextField({
  label,
  hint,
  error,
  leadingIcon,
  labelAction,
  below,
  trailing,
  inputRef,
  inputClassName = "",
  size = "default",
  describedByExtra,
  id,
  className = "",
  "aria-describedby": callerDescribedBy,
  ...input
}: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? `f${autoId}`;
  const shownHint = useLastText(hint);
  const shownError = useLastText(error);
  // Merge, never replace: error, hint, extra (Caps Lock), then whatever the caller adds.
  const { hintId, errorId, describedBy, invalid } = fieldAria({ id: inputId, hint: Boolean(hint), error: Boolean(error), extra: [describedByExtra, callerDescribedBy] });
  const centred = size !== "default";

  const pad = [
    leadingIcon ? "pl-9" : "pl-3.5",
    trailing ? "pr-10" : centred && leadingIcon ? "pr-9" : "pr-3.5",
  ].join(" ");

  return (
    // Grid so the label action sits on the label row but comes after the input in the DOM (tab order).
    <div className={`grid grid-cols-[minmax(0,1fr)_auto] ${className}`}>
      <label
        htmlFor={inputId}
        className="col-start-1 row-start-1 mb-1.5 min-w-0 self-baseline text-[13px] font-semibold leading-[18px] tracking-[-0.004em] text-ink-2"
      >
        {label}
      </label>
      <Collapse open={Boolean(hint)}>
        <p id={hintId} className="pb-1.5 text-[12px] leading-4 text-ink-muted">
          {shownHint}
        </p>
      </Collapse>
      <div className="relative col-span-full">
        <input
          {...input}
          id={inputId}
          ref={inputRef}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className={`hms-field peer block w-full rounded-field border border-input bg-inset text-ink placeholder:text-ink-muted ${sizeClass[size]} ${pad} ${inputClassName}`}
        />
        {leadingIcon && (
          <Icon
            name={leadingIcon}
            size={14}
            className="hms-field-icon pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-field-icon"
          />
        )}
        {trailing && <div className="absolute inset-y-0 right-0 flex items-center">{trailing}</div>}
      </div>
      {labelAction && (
        <div className="col-start-2 row-start-1 -my-3 ml-3 flex justify-end self-baseline">{labelAction}</div>
      )}
      <Collapse open={Boolean(error)}>
        <p id={errorId} className="flex items-start gap-1.5 pt-1.5 text-[12.5px] leading-[18px] text-note-error-fg">
          <Icon name="error" size={14} className="mt-0.5 shrink-0" />
          <span>{shownError}</span>
        </p>
      </Collapse>
      {below && <div className="col-span-full min-w-0">{below}</div>}
    </div>
  );
}

/** Password with a lock icon, an eye / eye-off reveal button and (optionally) a Caps Lock warning. */
export function PasswordField({
  capsLockHint = false,
  leadingIcon = "lock",
  describedByExtra,
  below,
  ...props
}: Omit<TextFieldProps, "type" | "trailing"> & { capsLockHint?: boolean }) {
  const words = useCopy(authWordsCopyByLanguage);
  const [visible, setVisible] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const autoId = useId();
  const inputId = props.id ?? `pw${autoId}`;
  const capsId = `${inputId}-caps`;
  const capsShown = capsLockHint && capsOn;

  const checkCaps = (e: KeyboardEvent<HTMLInputElement>) => {
    if (capsLockHint) setCapsOn(e.getModifierState("CapsLock"));
  };

  return (
    <TextField
      {...props}
      id={inputId}
      leadingIcon={leadingIcon}
      describedByExtra={[capsShown ? capsId : undefined, describedByExtra].filter(Boolean).join(" ") || undefined}
      {...inputAttrs("password")}
      type={visible ? "text" : "password"}
      onKeyDown={(e) => {
        checkCaps(e);
        props.onKeyDown?.(e);
      }}
      onKeyUp={(e) => {
        checkCaps(e);
        props.onKeyUp?.(e);
      }}
      onBlur={(e) => {
        setCapsOn(false);
        props.onBlur?.(e);
      }}
      trailing={
        // 44x44 hit area, 30x30 visual face.
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? words.common.hidePassword : words.common.showPassword}
          aria-controls={inputId}
          className="hms-reveal flex size-11 items-center justify-center"
        >
          <span className="hms-reveal-face flex size-[30px] items-center justify-center rounded-[8px] text-field-icon">
            <Icon name={visible ? "eye_off" : "eye"} size={16} />
          </span>
        </button>
      }
      below={
        <>
          {capsLockHint && (
            <>
              {/* Visual line: eases open, read through aria-describedby while it shows. */}
              <div className="hms-collapse" data-open={capsShown} aria-hidden="true">
                <div>
                  <p id={capsId} className="flex items-center gap-1.5 pt-1.5 text-[12.5px] leading-[18px] font-medium text-note-warning-fg">
                    <Icon name="warning" size={14} className="shrink-0" />
                    {words.capsLock}
                  </p>
                </div>
              </div>
              {/* Announcement: a polite live region that only has text while Caps Lock is on. */}
              <span role="status" className="sr-only">
                {capsShown ? words.capsLock : ""}
              </span>
            </>
          )}
          {below}
        </>
      }
    />
  );
}

/**
 * ONE input for a code (not 6 boxes): paste and autofill friendly (GOV.UK pattern).
 * `kind="totp"` = numeric keyboard and one-time-code autofill; `kind="recovery"` = letters.
 */
export function CodeField({
  kind = "totp",
  leadingIcon,
  ...props
}: Omit<TextFieldProps, "type" | "size"> & { kind?: "totp" | "recovery" }) {
  const totp = kind === "totp";
  return (
    <TextField
      {...inputAttrs(totp ? "code" : "recovery")}
      {...props}
      leadingIcon={leadingIcon ?? (totp ? "shield" : "key")}
      size={totp ? "code" : "recovery"}
    />
  );
}
