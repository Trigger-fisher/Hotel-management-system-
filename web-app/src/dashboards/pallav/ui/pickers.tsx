'use client';

// Pallav's date and select controls, the way pms-ui.js draws them: flatpickr (`d M Y`, `M Y`, `d M Y, H:i`, a Clear / Today footer) and Tom Select
// (searchable above 8 choices, menu drawn at the end of <body>). Both libraries are Pallav's own versions, kept in public/pallav/vendor/ and loaded
// the first time one of these controls is shown. Each control is a thin React wrapper: a screen keeps its own state and handlers.
import { useEffect, useRef, useState, type ReactNode } from 'react';

type FlatpickrInstance = {
  altInput: HTMLInputElement;
  calendarContainer: HTMLElement;
  setDate: (d: string | Date | null, trigger?: boolean) => void;
  set: (key: string, value: unknown) => void;
  clear: () => void;
  close: () => void;
  destroy: () => void;
};
type TomSelectInstance = { wrapper: HTMLElement; sync: () => void; setValue: (v: string, silent?: boolean) => void; destroy: () => void; disable: () => void; enable: () => void; isDisabled: boolean; getValue: () => string | string[] };

declare global {
  interface Window {
    flatpickr?: (el: HTMLElement, options: Record<string, unknown>) => FlatpickrInstance;
    monthSelectPlugin?: new (options: Record<string, unknown>) => unknown;
    TomSelect?: new (el: HTMLElement, options: Record<string, unknown>) => TomSelectInstance;
  }
}

const scripts = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  let p = scripts.get(src);
  if (!p) {
    p = new Promise<void>((resolve) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = () => resolve();
      s.onerror = () => resolve(); // a missing file leaves the native control
      document.head.appendChild(s);
    });
    scripts.set(src, p);
  }
  return p;
}

const VERSION = '1';
const loadDates = () => loadScript(`/pallav/vendor/flatpickr.min.js?v=${VERSION}`).then(() => loadScript(`/pallav/vendor/plugins-monthSelect-index.js?v=${VERSION}`));
const loadSelects = () => loadScript(`/pallav/vendor/js-tom-select.complete.min.js?v=${VERSION}`);

/** What a screen's handler receives: the same `e.target.value` as from a native input. */
export interface PickedValue {
  target: { value: string };
}

export interface PmsDateProps {
  /** `date` (2026-10-06), `month` (2026-10) or `datetime-local` (2026-10-06T14:30). */
  type?: 'date' | 'month' | 'datetime-local';
  value: string;
  onChange: (e: PickedValue) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
  placeholder?: string;
  'aria-label'?: string;
}

