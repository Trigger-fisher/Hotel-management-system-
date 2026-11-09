'use client';

// Staff meals (hotel.payroll.meals): one card per person with Start / Stop, then the month's meals bill. The price page is MealPrice.tsx.
import { useMemo, useState } from 'react';
import { formatDate, formatINR } from '@shared/dashboards/format';
import { type MealPeriod, type MealStaffRow, type MealsOverview, type PayrollCompanyRef } from '@shared/dashboards/payrollPay';
import { Bi, DetailCard, DetailList, Dropdown, FilterBar, Modal, PmsDate, SearchField, wordsOf, FieldHint, RequiredMark, Alert, Button, Table, MayEdit, type DetailTone } from '@/dashboards/pallav/ui';
import { HomeStats } from '../overview/HomeJobs';
import { useSubmit, useToast } from '@/components/ui';
import type { ScreenProps } from '../../types';
import { EmptyState, Fld, MonthNav, PayLayout, initials } from '../payrollCore/pms';
import { payApi } from './api';
import { PayPage, failText, useFoodCompanyName } from './shared';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';

import { tr, trf } from '@/lib/i18n/language';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthTitle = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;

/** hotel.payroll.meals */
export function Meals({ user, navigate }: ScreenProps) {
  return <PayPage role={user.role} navigate={navigate}>{(company) => <Body company={company} navigate={navigate} />}</PayPage>;
}

type Dialogs = { kind: 'start'; row: MealStaffRow } | { kind: 'stop'; row: MealStaffRow; period: MealPeriod } | null;
type Tab = '' | 'on' | 'off';

