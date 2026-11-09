'use client';

// The one button implementation: Button (4 variants, 3 sizes), IconButton, Spinner, and the
// sign-in flow's PrimaryButton / SecondaryButton (thin wrappers over Button) and link buttons.
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';
import type { Tone } from '@shared/dashboards/common';
import { Icon } from './Icon';
import s from './kit.module.css';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onClick' | 'type' | 'disabled'> {
  label: string;
  /** Called on press (not used for type "submit": the form submits instead). */
  onPress?: () => void;
  /** Raw click handler, for the few cases that need the event. */
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerGhost';
  /** Icon name (18px, before the label). */
  icon?: string;
  /** Spinner + `busyLabel` (or the label), same width; presses are ignored while busy (no double submit). */
  busy?: boolean;
  busyLabel?: string;
  disabled?: boolean;
  /** sm 36 (44 hit area), md 44, lg 48 (sign-in and wizard actions). */
  size?: 'sm' | 'md' | 'lg';
  /** 'submit' inside a <form>; default 'button'. */
  type?: 'button' | 'submit';
  /** Stretch to the container width. */
  block?: boolean;
  /** Trailing arrow that nudges on hover (forward actions). */
  arrow?: boolean;
}

export function Spinner({ label }: { label?: string }) {
  return <span className={s.spinner} role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

export function Button({
  label,
  onPress,
  onClick,
  variant = 'primary',
  icon,
  busy = false,
  busyLabel,
  disabled = false,
  size = 'md',
  type = 'button',
  block = false,
  arrow = false,
  className,
  ...rest
}: ButtonProps) {
  const cls = [s.btn, s[variant], size === 'sm' ? s.btnSm : size === 'lg' ? s.btnLg : '', block ? s.btnBlock : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      {...rest}
      type={type}
      className={cls}
      disabled={disabled}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      onClick={(e) => {
        // A busy button keeps focus (a real `disabled` would drop it), so presses and the implicit submit are cancelled here.
        if (busy) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
        if (type === 'submit') return;
        onPress?.();
      }}
    >
      {busy ? <Spinner /> : icon ? <Icon name={icon} size={18} /> : null}
      <span>{busy ? (busyLabel ?? label) : label}</span>
      {arrow && !busy && <Icon name="arrowRight" size={16} className={s.btnArrow} />}
    </button>
  );
}

export interface IconButtonProps {
  icon: string;
  /** Accessible name (also the tooltip). */
  label: string;
  onPress: () => void;
  tone?: Tone;
  disabled?: boolean;
  /** Visual size of the icon (default 20). */
  size?: number;
}

export function IconButton({ icon, label, onPress, tone, disabled, size = 20 }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`${s.iconBtn} ${tone === 'danger' ? s.iconBtnDanger : ''}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onPress}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

// ---- Sign-in flow buttons: the same Button, 48px, full width ----

type FlowProps = Omit<ButtonProps, 'label' | 'variant' | 'size' | 'block'> & { children: string };

/** Gradient call to action: lift + one sheen sweep on hover, press scale, optional nudging arrow. */
export function PrimaryButton({ children, className, ...p }: FlowProps) {
  return <Button {...p} label={children} variant="primary" size="md" block className={[s.authBtn, className].filter(Boolean).join(' ')} />;
}

/** Outline button: surface fill, graphite text. */
export function SecondaryButton({ children, className, ...p }: FlowProps) {
  return <Button {...p} label={children} variant="secondary" size="md" block className={[s.authBtn, className].filter(Boolean).join(' ')} />;
}

type Base = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { children: ReactNode };

const linkBase =
  'hms-link inline-flex min-h-11 min-w-11 items-center justify-center whitespace-nowrap text-[12.5px] leading-[18px] font-semibold text-link';

/** Text link button: 12.5px semibold graphite, underline on hover/focus, 44px tall hit area. */
export function LinkButton({ children, className = '', type = 'button', chevron = false, ...rest }: Base & { chevron?: boolean }) {
  return (
    <button /* check-shared-ignore: the auth kit's own link-styled button */ type={type} {...rest} className={`${linkBase} ${className}`}>
      {/* The face carries the focus ring, so the ring hugs the text, not the 44px hit area. */}
      <span className="hms-link-face inline-flex items-center gap-1">
        {chevron && <Icon name="chevronLeft" size={14} className="shrink-0" />}
        <span>{children}</span>
      </span>
    </button>
  );
}

/** A real link (e.g. dev-only email links) that looks like LinkButton. */
export function TextLink({ children, className = '', ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a {...rest} className={`${linkBase} ${className}`}>
      <span className="hms-link-face inline-flex items-center gap-1">{children}</span>
    </a>
  );
}
