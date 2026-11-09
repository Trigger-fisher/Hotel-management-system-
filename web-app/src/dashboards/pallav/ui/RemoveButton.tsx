'use client';

// The small "remove this row" button of a repeating form block (an installment, a bill part, an instruction, a contact person).
// `look="point"` is the round cross at the end of a row (`.sh-point-remove`); `look="person"` is the text button with a bin (`.co-person-remove`).
// The accessible name is required: the cross alone says nothing to a screen reader.
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { Bi } from '../Bi';

import { tr } from '@/lib/i18n/language';
export interface RemoveButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  'aria-label': string;
  look?: 'point' | 'person';
  /** The text beside the bin (look "person" only); default "Remove". */
  children?: ReactNode;
}

export function RemoveButton({ look = 'point', className = '', type = 'button', children, ...rest }: RemoveButtonProps) {
  const base = look === 'person' ? 'co-person-remove' : 'sh-point-remove';
  return (
    <button type={type} {...rest} className={`${base} ${className}`.trim()}>
      {look === 'person' ? <><Bi name="trash" /> {children ?? tr("Remove")}</> : <Bi name="x-lg" />}
    </button>
  );
}