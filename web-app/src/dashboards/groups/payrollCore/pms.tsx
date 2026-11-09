'use client';

// Pallav's payroll page layout, breadcrumbs, KPI and form-grid pieces (resources/views/payroll/layout.blade.php, partials/_breadcrumbs,
// _kpi). The list controls (search, sort, pager, empty state) live in "@/dashboards/pallav/ui" so every group shares them.
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Bi, PmsDate, FieldHint, RequiredMark, Button } from '@/dashboards/pallav/ui';
import { useLabelLink } from '@/dashboards/pallav/ui/forms';
import { clearMissingRequired, showMissingRequired } from '@/dashboards/pallav/ui/requiredCheck';

import { tr, trf } from '@/lib/i18n/language';
export { useTableView, Th, Pager, SearchField, EmptyState, type SortSpec, type TableView } from '@/dashboards/pallav/ui';

/* ------------------------------------------------------------------ page layout */

interface Crumb {
  label: string;
  /** Where the crumb goes; the last one has none. */
  onPress?: () => void;
  icon?: string;
}

/** `partials/_breadcrumbs.blade.php`: Back (to the nearest linked step above) and the trail. */
export function Crumbs({ trail }: { trail: Crumb[] }) {
  const last = trail.length - 1;
  if (last < 1) return null;
  const up = [...trail.slice(0, last)].reverse().find((c) => c.onPress);
  return (
    <nav className="crumbs" aria-label={tr("Breadcrumb")}>
      {up ? (
        <a
          className="crumbs-back"
          href="#"
          title={trf("Back to {0}", [up.label])}
          onClick={(e) => {
            e.preventDefault();
            up.onPress?.();
          }}
        >
          <Bi name="arrow-left" />
          <span>{tr("Back")}</span>
        </a>
      ) : null}
      <ol className="crumbs-trail">
        {trail.map((c, i) => (
          <li key={`${c.label}-${i}`} className={i > 0 && i < last ? 'crumbs-mid' : ''} aria-current={i === last ? 'page' : undefined}>
            {i < last && c.onPress ? (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  c.onPress?.();
                }}
              >
                {c.icon ? <Bi name={c.icon} /> : null}
                <span>{c.label}</span>
              </a>
            ) : (
              <>
                {c.icon ? <Bi name={c.icon} /> : null}
                <span>{c.label}</span>
              </>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * `payroll/layout.blade.php` (the part inside @section('content')): the page head (breadcrumb, intro, search + actions), the KPI row, an
 * optional toolbar, then the page. The page title and icon come from the menu (nav.ts pageTitle).
 */
export function PayLayout({
  trail,
  sub,
  search,
  actions,
  kpis,
  toolbar,
  children,
}: {
  trail?: Crumb[];
  sub?: ReactNode;
  search?: ReactNode;
  actions?: ReactNode;
  kpis?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      {/* the trail on its own line, full width, so it is never cut short by the page's buttons (MJ, 26 Oct 2026) */}
      {trail ? <Crumbs trail={trail} /> : null}
      <div className="page-head pay-head reveal">
        <div className="ph-text">
          {sub ? <p className="pms-sub">{sub}</p> : null}
        </div>
        <div className="sh-head-actions ph-actions">
          {search ? <div className="pay-toolbar">{search}</div> : null}
          {actions}
        </div>
      </div>
      {kpis ? <div className="kpi-grid pay-kpis">{kpis}</div> : null}
      {toolbar ? <div className="pay-toolbar reveal">{toolbar}</div> : null}
      <div className="reveal pay-page" style={{ minWidth: 0 }}>
        {children}
      </div>
    </>
  );
}

/** `partials/_kpi.blade.php`: one stat box. */
export function PayKpi({ icon, tone = 'month', label, value, chip, state }: { icon: string; tone?: 'month' | 'in' | 'due' | 'out'; label: string; value: ReactNode; chip?: string; state?: 'warn' | 'good' }) {
  return (
    // payroll/pages/*.blade.php: `<div class="kpi reveal [good|warn]">`.
    <div className={`kpi reveal ${state ?? ''}`.trim()}>
      <div className="kpi-top">
        <span className={`kpi-icon ${tone}`}>
          <Bi name={icon} />
        </span>
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-value">{value}</div>
      {chip ? (
        <div className="kpi-foot">
          <span className="kpi-chip">{chip}</span>
        </div>
      ) : null}
    </div>
  );
}

/** The initials Pallav puts in an avatar: first letters of the first two words. */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

/* ------------------------------------------------------------------ forms */

/** One `<div class="col-md-N">` of Pallav's form grid: label (with `.req` or `.opt`), the control, a hint and the error. */
export function Fld({
  md = 6,
  id,
  label,
  required,
  optional,
  hint,
  error,
  children,
}: {
  md?: number | 'auto';
  id?: string;
  label: ReactNode;
  required?: boolean;
  optional?: boolean;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const errId = useLabelLink(box, error, !!id);
  return (
    <div className={md === 12 ? 'col-12' : `col-md-${md}`} ref={box}>
      <label className="form-label" htmlFor={id}>
        {label}
        {required ? <RequiredMark /> : null}
        {optional ? <> <span className="opt">{tr("optional")}</span></> : null}
      </label>
      {children}
      {hint ? <FieldHint>{hint}</FieldHint> : null}
      {error ? (
        <div className="invalid-feedback d-block" role="alert" id={errId}>
          {error}
        </div>
      ) : null}
    </div>
  );
}

/** The step state of Pallav's `[data-wizard]` forms: Back / Continue move one step; a finished step can be re-opened from the header. */
export function useWizard(count: number) {
  const [index, setIndex] = useState(0);
  return {
    index,
    last: index === count - 1,
    // Continue stops on the step while a field marked required (the red star) is still empty, and says which one (R46: early validation, nothing typed is lost).
    next: () => {
      if (!stepIsFilled()) return;
      clearStepMessages();
      setIndex((i) => Math.min(i + 1, count - 1));
    },
    back: () => {
      clearStepMessages();
      setIndex((i) => Math.max(i - 1, 0));
    },
    goTo: (n: number) => {
      clearStepMessages();
      setIndex(n);
    },
  };
}

function clearStepMessages() {
  clearMissingRequired();
}

/** The step on screen of the open wizard: every required field must have a value before Continue (see ui/requiredCheck.ts). */
function stepIsFilled(): boolean {
  if (typeof document === 'undefined') return true;
  return showMissingRequired(document.querySelector('[role=dialog] .form-step.active') ?? document.querySelector('[data-wizard] .form-step.active'));
}

/**
 * pms.js wireWizards' Enter rule, for `onKeyDown` on the wizard: Enter on an earlier step goes to the next step (as Continue) instead
 * of submitting; in a textarea it stays a new line; on the last step it is left alone, so the form submits (Modal `onSubmit`).
 * Put the Continue and Save buttons under different `key`s: React must not turn the clicked Continue into the submit button.
 */
export function wizardEnter(wiz: { last: boolean; next: () => void }) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Enter' || e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'TEXTAREA') return;
    if (wiz.last) {
      // A browser submits on Enter only from a text-like input: a select (or a file box) on the last step saves too.
      if (target.tagName === 'SELECT' || (target instanceof HTMLInputElement && ['file', 'checkbox', 'radio'].includes(target.type))) {
        e.preventDefault();
        target.closest('form')?.requestSubmit();
      }
      return;
    }
    e.preventDefault();
    wiz.next();
  };
}

/** `.wizard-steps`: the numbered progress row above the steps (a ticked dot for steps behind you). */
export function WizardSteps({ names, index, onGoTo }: { names: string[]; index: number; onGoTo: (n: number) => void }) {
  return (
    <div className="wizard-steps">
      {names.map((name, i) => (
        <div
          key={name}
          className={`wz-step ${i === index ? 'current' : ''} ${i < index ? 'done' : ''}`}
          onClick={() => {
            if (i < index) onGoTo(i);
          }}
        >
          <span className="wz-dot">{i < index ? <Bi name="check-lg" /> : i + 1}</span>
          <span className="wz-name">{name}</span>
        </div>
      ))}
    </div>
  );
}

/** The numeric part of a record id (Laravel's `orderByDesc('id')` as a tie-break). */
export function idNum(id: string): number {
  const n = Number(String(id).replace(/\D/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Sort newest first by a date-like key, then by id descending (Pallav's `orderByDesc(date)->orderByDesc('id')`). */
export function newestFirst<T extends { id: string }>(rows: T[], key: (r: T) => string): T[] {
  return [...rows].sort((a, b) => key(b).localeCompare(key(a)) || idNum(b.id) - idNum(a.id));
}

/** Pallav's `PayrollContext::current()->servesMeals()`: only the food company bills meals. */
export function servesMeals(company: { name: string }): boolean {
  return /food/i.test(company.name);
}

/** A `<tr>` holding one full-width block (the "no records yet" and "no match" blocks of a `<tbody>`). */
export function EmptyRow({ cols, children }: { cols: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={cols}>{children}</td>
    </tr>
  );
}

/* ------------------------------------------------------------------ month navigation */

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-10" -> "Oct 2026" */
function shortMonth(m: string): string {
  const [y, mo] = m.split('-');
  return `${MONTH_NAMES[Number(mo) - 1] ?? ''} ${y}`;
}
function stepMonth(m: string, by: number): string {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y ?? 1970, (mo ?? 1) - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** `partials/_month-nav.blade.php`: previous, jump-to-month, next, capped at the current month. */
export function MonthNav({ month, last, onChange }: { month: string; last: string; onChange: (m: string) => void }) {
  const prev = stepMonth(month, -1);
  const next = stepMonth(month, 1);
  const canNext = next <= last;
  return (
    <div className="d-flex flex-wrap gap-2 align-items-center">
      <Button variant="outline" size="sm" icon="chevron-left" aria-label={tr("Previous month")} onClick={() => onChange(prev)}>{shortMonth(prev)}</Button>
      <form className="month-jump" onSubmit={(e) => e.preventDefault()}>
        <PmsDate type="month" className="form-control form-control-sm" aria-label={tr("Jump to month")} value={month} max={last} onChange={(e) => e.target.value && onChange(e.target.value)} />
      </form>
      {canNext ? (
        <Button variant="outline" size="sm" aria-label={tr("Next month")} onClick={() => onChange(next)}>{shortMonth(next)} <Bi name="chevron-right" /></Button>
      ) : (
        <Button size="sm" variant="ghost" disabled title={tr("The current month is as far forward as you can go")}>{shortMonth(next)} <Bi name="chevron-right" /></Button>
      )}
    </div>
  );
}
