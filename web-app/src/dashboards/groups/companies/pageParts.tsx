'use client';

// The page frame of the company screens: Pallav's `.page-head reveal` (intro on the left, search and actions on the right), the KPI row, then the page.
// The page title and icon come from the menu (nav.ts pageTitle).
import type { ReactNode } from 'react';

export function Page({
  sub,
  headActions,
  kpis,
  grid = true,
  headClass = '',
  children,
}: {
  sub?: ReactNode;
  headActions?: ReactNode;
  kpis?: ReactNode;
  /** false: the KPI row is `.kpi-grid` without `.pay-kpis`. */
  grid?: boolean;
  /** Extra class on `.page-head` (company_ledger/show: `cl-head`). */
  headClass?: string;
  children: ReactNode;
}) {
  return (
    <>
      <div className={`page-head ${headClass ? `${headClass} ` : ''}reveal`}>
        <div>{sub ? <p className="pms-sub">{sub}</p> : null}</div>
        {headActions}
      </div>
      {kpis ? <div className={`kpi-grid ${grid ? 'pay-kpis' : ''}`}>{kpis}</div> : null}
      {children}
    </>
  );
}
