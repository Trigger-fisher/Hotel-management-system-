'use client';

import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Bi, EmptyState, Loaded, Button } from '@/dashboards/pallav/ui';
import { usePanelHeadSlot } from '@/dashboards/pallav';
import { payrollCompanyStore, payrollCoreCopy as copy, type PayrollCompanyRow } from '@shared/dashboards/payrollCore';
import { useAsync } from '@/components/ui';
import { payrollApi } from './api';
import { initials } from './pms';

import { tr } from '@/lib/i18n/language';
export function usePayrollCompanyId(): [string | null, (id: string | null) => void] {
  const id = useSyncExternalStore(payrollCompanyStore.subscribe, payrollCompanyStore.get, payrollCompanyStore.get);
  return [id, payrollCompanyStore.set];
}

/** True once a payroll company is chosen: Pallav shows the payroll rail only then (the shell reads this). */
export function usePayrollCompanyOpen(): boolean {
  return usePayrollCompanyId()[0] !== null;
}

/** Payroll works inside one company: until one is chosen, every payroll page asks for it (Pallav sends you to the Company Listing). */
export function CompanyGate({ companies, onPick }: { companies: PayrollCompanyRow[]; onPick: (id: string) => void }) {
  return (
    <div className="card">
      <EmptyState icon="buildings" title={copy.switcher.gateTitle} text={copy.switcher.gateBody}>
        <div className="d-flex flex-wrap justify-content-center gap-2 mt-3">
          {companies
            .filter((c) => c.isActive)
            .map((c) => (
              <Button key={c.id} onClick={() => onPick(c.id)}>{c.name} <Bi name="arrow-right-short" /></Button>
            ))}
        </div>
      </EmptyState>
    </div>
  );
}

/** `payroll/partials/_company-switch.blade.php`: where payroll is working, and the way to every other company. Lives in the second panel's head. */
export function CompanySwitch({ companies, current, onPick, onListing }: { companies: PayrollCompanyRow[]; current: PayrollCompanyRow | undefined; onPick: (id: string) => void; onListing: () => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const active = companies.filter((c) => c.isActive);
  const shown = active.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div ref={ref} className={`company-switch ${current ? '' : 'is-empty'} ${open ? 'open' : ''}`} id="companySwitch">
      {/* check-shared-ignore: the company switcher is a bespoke dropdown trigger (company-switch-btn), not a Button */}
      <button type="button" className="company-switch-btn" aria-haspopup="listbox" aria-expanded={open} title={current?.name ?? 'Choose a company'} onClick={() => setOpen((o) => !o)}>
        <span className="cs-mark">{current ? initials(current.name) : <Bi name="buildings" />}</span>
        <span className="cs-text">
          <span className="cs-hint">{current ? tr("Current company") : tr("Payroll")}</span>
          <span className="cs-name">{current?.name ?? tr("Choose a company")}</span>
        </span>
        <Bi name="chevron-expand" className="cs-caret" />
      </button>
      <div className="company-menu" role="listbox">
        <a
          className="cm-listing"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setOpen(false);
            onListing();
          }}
        >
          <span className="cm-listing-icon">
            <Bi name="grid-3x3-gap" />
          </span>
          <span className="cm-listing-text">
            <span className="cm-listing-title">{tr("Company Listing")}</span>
            <span className="cm-listing-sub">{tr("Add, edit or open any company")}</span>
          </span>
        </a>
        {active.length ? (
          <>
            <div className="cm-divider">
              <span>{tr("Switch to")}</span>
            </div>
            {active.length > 6 ? (
              <div className="cm-search">
                <Bi name="search" />
                <input type="text" placeholder={tr("Find a company…")} aria-label={tr("Find a company")} value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            ) : null}
            <div className="cm-list">
              {shown.map((c) => (
                <a
                  key={c.id}
                  className={`cm-item ${c.id === current?.id ? 'selected' : ''}`}
                  href="#"
                  role="option"
                  aria-selected={c.id === current?.id}
                  onClick={(e) => {
                    e.preventDefault();
                    setOpen(false);
                    onPick(c.id);
                  }}
                >
                  <span className="cm-mark">{initials(c.name)}</span>
                  <span>{c.name}</span>
                  {c.id === current?.id ? <Bi name="check-lg" className="cm-check" /> : null}
                </a>
              ))}
              {shown.length === 0 ? <div className="cm-empty">{tr("No company matches that name.")}</div> : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Frame for every payroll screen: the company-switch card in the second panel's head, then the screen body once a company is picked
 * (Pallav "payroll.company" middleware sends you to the listing otherwise).
 */
export function PayrollPage(props: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  onBack?: () => void;
  /** Opens the Company Listing from the switch card; every payroll screen passes its own `navigate`. */
  navigate?: (viewId: string) => void;
  children: (company: PayrollCompanyRow) => ReactNode;
}) {
  const [companyId, setCompanyId] = usePayrollCompanyId();
  const { state, reload } = useAsync(() => payrollApi.listCompanies(), []);
  const slot = usePanelHeadSlot();
  const companies = state.status === 'ready' ? state.data : [];
  const current = companies.find((c) => c.id === companyId && c.isActive);
  return (
    <>
      {slot && companies.length ? createPortal(<CompanySwitch companies={companies} current={current} onPick={setCompanyId} onListing={() => props.navigate?.('hotel.payroll.home')} />, slot) : null}
      <Loaded state={state} onRetry={reload}>
        {(list) => {
          const picked = list.find((c) => c.id === companyId && c.isActive);
          // Keyed by company: a switch starts the screen afresh, so no row of the previous company stays on screen.
          return picked ? <Fragment key={picked.id}>{props.children(picked)}</Fragment> : <CompanyGate companies={list} onPick={setCompanyId} />;
        }}
      </Loaded>
    </>
  );
}