function Body({ company, navigate }: { company: PayrollCompanyRef; navigate: ScreenProps['navigate'] }) {
  const toast = useToast();
  const PAYEE = useFoodCompanyName();
  const [period, setPeriod] = useState<string | undefined>(undefined);
  const [version, setVersion] = useState(0);
  const meals = useLoaded(() => payApi.getMeals(company.id, period), [company.id, period, version]);
  const data: MealsOverview | null = meals.data;
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [tab, setTab] = useState<Tab>('');
  const reload = () => setVersion((n) => n + 1);

  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  const staff = useMemo(() => data?.staff ?? [], [data]);
  const searched = words.length ? staff.filter((s) => words.every((w) => `${s.employee.name} ${s.employee.code} ${s.employee.designation ?? ''}`.toLowerCase().includes(w))) : staff;

  if (!data) return <Wait error={meals.error} onRetry={meals.reload} />;
  const d = data;
  const owed = !company.providesFood;
  const rate = d.currentPricePaise;
  const onMeals = staff.filter((s) => s.onMealsToday).length;
  const shown = tab === '' ? searched : searched.filter((s) => s.onMealsToday === (tab === 'on'));
  const hasBill = d.bill.length > 0;
  const ongoing = (r: MealStaffRow) => r.periods.find((p) => !p.endsOn);
  const current = (r: MealStaffRow) => r.periods.find((p) => p.startsOn <= d.today && (!p.endsOn || p.endsOn >= d.today));
  const firstDay = (r: MealStaffRow) => (r.employee.joiningDate > `${d.firstOpenMonth}-01` ? r.employee.joiningDate : `${d.firstOpenMonth}-01`);
  const daysInMonth = new Date(Number(d.period.slice(0, 4)), Number(d.period.slice(5, 7)), 0).getDate();
  const codeOf = new Map(staff.map((s) => [s.employee.id, s.employee.code]));
  const billOf = new Map(d.bill.map((b) => [b.employeeId, b]));
  const closed = (p: MealPeriod) => d.closedThrough !== null && p.startsOn.slice(0, 7) <= d.closedThrough;
  const monthPrices = (() => {
    const asc = [...d.prices].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    const start = `${d.period}-01`;
    const carried = asc.filter((p) => p.effectiveFrom <= start).pop();
    return [...(carried ? [carried] : []), ...asc.filter((p) => p.effectiveFrom > start && p.effectiveFrom.slice(0, 7) === d.period)];
  })();

  async function startToday(r: MealStaffRow) {
    setBusy(r.employee.id);
    const res = await payApi.startMeals(company.id, r.employee.id, { startsOn: d.today, endsOn: '' });
    setBusy(null);
    if (!res.ok) {
      toast.show({ tone: 'error', text: failText(res.error) });
      return;
    }
    reload();
    toast.show({
      tone: 'success',
      text: trf('Meals started for {0} from today.', [r.employee.name]),
      action: { label: 'Undo', onClick: () => void payApi.deleteMealPeriod(company.id, res.data.id).then((x) => { if (!x.ok) toast.show({ tone: 'error', text: failText(x.error) }); reload(); }) },
    });
  }

  async function removeRecord(r: MealStaffRow, p: MealPeriod) {
    setBusy(p.id);
    const res = await payApi.deleteMealPeriod(company.id, p.id);
    setBusy(null);
    if (!res.ok) {
      toast.show({ tone: 'error', text: failText(res.error) });
      return;
    }
    reload();
    toast.show({
      tone: 'success',
      text: trf('Meal record of {0} removed.', [r.employee.name]),
      action: { label: 'Undo', onClick: () => void payApi.startMeals(company.id, r.employee.id, { startsOn: p.startsOn, endsOn: p.endsOn ?? '' }).then((x) => { if (!x.ok) toast.show({ tone: 'error', text: failText(x.error) }); reload(); }) },
    });
  }

  const status = (r: MealStaffRow): { value: string; sub: string; tone: DetailTone } => {
    const cur = current(r);
    const last = [...r.periods].sort((a, b) => b.startsOn.localeCompare(a.startsOn))[0];
    if (cur) return { value: tr('On meals'), sub: cur.endsOn ? trf('{0} to {1}', [formatDate(cur.startsOn), formatDate(cur.endsOn)]) : trf('Since {0}', [formatDate(cur.startsOn)]), tone: 'ok' };
    if (last) return { value: tr('Stopped'), sub: last.endsOn ? trf('Last day {0}', [formatDate(last.endsOn)]) : trf('From {0}', [formatDate(last.startsOn)]), tone: 'muted' };
    return { value: tr('Not on meals'), sub: '', tone: 'muted' };
  };

  return (
    <PayLayout
      trail={[{ label: 'Payroll', icon: 'people', onPress: () => navigate('hotel.payroll.home') }, { label: company.name, onPress: () => navigate('hotel.payroll.dashboard') }, { label: 'Staff meals' }]}
      sub={owed ? trf('{0} pays {1} for its staff meals. Nothing here comes out of anyone\'s salary.', [company.name, PAYEE]) : trf('Meals for {0}\'s own staff. Nothing here comes out of anyone\'s salary.', [company.name])}
      search={staff.length > 0 ? <SearchField bare value={typed} onChange={setTyped} placeholder={tr('Search name, ID, designation…')} label={tr('Search staff')} /> : undefined}
      actions={
        <>
          {company.providesFood ? <Button variant="outline" icon="tag" onClick={() => navigate('hotel.payroll.mealPrice')}>{tr('Meal price')}</Button> : null}
          {d.billFinal ? <Button variant="outline" icon="bar-chart" onClick={() => navigate('hotel.payroll.reports')}>{tr('Monthly report')}</Button> : null}
        </>
      }
    >
      <StaleNote error={meals.error} onRetry={meals.reload} />
      <div className="ha-stack">
        {rate === null ? (
          <Alert tone="warning" icon="exclamation-triangle">
            {company.providesFood ? (
              <>
                {tr('No meal price yet, so nothing can be counted.')}{' '}
                <a href="#" className="fw-semibold" onClick={(e) => { e.preventDefault(); navigate('hotel.payroll.mealPrice'); }}>{tr('Set the price')}</a>
              </>
            ) : (
              trf('{0} has not set a meal price yet, so nothing can be counted. It is set on the Meal price page of {0}.', [PAYEE])
            )}
          </Alert>
        ) : null}

        <HomeStats
          stats={[
            { id: 'price', label: tr('Price a person'), value: rate ?? 0, format: (n) => (rate === null ? tr('Not set') : formatINR(Math.round(n))), note: rate === null ? tr('Nothing is counted yet') : trf('A month, set by {0}', [PAYEE]) },
            { id: 'on', label: tr('On meals today'), value: onMeals, format: (n) => String(Math.round(n)), note: trf('of {0} on the payroll', [staff.filter((s) => s.employee.isActive).length]) },
            { id: 'off', label: tr('Not on meals'), value: staff.filter((s) => s.employee.isActive).length - onMeals, format: (n) => String(Math.round(n)), note: tr('Active staff today') },
{ id: 'bill', label: monthTitle(d.period), value: d.billTotalPaise, format: (n) => formatINR(Math.round(n)), note: !hasBill ? tr('Nothing to count') : !d.billFinal ? tr('So far, not final') : owed ? trf('To pay {0}', [PAYEE]) : tr('Cost of staff meals') },
          ]}
        />

        {staff.length > 0 ? (
          <FilterBar
            tabs={[
              { id: '', label: tr('All'), icon: 'collection', count: searched.length },
              { id: 'on', label: tr('On meals'), dot: 'settled', count: searched.filter((s) => s.onMealsToday).length },
              { id: 'off', label: tr('Not on meals'), dot: 'muted', count: searched.filter((s) => !s.onMealsToday).length },
            ]}
            active={tab}
            onTab={(id) => setTab(id as Tab)}
            tabsLabel={tr('Staff by meals')}
            summary={<>{tr('Showing')} <b>{shown.length}</b> {tr('of')} {staff.length}</>}
          />
        ) : null}

        {staff.length === 0 ? (
          <div className="card">
            <EmptyState icon="people" title={tr('No staff yet')} text={tr('Add the first staff member, then start their meals here.')}>
              <Button icon="person-plus" onClick={() => navigate('hotel.payroll.staff', { add: '1' })} className="mt-3">{tr('Add staff member')}</Button>
            </EmptyState>
          </div>
        ) : shown.length === 0 ? (
          <div className="card"><EmptyState icon="search" title={tr('No one matches')} text={tr('Try another tab, name or staff ID.')} /></div>
        ) : (
          <div>
            {shown.map((r) => {
              const open = ongoing(r);
              const st = status(r);
              const bill = billOf.get(r.employee.id);
              const recs = [...r.periods].sort((a, b) => b.startsOn.localeCompare(a.startsOn));
              return (
                <DetailCard
                  key={r.employee.id}
                  label={trf('Meals of {0}', [r.employee.name])}
                  className={r.employee.isActive ? undefined : 'is-off'}
                  lead={{ big: initials(r.employee.name), tag: r.employee.isActive ? undefined : tr('Inactive'), muted: !r.employee.isActive, title: r.employee.name }}
                  facts={[
                    { label: tr('Staff'), value: r.employee.name, sub: r.employee.code },
                    { label: tr('Designation'), value: r.employee.designation },
                    { label: tr('Meals'), value: st.value, sub: st.sub, tone: st.tone },
                  ]}
                  amount={{ label: monthTitle(d.period), value: bill ? formatINR(bill.amountPaise) : formatINR(0), sub: bill ? trf('{0} of {1} days', [bill.days, daysInMonth]) : undefined }}
                  sections={[
                    {
                      icon: 'clock-history',
                      title: tr('Meal records'),
                      count: recs.length,
                      wide: true,
                      content: recs.length ? (
                        <DetailList
                          items={recs.map((p) => ({
                            key: p.id,
                            label: p.endsOn ? trf('{0} to {1}', [formatDate(p.startsOn), formatDate(p.endsOn)]) : trf('From {0}, ongoing', [formatDate(p.startsOn)]),
                            value: (
                              <span className="ml-rec">
                                <span className="text-muted">{p.createdBy || tr('System')}</span>
                                {closed(p) ? (
                                  <span className="text-muted"><Bi name="lock-fill" /> {tr('Closed')}</span>
                                ) : (
                                  <MayEdit module="payroll"><Button size="sm" variant="ghost" icon="x-lg" disabled={busy !== null} onClick={() => void removeRecord(r, p)}>{tr('Remove')}</Button></MayEdit>
                                )}
                              </span>
                            ),
                          }))}
                        />
                      ) : (
                        <p className="dc-none">{tr('No meals recorded yet.')}</p>
                      ),
                    },
                  ]}
                  meta={d.closedThrough ? trf('Records up to {0} are closed: its salary is worked out.', [monthTitle(d.closedThrough)]) : undefined}
                  actions={
                    <MayEdit module="payroll">
                      {open ? (
                        <Button size="sm" variant="outline" icon="stop-circle" disabled={busy !== null} onClick={() => setDialog({ kind: 'stop', row: r, period: open })}>{tr('Stop meals')}</Button>
                      ) : (
                        <>
                          <Button size="sm" icon="play-circle" disabled={busy !== null} onClick={() => void startToday(r)}>{tr('Start today')}</Button>
                          <Dropdown align="end" button={(p) => <Button size="sm" variant="ghost" icon="three-dots" aria-label={trf('More for {0}', [r.employee.name])} {...p}>{tr('More')}</Button>}>
                            <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); setDialog({ kind: 'start', row: r }); }}><Bi name="calendar-event" className="me-2" />{tr('Start from another day')}</a>
                          </Dropdown>
                        </>
                      )}
                    </MayEdit>
                  }
                />
              );
            })}
          </div>
        )}

        <div className="card">
          <div className="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
            <span className="d-inline-flex align-items-center gap-2 flex-wrap">
              <span>
                <Bi name="receipt" className="me-1" /> {owed ? trf('To pay {0}', [PAYEE]) : tr('Staff meals bill')} · {monthTitle(d.period)}
              </span>
              {hasBill ? <span className={`ml-state ${d.billFinal ? 'is-final' : ''}`}>{d.billFinal ? tr('Final') : tr('So far')}</span> : null}
            </span>
            <MonthNav month={d.period} last={d.today.slice(0, 7)} onChange={(m) => setPeriod(m)} />
          </div>
          {hasBill ? (
            <>
              <p className="ml-note">
                {d.billFinal
                  ? tr('Final: the salary of this month is worked out.')
                  : d.period === d.today.slice(0, 7)
                    ? trf('Counted up to {0}; it grows each day and is final once this month\'s salary is worked out.', [formatDate(d.today)])
                    : tr('Final once this month\'s salary is worked out.')}{' '}
                {monthPrices.length > 1
                  ? trf('The price changed this month ({0}); each day is charged at the price of that day.', [monthPrices.map((p) => `${formatINR(p.monthlyPaise)} from ${formatDate(p.effectiveFrom)}`).join(', ')])
                  : tr('A day marked with a status that skips meals is left out.')}
              </p>
              <div className="table-responsive">
                <Table className="table align-middle mb-0 pay-report">
                  <thead>
                    <tr>
                      <th>{tr('Staff')}</th>
                      <th>{tr('Designation')}</th>
                      <th className="text-center">{tr('Days')}</th>
                      <th className="money">{tr('Amount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.bill.map((b) => (
                      <tr key={b.employeeId}>
                        <td>
                          <span className="cell-main">{b.employeeName}</span>
                          <span className="cell-sub">{codeOf.get(b.employeeId) ?? ''}</span>
                        </td>
                        <td>{b.designation}</td>
                        <td className="text-center">{b.days} / {daysInMonth}</td>
                        <td className="money">{formatINR(b.amountPaise)}</td>
                      </tr>
                    ))}
                    <tr className="fw-bold">
                      <td colSpan={3}>
                        {owed ? trf('Total to pay {0}', [PAYEE]) : tr('Total cost of staff meals')}
                        <span className="cell-sub fw-normal">{wordsOf(d.billTotalPaise)}</span>
                      </td>
                      <td className="money">{formatINR(d.billTotalPaise)}</td>
                    </tr>
                  </tbody>
                </Table>
              </div>
            </>
          ) : (
            <EmptyState
              icon="cup-hot"
              title={trf('Nothing to count for {0}', [monthTitle(d.period)])}
              text={rate === null ? tr('Set the meal price first.') : staff.every((s) => s.periods.length === 0) ? tr('Nobody is on meals yet. Start someone above.') : tr('Nobody had meals this month.')}
            />
          )}
        </div>
      </div>

      {dialog?.kind === 'start' ? <StartModal companyId={company.id} row={dialog.row} today={d.today} from={firstDay(dialog.row)} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); reload(); }} /> : null}
      {dialog?.kind === 'stop' ? <StopModal companyId={company.id} row={dialog.row} period={dialog.period} today={d.today} firstOpenMonth={d.firstOpenMonth} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); reload(); }} /> : null}
    </PayLayout>
  );
}

