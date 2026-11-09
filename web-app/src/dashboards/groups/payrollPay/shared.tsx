'use client';

import { Fragment, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePanelHeadSlot } from '@/dashboards/pallav';
import { EmptyState as PmsEmpty, Loaded } from '@/dashboards/pallav/ui';
import { CompanyGate, CompanySwitch, usePayrollCompanyId } from '../payrollCore/shared';
import { dashErrorText, type DashError } from '@shared/dashboards/common';
import { isPayrollAdmin, payErrorText, payrollPayCopy as copy, type PayrollCompanyRef } from '@shared/dashboards/payrollPay';
import { useAsync } from '@/components/ui';
import { payrollApi } from '../payrollCore/api';
import { payApi } from './api';

/** Friendly text for a failed call: the form message the mock gave, else the shared text. */
export function failText(error: DashError): string {
  return payErrorText(error, dashErrorText);
}

/** The name of the company that sells the staff meals (Pallav Food in the live data), for the meals wording. */
export function useFoodCompanyName(): string {
  const { state } = useAsync(() => payApi.listCompanies(), []);
  const food = state.status === 'ready' ? state.data.find((c) => c.providesFood) : undefined;
  return food?.name ?? 'the food business';
}

/**
 * Frame for every pay screen: the company-switch card in the second panel's head (the same one and the same choice as the payroll core
 * screens, as in Pallav), then the screen for that company. Pass `navigate` so the card can open the Company Listing.
 */
export function PayPage(props: {
  title?: string;
  subtitle?: string;
  actions?: (company: PayrollCompanyRef) => ReactNode;
  adminOnly?: boolean;
  role: string;
  navigate?: (viewId: string) => void;
  children: (company: PayrollCompanyRef) => ReactNode;
}) {
  const [coreId, setCoreId] = usePayrollCompanyId();
  // The two lists run in parallel; after the first payroll screen (or the shell's prefetch, dashboards/prefetch.ts) they come from the 20 s memory of GET answers.
  const { state, reload } = useAsync(() => payApi.listCompanies(), []);
  const rows = useAsync(() => payrollApi.listCompanies(), []);
  const slot = usePanelHeadSlot();
  if (props.adminOnly && !isPayrollAdmin(props.role)) {
    return (
      <div className="card">
        <PmsEmpty icon="lock" title={copy.adminOnly.title} text={copy.adminOnly.body} />
      </div>
    );
  }
  const companies = state.status === 'ready' ? state.data : [];
  const switchRows = rows.state.status === 'ready' ? rows.state.data : [];
  const current = companies.find((c) => c.id === coreId);
  // The screen is keyed by company: a switch starts it afresh, so no row of the previous company stays on screen.
  return (
    <>
      {slot && switchRows.length
        ? createPortal(<CompanySwitch companies={switchRows} current={switchRows.find((c) => c.id === coreId && c.isActive)} onPick={setCoreId} onListing={() => props.navigate?.('hotel.payroll.home')} />, slot)
        : null}
      <Loaded state={state} onRetry={reload}>
        {() => (current ? <Fragment key={current.id}>{props.children(current)}</Fragment> : <CompanyGate companies={switchRows} onPick={setCoreId} />)}
      </Loaded>
    </>
  );
}
