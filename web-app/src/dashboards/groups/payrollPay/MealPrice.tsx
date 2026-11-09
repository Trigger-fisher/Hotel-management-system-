'use client';

// Meal price (hotel.payroll.mealPrice, the food company's alone): set a new price, then one card per price in the history.
import { useEffect, useState } from 'react';
import { formatDate, formatINR } from '@shared/dashboards/format';
import { type MealsOverview } from '@shared/dashboards/payrollPay';
import { type DashError } from '@shared/dashboards/common';
import { Bi, DetailCard, Dropdown, PmsDate, Button, MayEdit, type DetailTone } from '@/dashboards/pallav/ui';
import { HomeStats } from '../overview/HomeJobs';
import { useSubmit, useToast } from '@/components/ui';
import type { ScreenProps } from '../../types';
import { EmptyState, Fld, PayLayout, SearchField } from '../payrollCore/pms';
import { payApi } from './api';
import { PayPage, failText, useFoodCompanyName } from './shared';
import { StaleNote, Wait } from '../payrollCore/load';

import { tr, trf } from '@/lib/i18n/language';
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLong = (m: string) => `${MONTHS_LONG[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** hotel.payroll.mealPrice */
export function MealPrice({ user, navigate }: ScreenProps) {
  const PAYEE = useFoodCompanyName();
  return (
    <PayPage role={user.role} navigate={navigate}>
      {(company) => (company.providesFood ? <Body companyId={company.id} companyName={company.name} navigate={navigate} /> : (
        <div className="card">
          <EmptyState icon="tag" title={trf('The meal price is set by {0}', [PAYEE])} text={trf('Open the {0} payroll to change it. Here it shows on Staff meals.', [PAYEE])}>
            <Button icon="cup-hot" onClick={() => navigate('hotel.payroll.meals')} className="mt-3">{tr('Go to staff meals')}</Button>
          </EmptyState>
        </div>
      ))}
    </PayPage>
  );
}

type Price = MealsOverview['prices'][number];

function Body({ companyId, companyName, navigate }: { companyId: string; companyName: string; navigate: ScreenProps['navigate'] }) {
  const toast = useToast();
  const PAYEE = useFoodCompanyName();
  const [d, setD] = useState<MealsOverview | null>(null);
  const [version, setVersion] = useState(0);
  const [amount, setAmount] = useState('');
  const [from, setFrom] = useState('');
  const [failed, setFailed] = useState<DashError | null>(null);
  const [typed, setTyped] = useState('');
  const { busy: saving, errors, submit } = useSubmit(['monthlyPaise', 'effectiveFrom']);
  const reload = () => setVersion((n) => n + 1);

  useEffect(() => {
    let live = true;
    void payApi.getMeals(companyId).then((res) => {
      if (!live) return;
      if (!res.ok) {
        setFailed(res.error);
        return;
      }
      setFailed(null);
      setD(res.data);
      setAmount((a) => (a === '' && res.data.currentPricePaise ? String(res.data.currentPricePaise / 100) : a));
      setFrom((f) => f || res.data.today);
    });
    return () => {
      live = false;
    };
  }, [companyId, version]);

  if (!d) return <Wait error={failed} onRetry={reload} />;
  const latest = d.prices[0];
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  const stateOf = (p: Price): { label: string; tone: DetailTone } => (p.inForce ? { label: tr('In force'), tone: 'ok' } : p.effectiveFrom > d.today ? { label: tr('Starts later'), tone: 'info' } : { label: tr('Replaced'), tone: 'muted' });
  const shown = words.length ? d.prices.filter((p) => words.every((w) => `${formatDate(p.effectiveFrom)} ${p.effectiveFrom} ${p.monthlyPaise / 100} ${stateOf(p).label}`.toLowerCase().includes(w))) : d.prices;
  const floorMonth = d.firstOpenPriceMonth;

  const save = () =>
    void submit(
      () => payApi.addMealPrice(companyId, { monthlyPaise: Math.round((Number(amount) || 0) * 100) || null, effectiveFrom: from }),
      (r) => {
        toast.show({ tone: 'success', text: r.message });
        reload();
      },
    );

  async function remove(p: Price) {
    const res = await payApi.deleteMealPrice(companyId, p.id);
    if (!res.ok) {
      toast.show({ tone: 'error', text: failText(res.error) });
      return;
    }
    reload();
    toast.show({
      tone: 'success',
      text: res.data.message,
      action: { label: 'Undo', onClick: () => void payApi.addMealPrice(companyId, { monthlyPaise: p.monthlyPaise, effectiveFrom: p.effectiveFrom }).then((x) => { if (!x.ok) toast.show({ tone: 'error', text: failText(x.error) }); reload(); }) },
    });
  }

  return (
    <PayLayout
      trail={[{ label: 'Payroll', icon: 'people', onPress: () => navigate('hotel.payroll.home') }, { label: companyName, onPress: () => navigate('hotel.payroll.dashboard') }, { label: 'Meal price' }]}
      sub={trf('What {0} charges for one person\'s meals for a month, for the staff of every company who eat here.', [PAYEE])}
      search={d.prices.length > 6 ? <SearchField bare clear value={typed} onChange={setTyped} placeholder={tr('Search the price history…')} label={tr('Search the price history')} /> : undefined}
      actions={<Button variant="outline" icon="cup-hot" onClick={() => navigate('hotel.payroll.meals')}>{tr('Staff meals')}</Button>}
    >
      <StaleNote error={failed} onRetry={reload} />
      <div className="ha-stack">
        <HomeStats
          stats={[
            { id: 'price', label: tr('Price today'), value: d.currentPricePaise ?? 0, format: (n) => (d.currentPricePaise === null ? tr('Not set') : formatINR(Math.round(n))), note: d.currentPricePaise === null ? tr('Set it below to start') : tr('A person, a month') },
            { id: 'since', label: tr('Last changed'), value: d.prices.length, format: () => (latest ? formatDate(latest.effectiveFrom) : tr('Never')), note: trf('{0} on record', [d.prices.length === 1 ? tr('1 price') : trf('{0} prices', [d.prices.length])]) },
            { id: 'count', label: tr('Prices on file'), value: d.prices.length, format: (n) => String(Math.round(n)), note: tr('Since the first') },
{ id: 'closed', label: tr('Fixed up to'), value: 0, format: () => (d.priceClosedThrough ? monthLong(d.priceClosedThrough) : tr('Nothing yet')), note: d.priceClosedThrough ? tr('Salary worked out') : tr('No salary worked out yet') },
          ]}
        />

        <div className="card">
          <div className="card-header">
            <Bi name="tag" className="me-1" /> {d.currentPricePaise === null ? tr('Set the price') : tr('Change the price')}
          </div>
          <form className="card-body" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <div className="row g-3 align-items-end">
              <Fld md={4} id="fp_amount" label={tr('Price a person, a month')} required error={errors.monthlyPaise}>
                <div className="input-group">
                  <span className="input-group-text">₹</span>
                  <input type="number" inputMode="decimal" step="0.01" min="0" id="fp_amount" className={`form-control ${errors.monthlyPaise ? 'is-invalid' : ''}`} placeholder="3000" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
              </Fld>
              <Fld md={4} id="fp_from" label={tr('Starts on')} required error={errors.effectiveFrom}>
                <PmsDate type="date" id="fp_from" className={`form-control ${errors.effectiveFrom ? 'is-invalid' : ''}`} value={from} min={`${floorMonth}-01`} max={d.today} onChange={(e) => setFrom(e.target.value)} />
              </Fld>
              <div className="col-md-4">
                <MayEdit module="payroll"><Button icon="check2" type="submit" disabled={saving} className="w-100 mp-go">{tr('Save price')}</Button></MayEdit>
              </div>
            </div>
            <p className="mp-note">
              {tr('Days before it keep the old price; the old price stays on record.')}
              {d.priceClosedThrough ? ` ${trf('Salary is worked out up to {0}, so a new price can start from {1}.', [monthLong(d.priceClosedThrough), monthLong(floorMonth)])}` : ''}
            </p>
          </form>
        </div>

        {d.prices.length === 0 ? (
          <div className="card"><EmptyState icon="tag" title={tr('No price yet')} text={tr('Enter the price above and Save price. Until then no meals bill can be worked out.')} /></div>
        ) : shown.length === 0 ? (
          <div className="card">
            <EmptyState icon="search" title={tr('No price matches')} text={tr('Try a date like 2026-10 or an amount.')}>
              <Button variant="outline" className="mt-3" onClick={() => setTyped('')}>{tr('Clear search')}</Button>
            </EmptyState>
          </div>
        ) : (
          <div>
            {shown.map((p) => {
              const st = stateOf(p);
              return (
                <DetailCard
                  key={p.id}
                  label={trf('Price from {0}', [formatDate(p.effectiveFrom)])}
                  className={st.tone === 'muted' ? 'is-off' : undefined}
                  lead={{ big: formatDate(p.effectiveFrom).slice(0, 6), tag: p.effectiveFrom.slice(0, 4), title: formatDate(p.effectiveFrom) }}
                  facts={[
                    { label: tr('Starts on'), value: formatDate(p.effectiveFrom), sub: p.createdAt ? trf('Entered {0}', [formatDate(p.createdAt)]) : undefined },
                    { label: tr('Was'), value: p.previousPaise !== null ? formatINR(p.previousPaise) : '', empty: tr('First price') },
                    { label: tr('Status'), value: st.label, tone: st.tone, sub: p.locked ? tr('Fixed: salary worked out') : undefined },
                  ]}
                  amount={{ label: tr('A month'), value: formatINR(p.monthlyPaise) }}
                  meta={p.locked ? tr('It cannot be removed: a salary was worked out with it.') : trf('Days from {0} use this price.', [formatDate(p.effectiveFrom)])}
                  actions={
                    !p.locked ? (
                      <MayEdit module="payroll">
                        <Dropdown align="end" button={(b) => <Button size="sm" variant="ghost" icon="three-dots" aria-label={trf('More for the price from {0}', [formatDate(p.effectiveFrom)])} {...b}>{tr('More')}</Button>}>
                          <a href="#" className="dropdown-item text-danger" onClick={(e) => { e.preventDefault(); void remove(p); }}><Bi name="trash" className="me-2" />{tr('Remove price')}</a>
                        </Dropdown>
                      </MayEdit>
                    ) : undefined
                  }
                />
              );
            })}
          </div>
        )}
      </div>
    </PayLayout>
  );
}