function StartModal({ companyId, row, today, from, onClose, onSaved }: { companyId: string; row: MealStaffRow; today: string; from: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [starts, setStarts] = useState(today);
  const [ends, setEnds] = useState('');
  const { busy, errors, submit } = useSubmit(['startsOn', 'endsOn']);
  const save = () =>
    void submit(
      () => payApi.startMeals(companyId, row.employee.id, { startsOn: starts, endsOn: ends }),
      () => {
        toast.show({ tone: 'success', text: trf('Meals started for {0}.', [row.employee.name]) });
        onSaved();
      },
    );
  return (
    <Modal
      open
      className="pay-form-modal"
      centered={false}
      scrollable={false}
      onSubmit={save}
      onClose={onClose}
      eyebrow={row.employee.code}
      title={trf('Start meals for {0}', [row.employee.name])}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr('Cancel')}</Button>
          <Button icon="play-circle" type="submit" disabled={busy}>{tr('Start meals')}</Button>
        </>
      }
    >
      <div className="row g-3">
        <Fld md={6} id={`ms_from_${row.employee.id}`} label={tr('First day')} required hint={tr('Today, or an earlier day of an open month.')} error={errors.startsOn}>
          <PmsDate type="date" id={`ms_from_${row.employee.id}`} className={`form-control ${errors.startsOn ? 'is-invalid' : ''}`} value={starts} min={from} max={today} onChange={(e) => setStarts(e.target.value)} />
        </Fld>
        <Fld md={6} id={`ms_to_${row.employee.id}`} label={tr('Last day')} optional hint={tr('Leave empty while the meals carry on.')} error={errors.endsOn}>
          <PmsDate type="date" id={`ms_to_${row.employee.id}`} className={`form-control ${errors.endsOn ? 'is-invalid' : ''}`} value={ends} min={from} max={today} onChange={(e) => setEnds(e.target.value)} />
        </Fld>
      </div>
    </Modal>
  );
}

