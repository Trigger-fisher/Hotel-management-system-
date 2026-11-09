// The one place that says how a text control behaves: which keyboard it asks for, which autofill it allows,
// and how its error and hint are wired for screen readers. Used by the dashboard `TextInput` / `Field`
// and by the sign-in `TextField` / `PasswordField` / `CodeField`. Each keeps its own look.

export type InputKind = 'text' | 'number' | 'email' | 'phone' | 'password' | 'code' | 'recovery';

export interface InputAttrs {
  type: 'text' | 'email' | 'tel' | 'password';
  inputMode?: 'decimal' | 'tel' | 'email' | 'numeric' | 'text';
  autoComplete?: string;
  autoCapitalize?: 'none' | 'characters';
  autoCorrect?: 'off';
  spellCheck?: boolean;
  maxLength?: number;
}

/**
 * Type, keyboard and autofill for a kind of input. `code` is a one-time code (numeric keyboard, autofill),
 * `recovery` is a backup code (letters, upper case). A caller may still override any attribute.
 */
export function inputAttrs(kind: InputKind): InputAttrs {
  switch (kind) {
    case 'number':
      return { type: 'text', inputMode: 'decimal' };
    case 'email':
      return { type: 'email', inputMode: 'email', autoComplete: 'email' };
    case 'phone':
      return { type: 'tel', inputMode: 'tel', autoComplete: 'tel' };
    case 'password':
      return { type: 'password', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false };
    case 'code':
      return { type: 'text', inputMode: 'numeric', autoComplete: 'one-time-code', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false, maxLength: 120 };
    case 'recovery':
      return { type: 'text', inputMode: 'text', autoComplete: 'off', autoCapitalize: 'characters', autoCorrect: 'off', spellCheck: false, maxLength: 11 };
    default:
      return { type: 'text' };
  }
}

/**
 * Ids and flags that tie a control to its error and hint lines.
 * `describedBy` lists the error first, then the hint, then any extra ids (e.g. a Caps Lock warning).
 */
export function fieldAria({ id, hint, error, extra }: { id: string; hint?: boolean; error?: boolean; extra?: (string | undefined)[] }) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : undefined, hint ? hintId : undefined, ...(extra ?? [])].filter(Boolean).join(' ') || undefined;
  return { hintId, errorId, describedBy, invalid: error ? (true as const) : undefined };
}
