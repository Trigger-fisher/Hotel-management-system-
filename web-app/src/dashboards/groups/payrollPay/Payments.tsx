'use client';

// Salary payments (hotel.payroll.salaryPayments): one card per salary of the month, what is still to pay at the right with Mark paid.
import { useState } from 'react';
import { formatDate, formatINR } from '@shared/dashboards/format';
import { PDF_ROUTES } from '@shared/dashboards/common';
import { balanceOf, bulkPaymentStatuses, paymentStatusLabel, paymentStatuses, type PaymentListQuery, type PaymentMonth, type PaymentStatus, type PayrollCompanyRef, type SalaryRecord } from '@shared/dashboards/payrollPay';
import { Bi, DetailCard, DetailList, DetailNone, Dialog, FilterBar, Modal, Pager, PmsDate, Select, Textarea, Button, type DetailTone, type TableView } from '@/dashboards/pallav/ui';
import { HomeStats } from '../overview/HomeJobs';
import { useDebounced, useSubmit, useToast } from '@/components/ui';
import type { ScreenProps } from '../../types';
import { EmptyState, Fld, MonthNav, PayLayout, initials } from '../payrollCore/pms';
import { payApi, payToday } from './api';
import { PayPage, failText } from './shared';
import { PdfLink, StaleNote, Wait, useLoaded, useMockPdf } from '../payrollCore/load';

import { tr, trf } from '@/lib/i18n/language';
/** Today: the mock's fixed date in mock mode, the hotel's IST date against the real server. */
const TODAY = payToday();

const thisMonth = TODAY.slice(0, 7);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthTitle = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
const rupees = (paise: number | null) => (paise ? String(paise / 100) : '');

/** Pallav's SalaryProcessing::PAYMENT_STATUSES. */
const STATUS: Record<PaymentStatus, { tone: string; icon: string; hint: string }> = {
  Pending: { tone: 'pending', icon: 'hourglass-split', hint: 'Not started' },
  Processing: { tone: 'processing', icon: 'arrow-repeat', hint: 'Transfer initiated' },
  'On Hold': { tone: 'hold', icon: 'pause-circle', hint: 'Held back deliberately' },
  'Partially Paid': { tone: 'partial', icon: 'pie-chart', hint: 'Part of the salary paid' },
  Paid: { tone: 'paid', icon: 'check-circle', hint: 'Fully settled' },
  Failed: { tone: 'failed', icon: 'x-circle', hint: 'Transfer bounced or rejected' },
};

/** hotel.payroll.salaryPayments */
export function Payments({ user, navigate }: ScreenProps) {
  return <PayPage role={user.role} navigate={navigate}>{(company) => <Body company={company} navigate={navigate} canEdit />}</PayPage>;
}