function StopModal({ companyId, row, period, today, firstOpenMonth, onClose, onSaved }: { companyId: string; row: MealStaffRow; period: MealPeriod; today: string; firstOpenMonth: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [ends, setEnds] = useState(today);
  const { busy, errors, submit } = useSubmit(['endsOn']);
  const minDate = period.startsOn > `${firstOpenMonth}-01` ? period.startsOn : `${firstOpenMonth}-01`;
  const save = () =>
    void submit(
      () => payApi.stopMeals(companyId, period.id, ends),
      () => {
        toast.show({ tone: 'success', text: trf('Meals stopped for {0}.', [row.employee.name]) });
        onSaved();
      },
    );
  return (
    <Modal
      open
      className="pay-form-modal"
      centered={false}
      scrollable={false}
      onSubmit={save}
      onClose={onClose}
      eyebrow={trf('On meals since {0}', [formatDate(period.startsOn)])}
      title={trf('Stop meals for {0}', [row.employee.name])}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr('Cancel')}</Button>
          <Button icon="stop-circle" type="submit" disabled={busy}>{tr('Stop meals')}</Button>
        </>
      }
    >
      <label className="form-label" htmlFor={`me_to_${period.id}`}>
        {tr('Last day of meals')}<RequiredMark />
      </label>
      <PmsDate type="date" id={`me_to_${period.id}`} className={`form-control ${errors.endsOn ? 'is-invalid' : ''}`} value={ends} min={minDate} max={today} onChange={(e) => setEnds(e.target.value)} />
      {errors.endsOn ? <div className="field-error">{errors.endsOn}</div> : null}
      <FieldHint>{tr('This day is the last one charged. Earlier months stay as they are.')}</FieldHint>
    </Modal>
  );
}
