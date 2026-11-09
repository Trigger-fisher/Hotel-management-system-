'use client';

// The small text actions next to a list or form: "Add another item" (`.co-add-more`), "Reset" the filters (`.bm-reset`) and the clear cross
// inside a search box (`.search-clear`, icon only, so it needs an `aria-label`). Replaces hand-written buttons with those classes.
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { Bi } from '../Bi';

const KIND = {
  add: { cls: 'co-add-more', icon: 'plus-circle' },
  reset: { cls: 'bm-reset', icon: 'arrow-counterclockwise' },
  clear: { cls: 'search-clear', icon: 'x-lg' },
} as const;

type TextActionBase = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  kind: keyof typeof KIND;
  /** Replaces the kind's icon. */
  icon?: string;
};
/** With text the button is named by it; with none (the clear cross) an `aria-label` is required. */
export type TextActionProps = TextActionBase & ({ children: ReactNode } | { children?: undefined; 'aria-label': string });
export function TextAction({ kind, icon, className = '', type = 'button', children, ...rest }: TextActionProps) {
  const k = KIND[kind];
  return (
    <button type={type} {...rest} className={`${k.cls} ${className}`.trim()}>
      <Bi name={icon ?? k.icon} />
      {children !== undefined && children !== null ? <> {children}</> : null}
    </button>
  );
}