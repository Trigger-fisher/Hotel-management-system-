'use client';

// The early check of required fields (R46): before a form is sent to the server (a Save, or Continue in a step form), every field whose label carries the red star must have a
// value. An empty one gets Pallav's red border and a plain line under it ("Company name is required."), the first one takes the cursor, and nothing is sent. What was typed
// stays. The message goes away as soon as the person types or picks something. The server still checks everything and keeps its own 422 answers.
// It reads the rendered form (label.form-label with a .req star, and its control), so every form that follows Pallav's markup (Fld, Field, Bootstrap labels) is covered at once.

const MARK = 'data-req-message';
const FLAG = 'data-req-invalid';

/** Removes the messages and red borders this check added. */
export function clearMissingRequired(): void {
  if (typeof document === 'undefined') return;
  document.querySelectorAll(`[${MARK}]`).forEach((e) => e.remove());
  document.querySelectorAll(`[${FLAG}]`).forEach((e) => {
    e.classList.remove('is-invalid');
    e.removeAttribute(FLAG);
  });
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** Marks every empty required field inside `root`; returns true when all of them have a value. */
export function showMissingRequired(root: Element | null): boolean {
  if (typeof document === 'undefined' || !root) return true;
  clearMissingRequired();
  let first: Control | null = null;
  root.querySelectorAll('label.form-label').forEach((label) => {
    if (!label.querySelector('.req')) return;
    const id = (label as HTMLLabelElement).htmlFor;
    const box = label.parentElement;
    const control = ((id ? document.getElementById(id) : null) ?? box?.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea')) as Control | null;
    if (!control || !(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) || control.disabled || ('readOnly' in control && control.readOnly) || control.closest('[hidden]') || control.getClientRects().length === 0) return;
    if (typeof control.value !== 'string' || control.value.trim() !== '') return;
    const name = (label.textContent ?? '').replace('*', '').replace(/\s+/g, ' ').trim();
    control.classList.add('is-invalid');
    control.setAttribute(FLAG, '');
    const msg = document.createElement('div');
    msg.className = 'invalid-feedback d-block';
    msg.setAttribute('role', 'alert');
    msg.setAttribute(MARK, '');
    msg.textContent = `${name || 'This field'} is required.`;
    (control.closest('.input-group') ?? control).insertAdjacentElement('afterend', msg);
    const clear = () => {
      msg.remove();
      control.classList.remove('is-invalid');
      control.removeAttribute(FLAG);
    };
    control.addEventListener('input', clear, { once: true });
    control.addEventListener('change', clear, { once: true });
    if (!first) first = control;
  });
  const focus = first as Control | null;
  focus?.focus();
  return focus === null;
}