function Body({ company, navigate, canEdit }: { company: PayrollCompanyRef; navigate: ScreenProps['navigate']; canEdit: boolean }) {
  const [period, setPeriod] = useState<string | undefined>(undefined);
  const [version, setVersion] = useState(0);
  // The month is asked a page at a time, with the status, search and order the person chose: only that page comes over the wire, and the
  // summary (KPIs, tab counts) still counts the whole month.
  const [status, setStatus] = useState<'' | PaymentStatus>('');
  const [search, setSearch] = useState('');
  const typed = useDebounced(search.trim(), 250);
  const [sort, setSort] = useState<{ id: string; dir: 'asc' | 'desc' } | null>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const query: PaymentListQuery = { page, pageSize: perPage, status: status || undefined, search: typed || undefined, sort: (sort?.id as PaymentListQuery['sort']) ?? undefined, dir: sort?.dir };
  const month = useLoaded(() => payApi.listPayments(company.id, period, query), [company.id, period, version, page, perPage, status, typed, sort?.id, sort?.dir]);
  const data: PaymentMonth | null = month.data;
  const onPdf = useMockPdf();
  const [edit, setEdit] = useState<SalaryRecord | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [bulk, setBulk] = useState<{ status: PaymentStatus; paidOn: string; reference: string }>({ status: 'Paid', paidOn: TODAY, reference: '' });
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const rows = data?.rows ?? [];
  const matching = data?.page?.total ?? rows.length;
  // Same clicks as every Pallav table: the first click on a text column is ascending and on a number column descending, then it flips, then it clears.
  const NUMERIC = ['net', 'paid', 'balance', 'paidOn'];
  const view: TableView<SalaryRecord> = {
    rows,
    offset: (page - 1) * perPage,
    total: matching,
    search,
    setSearch: (q) => {
      setSearch(q);
      setPage(1);
    },
    sort,
    toggleSort: (id) => {
      setPage(1);
      setSort((cur) => {
        const first: 'asc' | 'desc' = NUMERIC.includes(id) ? 'desc' : 'asc';
        if (!cur || cur.id !== id) return { id, dir: first };
        return cur.dir === first ? { id, dir: first === 'asc' ? 'desc' : 'asc' } : null;
      });
    },
    page,
    pages: Math.max(1, Math.ceil(matching / perPage)),
    perPage,
    setPage,
    setPerPage: (n) => {
      setPerPage(n);
      setPage(1);
    },
  };
  if (!data) return <Wait error={month.error} onRetry={month.reload} />;
  const d = data;
  const s = d.summary;
  const pct = s.netPaise > 0 ? Math.min(100, Math.round((s.paidPaise / s.netPaise) * 100)) : 0;
  const shown = d.period;
  const visibleIds = view.rows.map((r) => r.id);
  const allPicked = visibleIds.length > 0 && visibleIds.every((id) => picked.includes(id));
  // A person can tick rows on several pages; the update takes every ticked id.
  const selected = picked;
  const trail = [{ label: 'Payroll', icon: 'people', onPress: () => navigate('hotel.payroll.home') }, { label: company.name, onPress: () => navigate('hotel.payroll.dashboard') }, { label: 'Salary payments' }];
  const head = {
    trail,
    sub: tr('Pay the salary worked out for a month and keep a record of when and how each person was paid.'),
    actions: (
      <>
        <MonthNav month={shown} last={thisMonth} onChange={(m) => { setPeriod(m); setPicked([]); setStatus(''); setSearch(''); setSort(null); setPage(1); }} />
        {s.total ? (
          <PdfLink className="btn btn-p" href={PDF_ROUTES.paymentRegister(company.id, shown)} doc={`Payment register for ${monthTitle(shown)}`}>
            <Bi name="file-earmark-pdf" /> {tr("Payment register")}
          </PdfLink>
        ) : null}
      </>
    ),
  };

  async function applyBulk() {
    setBusy(true);
    const res = await payApi.bulkUpdatePayments(company.id, {
      ids: selected,
      status: bulk.status,
      paidOn: bulk.status === 'Paid' ? bulk.paidOn : '',
      reference: bulk.status === 'Paid' ? bulk.reference : '',
      versions: Object.fromEntries(d.rows.filter((x) => selected.includes(x.id)).map((x) => [x.id, x.version])),
    });
    setBusy(false);
    setConfirmBulk(false);
    if (res.ok) {
      toast.show({ tone: 'success', text: res.data.message });
      setPicked([]);
      setVersion((n) => n + 1);
    } else toast.show({ tone: 'error', text: failText(res.error) });
  }

  if (!s.total) {
    return (
      <PayLayout {...head}>
        <div className="card mb-3">
          <EmptyState icon="credit-card-2-back" title={trf("No salary to pay for {0}", [monthTitle(shown)])} text={shown === thisMonth ? tr('This month is still running. Payments open once salary is worked out on Attendance.') : tr('Salary is not worked out for this month yet. Work it out on Attendance.')}>
            <Button variant="outline" icon="calendar3" onClick={() => navigate('hotel.payroll.attendance')} className="mt-3">{tr("Open attendance")}</Button>
          </EmptyState>
        </div>
      </PayLayout>
    );
  }

  const tabs = [
    { id: '', label: 'All', icon: 'collection', count: s.total },
    ...paymentStatuses.filter((p) => s.byStatus[p]).map((p) => ({ id: p, label: paymentStatusLabel[p], icon: STATUS[p].icon, count: s.byStatus[p] })),
  ];

  async function markPaid(r: SalaryRecord) {
    setBusy(true);
    const res = await payApi.updatePayment(company.id, r.id, { status: 'Paid', paidPaise: null, paidOn: TODAY, reference: r.reference, remarks: r.remarks, version: r.version });
    setBusy(false);
    if (res.ok) {
      toast.show({ tone: 'success', text: trf('{0} marked paid.', [r.employeeName]) });
      setVersion((n) => n + 1);
    } else toast.show({ tone: 'error', text: failText(res.error) });
  }
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const tone = (st: PaymentStatus): DetailTone => (st === 'Paid' ? 'ok' : st === 'Failed' ? 'danger' : st === 'Pending' || st === 'On Hold' ? 'warn' : 'info');

  return (
    <PayLayout {...head}>
      <StaleNote error={month.error} onRetry={month.reload} />
      <div className="ha-stack">
        <HomeStats
          stats={[
            { id: 'net', label: tr('Net payable'), value: s.netPaise, format: (n) => formatINR(Math.round(n)), note: trf('{0} people', [s.total]) },
            { id: 'paid', label: tr('Paid'), value: s.paidPaise, format: (n) => formatINR(Math.round(n)), note: trf('{0} paid in full · {1}%', [s.fullyPaid, pct]) },
            { id: 'full', label: tr('Paid in full'), value: s.fullyPaid, format: (n) => String(Math.round(n)), note: trf('of {0} people', [s.total]) },
{ id: 'due', label: tr('Still to pay'), value: s.outstandingPaise, format: (n) => formatINR(Math.round(n)), note: trf('{0} not paid in full', [s.total - s.fullyPaid]) },
          ]}
        />

        <FilterBar
          tabs={tabs}
          active={status}
          onTab={(id) => { setStatus(id as typeof status); setPage(1); }}
          tabsLabel={tr('Payment status')}
          label={tr('Search')}
          summary={
            <>
              {status || view.search ? (
                <>
                  {tr('Showing')} <b>{view.total}</b> {tr('of')} {s.total}
                </>
              ) : (
                <>
                  {tr('All')} <b>{s.total}</b>
                </>
              )}{' '}
              {s.total === 1 ? tr('salary') : tr('salaries')}
            </>
          }
        >
          <div className="search-field bm-fbar-search">
            <Bi name="search" />
            <input type="search" className="form-control" id="paymentSearch" placeholder={tr('Search staff or reference…')} aria-label={tr('Search payments')} value={view.search} onChange={(e) => view.setSearch(e.target.value)} />
          </div>
          {canEdit && view.rows.length ? (
            <label className="pl-all">
              <input
                type="checkbox"
                className="form-check-input"
                checked={allPicked}
                ref={(el) => {
                  if (el) el.indeterminate = !allPicked && visibleIds.some((id) => picked.includes(id));
                }}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...new Set([...p, ...visibleIds])] : p.filter((id) => !visibleIds.includes(id))))}
              />
              <span>{tr('Select all shown')}</span>
            </label>
          ) : null}
        </FilterBar>

        {view.total === 0 ? (
          <div className="card"><EmptyState icon="search" title={tr('No payments match')} text={tr('Try another status or a different name or reference.')} /></div>
        ) : (
          <div>
            {view.rows.map((r) => {
              const bal = balanceOf(r);
              const meta = STATUS[r.paymentStatus];
              const slip = `Salary slip of ${r.employeeName}, ${monthTitle(r.period)}`;
              return (
                <DetailCard
                  key={r.id}
                  label={trf('Salary of {0}', [r.employeeName])}
                  warn={r.paymentStatus === 'Failed'}
                  lead={
                    canEdit ? (
                      <label className="pl-pick" title={trf('Select {0}', [r.employeeName])}>
                        <span className="dc-lead-big">{initials(r.employeeName)}</span>
                        <input type="checkbox" className="form-check-input" aria-label={trf('Select {0}', [r.employeeName])} checked={picked.includes(r.id)} onChange={() => toggle(r.id)} />
                      </label>
                    ) : (
                      { big: initials(r.employeeName) }
                    )
                  }
                  facts={[
                    { label: tr('Staff'), value: r.employeeName, sub: `${r.employeeCode} · ${r.paymentMode}` },
                    { label: tr('Status'), value: paymentStatusLabel[r.paymentStatus], tone: tone(r.paymentStatus), sub: tr(meta.hint) },
                    { label: tr('Paid'), value: formatINR(r.paidPaise), sub: r.paidOn ? formatDate(r.paidOn) : tr('Not yet') },
                    { label: tr('Net salary'), value: formatINR(r.netPaise) },
                  ]}
                  amount={{
                    label: bal > 0 ? tr('Still to pay') : tr('Balance'),
                    value: bal > 0 ? formatINR(bal) : tr('Settled'),
                    tone: bal > 0 ? 'warn' : 'ok',
                    extra: canEdit && bal > 0 ? <Button size="sm" icon="check2" disabled={busy} onClick={(e) => { e.preventDefault(); void markPaid(r); }}>{tr('Mark paid')}</Button> : undefined,
                  }}
                  sections={[
                    {
                      icon: 'receipt-cutoff',
                      title: tr('Payment'),
                      content: (
                        <DetailList
                          items={[
                            { label: tr('Net salary'), value: formatINR(r.netPaise) },
                            { label: tr('Paid so far'), value: formatINR(r.paidPaise) },
                            { label: tr('Paid on'), value: r.paidOn ? formatDate(r.paidOn) : tr('Not yet') },
                            { label: tr('Reference'), value: r.reference || '-' },
                            { label: tr('Still to pay'), value: formatINR(bal), total: true },
                          ]}
                        />
                      ),
                    },
                    { icon: 'chat-left-text', title: tr('Remarks'), content: r.remarks ? <p className="ha-note">{r.remarks}</p> : <DetailNone>{tr('No remarks')}</DetailNone> },
                  ]}
                  actions={
                    <>
                      <a className="btn btn-sm btn-outline-p" href={PDF_ROUTES.salarySlip(company.id, r.id)} target="_blank" rel="noreferrer" onClick={onPdf(slip)}>
                        <Bi name="file-earmark-pdf" className="me-1" />
                        {tr('Salary slip')}
                      </a>
                      {canEdit ? <Button size="sm" variant="outline" icon="pencil-square" onClick={() => setEdit(r)}>{tr('Update payment')}</Button> : null}
                    </>
                  }
                />
              );
            })}
            <div className="card sh-pager-card"><Pager server view={view} /></div>
          </div>
        )}
      </div>
      {canEdit && selected.length > 0 ? (
        <form className="bulk-bar" id="bulkBar" onSubmit={(e) => { e.preventDefault(); setConfirmBulk(true); }}>
          <div className="bb-count">
            <strong>{selected.length}</strong> {tr("selected")}
          </div>
          <Select className="form-select form-select-sm" aria-label={tr("New status")} value={bulk.status} onChange={(e) => setBulk((b) => ({ ...b, status: e.target.value as PaymentStatus }))} required>
            {bulkPaymentStatuses.map((p) => (
              <option key={p} value={p}>
                {tr("Mark")} {paymentStatusLabel[p].toLowerCase()}
              </option>
            ))}
          </Select>
          {bulk.status === 'Paid' ? (
            <>
              <PmsDate type="date" className="form-control form-control-sm" value={bulk.paidOn} max={TODAY} aria-label={tr("Payment date")} onChange={(e) => setBulk((b) => ({ ...b, paidOn: e.target.value }))} />
              <input type="text" className="form-control form-control-sm" placeholder={tr("Reference (optional)")} aria-label={tr("Reference")} value={bulk.reference} onChange={(e) => setBulk((b) => ({ ...b, reference: e.target.value }))} />
            </>
          ) : null}
          <Button size="sm" icon="check2-all" type="submit">{tr("Apply")}</Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked([])}>{tr("Clear")}</Button>
        </form>
      ) : null}

      {edit ? (
        <PaymentModal
          key={edit.id}
          companyId={company.id}
          record={edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            setVersion((n) => n + 1);
          }}
        />
      ) : null}
      <Dialog
        open={confirmBulk}
        tone={bulk.status === 'Failed' ? 'danger' : 'primary'}
        title={trf("Mark {0} {1} as {2}?", [selected.length, selected.length === 1 ? 'payment' : 'payments', bulk.status])}
        message={bulk.status === 'Paid' ? 'Each is recorded as paid in full on the date given.' : `Each one's status changes to ${bulk.status}.`}
        confirmLabel={`Mark ${bulk.status}`}
        busy={busy}
        onConfirm={() => void applyBulk()}
        onCancel={() => setConfirmBulk(false)}
      />
    </PayLayout>
  );
}