export function PmsDate({ type = 'date', value, onChange, min, max, disabled, required, id, className = 'form-control', placeholder, 'aria-label': ariaLabel }: PmsDateProps) {
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<FlatpickrInstance | null>(null);
  // Once flatpickr is up, the real input is a hidden one behind its display input. React 19 writes `type` back on EVERY update of an
  // <input> (ReactDOMInput updateInput), so with `type="date"` in the JSX each re-render (a new value, min or max) turned it back into a
  // visible native date box next to flatpickr's. The JSX therefore says `hidden` itself from then on.
  const [ready, setReady] = useState(false);
  // The value flatpickr holds (picked there or pushed from `value`). The hidden input's own value is not a guide: React's defaultValue
  // rewrites it.
  const shown = useRef(value);
  const handler = useRef(onChange);
  const latest = useRef({ value, min, max, disabled });
  useEffect(() => {
    handler.current = onChange;
    latest.current = { value, min, max, disabled };
  });

  useEffect(() => {
    let cancelled = false;
    let fp: FlatpickrInstance | null = null;
    void loadDates().then(() => {
      const el = input.current;
      if (cancelled || !el || !window.flatpickr) return;
      const isMonth = type === 'month';
      const withTime = type === 'datetime-local';
      const options: Record<string, unknown> = {
        altInput: true,
        allowInput: true,
        disableMobile: true,
        monthSelectorType: 'static',
        enableTime: withTime,
        time_24hr: true,
        dateFormat: isMonth ? 'Y-m' : withTime ? 'Y-m-d\\TH:i' : 'Y-m-d',
        altFormat: isMonth ? 'M Y' : withTime ? 'd M Y, H:i' : 'd M Y',
        defaultDate: latest.current.value || undefined,
        minDate: latest.current.min || null,
        maxDate: latest.current.max || null,
        onReady: (_: unknown, __: unknown, inst: FlatpickrInstance) => {
          const alt = inst.altInput;
          alt.classList.add('flatpickr-alt');
          alt.required = !!required;
          alt.disabled = !!latest.current.disabled;
          alt.setAttribute('inputmode', 'none');
          alt.setAttribute('autocomplete', 'off');
          alt.dataset.noAutofocus = 'true';
          if (ariaLabel) alt.setAttribute('aria-label', ariaLabel);
          // The label of the field (forms.tsx Field) points at this display box: it only exists now, after the Field mounted.
          if (!alt.id) alt.id = `${el.id || `fp-${Math.random().toString(36).slice(2, 8)}`}-alt`;
          // A label that names this box by the original input's id (`htmlFor`) follows it to the display box.
          const named = el.id ? document.querySelector(`label[for="${el.id}"]`) : null;
          if (named) {
            named.setAttribute('for', alt.id);
          } else if (!ariaLabel && placeholder) {
            alt.setAttribute('aria-label', placeholder);
          }
          let holder: HTMLElement | null = alt.parentElement;
          for (let depth = 0; holder && depth < 4; depth += 1, holder = holder.parentElement) {
            const label = holder.querySelector(':scope > label.form-label');
            if (label) {
              label.setAttribute('for', alt.id); // overrides what Field set while the box was still the plain input
              break;
            }
          }
          if (placeholder) alt.placeholder = placeholder;
        },
        onChange: (_: unknown, str: string) => {
          shown.current = str;
          handler.current({ target: { value: str } });
        },
      };
      shown.current = latest.current.value;
      if (isMonth && window.monthSelectPlugin) options.plugins = [new window.monthSelectPlugin({ shorthand: true, dateFormat: 'Y-m', altFormat: 'M Y' })];
      fp = window.flatpickr(el, options);
      const footer = document.createElement('div');
      footer.className = 'fp-footer';
      footer.innerHTML = `<button type="button" class="muted" data-act="clear">Clear</button><button type="button" data-act="today">${isMonth ? 'This month' : 'Today'}</button>`;
      footer.addEventListener('click', (e) => {
        const act = (e.target as HTMLElement).closest('button')?.dataset.act;
        if (act === 'clear') {
          fp?.clear();
          fp?.close();
        }
        if (act === 'today') {
          fp?.setDate(new Date(), true);
          fp?.close();
        }
      });
      fp.calendarContainer.appendChild(footer);
      picker.current = fp;
      setReady(true);
    });
    return () => {
      cancelled = true;
      picker.current = null;
      fp?.destroy();
      setReady(false);
    };
    // The picker is built once per control; value, min, max and disabled follow in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  useEffect(() => {
    const fp = picker.current;
    if (!fp) return;
    fp.set('minDate', min || null);
    fp.set('maxDate', max || null);
    fp.altInput.disabled = !!disabled;
    if (shown.current !== value) {
      shown.current = value;
      fp.setDate(value || null, false);
    }
  });

  // Until flatpickr has loaded (or if its file is missing) the native control is shown; then only flatpickr's display input.
  return (
    <div className={`date-wrap${type === 'month' ? ' month' : ''}`}>
      <input ref={input} type={ready ? 'hidden' : type} id={id} className={className} defaultValue={value} min={min} max={max} disabled={disabled} required={required} aria-label={ariaLabel} />
    </div>
  );
}

export interface PmsSelectProps {
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  children: ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
}

/** `<select class="form-select">` that Tom Select draws (a search box above 8 choices). The choices are plain `<option>` children. */
export function PmsSelect({ value, onChange, children, disabled, id, className = 'form-select', 'aria-label': ariaLabel }: PmsSelectProps) {
  const select = useRef<HTMLSelectElement>(null);
  const ts = useRef<TomSelectInstance | null>(null);

  useEffect(() => {
    let cancelled = false;
    let inst: TomSelectInstance | null = null;
    void loadSelects().then(() => {
      const el = select.current;
      if (cancelled || !el || !window.TomSelect) return;
      const searchable = el.options.length > 8;
      inst = new window.TomSelect(el, {
        create: false,
        allowEmptyOption: true,
        maxOptions: null,
        controlInput: searchable ? undefined : null,
        plugins: searchable ? ['dropdown_input'] : [],
        dropdownParent: 'body',
        render: { no_results: () => '<div class="no-results">No matches</div>' },
      });
      if (className.includes('form-select-sm')) inst.wrapper.classList.add('form-select-sm');
      if (el.disabled) inst.disable();
      ts.current = inst;
    });
    return () => {
      cancelled = true;
      ts.current = null;
      inst?.destroy();
    };
    // Built once per control; the choices and the value are re-read on every render below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React rewrote the options or the value: show them (Tom Select keeps its own copy).
  useEffect(() => {
    const inst = ts.current;
    if (!inst) return;
    inst.sync();
    if (inst.isDisabled !== !!disabled) {
      if (disabled) inst.disable();
      else inst.enable();
    }
  });

  return (
    <select ref={select} id={id} className={className} value={value} disabled={disabled} aria-label={ariaLabel} onChange={(e) => onChange({ target: { value: e.target.value } })}>
      {children}
    </select>
  );
}
