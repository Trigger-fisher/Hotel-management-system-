'use client';

// Settings > Recycle bin, under the general list: the payroll bins (deleted staff, advances, bonus entries, exit records) for one payroll
// company. SuperAdmin only (server rule system.recycle), like the rest of the tab. Not a Pallav page: Pallav has no payroll bin.
import { useState } from 'react';
import { payrollCompanyStore } from '@shared/dashboards/payrollCore';
import { Bi, Button, SegTabs, Select } from '@/dashboards/pallav/ui';
import { errorText, useAsync } from '@/components/ui';
import type { ScreenProps } from '../../types';
import { payrollApi } from '../payrollCore/api';
import { StaffBin } from '../payrollCore/Staff';
import { payApi } from '../payrollPay/api';
import { PayBin } from '../payrollPay/PayBin';
import { SeparationBin } from '../payrollPay/Resignations';

import { tr } from '@/lib/i18n/language';
type Kind = 'staff' | 'advances' | 'bonus' | 'separations';

const TABS: { id: Kind; label: string; icon: string }[] = [
  { id: 'staff', label: 'Staff', icon: 'people' },
  { id: 'advances', label: 'Advances', icon: 'wallet2' },
  { id: 'bonus', label: 'Bonuses', icon: 'gift' },
  { id: 'separations', label: 'Separations', icon: 'box-arrow-right' },
];

export function PayrollBins({ navigate }: { navigate: ScreenProps['navigate'] }) {
  // Both lists: the pay screens take the short company ref, Staff takes the full row.
  const refs = useAsync(() => payApi.listCompanies(), []);
  const rows = useAsync(() => payrollApi.listCompanies(), []);
  const [picked, setPicked] = useState('');
  const [kind, setKind] = useState<Kind | null>('staff');

  const refList = refs.state.status === 'ready' ? refs.state.data : [];
  // Payroll answers only for an active company ("Select a company first."), so only those are offered.
  const rowList = rows.state.status === 'ready' ? rows.state.data.filter((c) => c.isActive) : [];
  const companyId = picked || rowList[0]?.id || '';
  const ref = refList.find((c) => c.id === companyId);
  const row = rowList.find((c) => c.id === companyId);
  const failed = refs.state.status === 'error' ? refs.state.error : rows.state.status === 'error' ? rows.state.error : null;

  // A breadcrumb link into payroll opens it on the company shown here.
  const go = (viewId: string) => {
    if (companyId) payrollCompanyStore.set(companyId);
    navigate(viewId);
  };
  // The bin's own "Back" (and its page crumb) closes the list; the tabs stay.
  const back = () => setKind(null);

  let body = null;
  if (!kind) body = <p className="text-muted small mb-0">{tr("Choose a list above.")}</p>;
  else if (ref && row) {
    if (kind === 'staff') body = <StaffBin key={`staff-${row.id}`} company={row} navigate={go} onBack={back} />;
    else if (kind === 'advances')
      body = (
        <PayBin
          key={`adv-${ref.id}`}
          company={ref}
          title={tr("Advance Management")}
          navigate={go}
          load={(q) => payApi.listAdvances(ref.id, q)}
          restore={(id) => payApi.restoreAdvance(ref.id, id)}
          purge={(id) => payApi.purgeAdvance(ref.id, id)}
          onBack={back}
        />
      );
    else if (kind === 'bonus')
      body = (
        <PayBin
          key={`bonus-${ref.id}`}
          company={ref}
          title={tr("Bonus & Incentive Management")}
          navigate={go}
          load={(q) => payApi.listBonus(ref.id, q)}
          restore={(id) => payApi.restoreBonus(ref.id, id)}
          purge={(id) => payApi.purgeBonus(ref.id, id)}
          onBack={back}
        />
      );
    else body = <SeparationBin key={`sep-${ref.id}`} company={ref} navigate={go} onBack={back} />;
  }

  return (
    <div className="st-card" style={{ marginTop: 16 }}>
      <div className="st-head">
        <div className="st-icon"><Bi name="people" /></div>
        <div>
          <h2 className="st-title">{tr("Payroll recycle bins")}</h2>
          <p className="st-about">{tr("Deleted staff, advances, bonus entries and exit records of one payroll company. Restore one, or delete it for ever.")}</p>
        </div>
      </div>

      {/* The card body, with .st-grid's padding. */}
      <div className="p-4" style={{ minWidth: 0 }}>
        {failed ? (
          <div className="d-flex align-items-center gap-2 mb-3">
            <span className="text-muted small me-auto">{errorText(failed)}</span>
            <Button variant="ghost" icon="arrow-clockwise" onClick={() => { refs.reload(); rows.reload(); }}>{tr("Try again")}</Button>
          </div>
        ) : null}

        <div className="d-flex flex-wrap align-items-end gap-3 mb-3">
          <div style={{ minWidth: 240 }}>
            <label className="form-label" htmlFor="rb_payroll_company">{tr("Payroll company")}</label>
            <Select id="rb_payroll_company" value={companyId} disabled={rowList.length === 0} onChange={(e) => setPicked(e.target.value)}>
              {rowList.length === 0 ? <option value="">{rows.state.status === 'ready' ? tr("No active payroll company") : tr("Loading…")}</option> : null}
              {rowList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <SegTabs tabs={TABS} active={kind ?? ''} onChange={(id) => setKind(id as Kind)} label={tr("Payroll recycle bins")} />
        </div>

        {body}
      </div>
    </div>
  );
}
