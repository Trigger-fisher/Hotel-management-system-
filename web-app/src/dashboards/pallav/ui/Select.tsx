'use client';

// A native dropdown in Bootstrap's `.form-select` (the one a PmsSelect draws as Tom Select is a separate piece). Props are the plain
// <select> props; `invalid` adds Bootstrap's red state. Replaces hand-written `<select className="form-select ...">`.
import type { ComponentPropsWithoutRef } from 'react';

export interface SelectProps extends ComponentPropsWithoutRef<'select'> {
  invalid?: boolean;
}

export function Select({ invalid = false, className = '', ...rest }: SelectProps) {
  // The portals' own `.pt-input` select keeps its look: Bootstrap's `.form-select` is added only to the dashboards' selects.
  const base = className.split(/\s+/).includes('pt-input') ? [] : ['form-select'];
  const classes = [...base, ...className.split(/\s+/).filter((c) => c && !base.includes(c)), ...(invalid ? ['is-invalid'] : [])].join(' ');
  return <select {...rest} className={classes} aria-invalid={invalid || rest['aria-invalid'] ? true : undefined} />;
}