function PaymentModal({ companyId, record: r, onClose, onSaved }: { companyId: string; record: SalaryRecord; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<PaymentStatus>(r.paymentStatus);
  const [paid, setPaid] = useState(r.paymentStatus === 'Partially Paid' ? rupees(r.paidPaise) : '');
  const [paidOn, setPaidOn] = useState(r.paidOn ?? TODAY);
  const [reference, setReference] = useState(r.reference);
  const [remarks, setRemarks] = useState(r.remarks);
  const { busy, errors, conflict, submit } = useSubmit(['paidPaise', 'paidOn']);
  const settles = status === 'Paid' || status === 'Partially Paid';
  const uid = r.id;

  const save = () =>
    void submit(
      () => payApi.updatePayment(companyId, r.id, { status, paidPaise: status === 'Partially Paid' ? Math.round((Number(paid) || 0) * 100) || null : null, paidOn: settles ? paidOn : '', reference: settles ? reference : '', remarks, version: r.version }),
      () => {
        toast.show({ tone: 'success', text: 'Payment saved.' });
        onSaved();
      },
    );

  return (
    <Modal
      open
      size="lg"
      className="pay-form-modal"
      centered={false}
      onSubmit={save}
      onClose={onClose}
      eyebrow={<>{r.employeeCode} · {monthTitle(r.period)}</>}
      title={r.employeeName}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel")}</Button>
          <Button type="submit" disabled={busy}>{tr("Save payment")}</Button>
        </>
      }
    >
      {conflict ? (
        <div className="alert alert-warning">
          {tr("This payment changed while you had it open.")}{' '}
          <Button variant="outline" size="sm" onClick={onSaved} className="ms-2">{tr("Refresh")}</Button>
        </div>
      ) : null}
      <div className="pay-summary mb-4">
        <div>
          <span>{tr("Net salary")}</span>
          <strong>{formatINR(r.netPaise)}</strong>
        </div>
        <div>
          <span>{tr("Paid so far")}</span>
          <strong>{formatINR(r.paidPaise)}</strong>
        </div>
        <div>
          <span>{tr("Balance")}</span>
          <strong>{formatINR(balanceOf(r))}</strong>
        </div>
        <div>
          <span>{tr("Mode")}</span>
          <strong>{r.paymentMode}</strong>
        </div>
      </div>

      <div className="form-section">
        <div className="fs-head">
          <div className="fs-title">
            <Bi name="check2-circle" /> {tr("Payment status")}
          </div>
        </div>
        <div className="status-options mb-3">
          {paymentStatuses.map((p) => (
            <label key={p} className={`status-option tone-${STATUS[p].tone}`}>
              <input type="radio" name={`payment_status_${uid}`} value={p} checked={status === p} onChange={() => setStatus(p)} required />
              <span className="so-body">
                <Bi name={STATUS[p].icon} />
                <span className="so-title">{paymentStatusLabel[p]}</span>
                <span className="so-hint">{STATUS[p].hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="form-section">
        <div className="fs-head">
          <div className="fs-title">
            <Bi name="receipt-cutoff" /> {tr("Payment details")}
          </div>
        </div>
        <div className="row g-3">
          {status === 'Partially Paid' ? (
            <Fld md={4} id={`pa_amt_${uid}`} label={tr("Amount paid")} required hint={`Less than ${formatINR(r.netPaise)}.`} error={errors.paidPaise}>
              <div className="input-group">
                <span className="input-group-text">₹</span>
                <input type="number" step="0.01" min="0.01" max={r.netPaise / 100} id={`pa_amt_${uid}`} className={`form-control ${errors.paidPaise ? 'is-invalid' : ''}`} value={paid} onChange={(e) => setPaid(e.target.value)} />
              </div>
            </Fld>
          ) : null}
          {settles ? (
            <>
              <Fld md={4} id={`pa_date_${uid}`} label={tr("Paid on")} required error={errors.paidOn}>
                <PmsDate type="date" id={`pa_date_${uid}`} className={`form-control ${errors.paidOn ? 'is-invalid' : ''}`} max={TODAY} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
              </Fld>
              <Fld md={4} id={`pa_ref_${uid}`} label={tr("Reference")} optional>
                <input type="text" id={`pa_ref_${uid}`} className="form-control" maxLength={100} placeholder={r.paymentMode === 'Bank' ? 'UTR / transaction ID' : 'Voucher / receipt no.'} value={reference} onChange={(e) => setReference(e.target.value)} />
              </Fld>
            </>
          ) : null}
          <Fld md={12} id={`pa_rem_${uid}`} label={tr("Remarks")} optional>
            <Textarea id={`pa_rem_${uid}`} className="form-control" rows={2} maxLength={500} placeholder={tr("Why it is on hold, why it failed, anything finance should know…")} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Fld>
        </div>
      </div>
    </Modal>
  );
}
