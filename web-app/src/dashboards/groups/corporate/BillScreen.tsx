'use client';

// One bill (view id "corporate.bill", params.id). The head names the bill and opens its invoice; the paying panel (what is due and the one Pay button,
// the sticky bar on a phone) stands apart from the information: the stay, what the bill is for, the payments made on it as a timeline.
// While online paying is not open (online.ts) the panel says how to pay instead, with Call accounts and Email accounts.
import { personsText } from '@shared/dashboards/guest';
import { useState } from 'react';

import { billSac } from '@shared/dashboards/billing';
import { billDuePaise, billStatus, type BillDetail, type CompanyBill } from '@shared/dashboards/corporate';
import { corporateCopyByLanguage } from '@shared/dashboards/corporate.lang';
import { formatDate, formatINR } from '@shared/dashboards/format';

import { errorText, useAsync, useToast } from '@/components/ui';
import { Bi, Button, Dialog, DetailList, DetailNone, GoldTick, IconButton, PortalButton } from '@/dashboards/pallav/ui';
import { tr, useCopy } from '@/lib/i18n/language';
import type { ScreenProps } from '../../types';
import { StickyActions } from '../portal/AppKit';
import { PtLoad } from '../portal/parts';
import { corporateApi, corporateToday } from './api';
import { BillPill } from './cpParts';
import { corporateCanPayOnline, telHref } from './online';
import { InvoicePreview } from './parts';
import { cpWords } from './words';

type Copy = typeof corporateCopyByLanguage.en;
const W = cpWords.bill;
const nights = (n: number) => `${n} ${n === 1 ? 'night' : 'nights'}`;
const minus = (p: number) => `− ${formatINR(p)}`;

export function CorporateBillScreen({ params, back }: ScreenProps) {
  const id = params.id ?? '';
  const { state, reload } = useAsync(() => corporateApi.getBill(id), [id]);
  return (
    <PtLoad state={state} onRetry={reload}>
      {(detail: BillDetail) => <BillBody detail={detail} back={back} reload={reload} />}
    </PtLoad>
  );
}

function hotelItems(b: CompanyBill, c: Copy) {
  return [
    {
      label: `${c.bill.roomTariff} · ${nights(b.nights)}`,
      value: formatINR(b.roomTariffPaise),
    },
    b.discountPaise > 0 && {
      label: c.bill.discount,
      value: minus(b.discountPaise),
    },
    b.laundryPaise > 0 && {
      label: c.bill.laundry,
      value: formatINR(b.laundryPaise),
    },
    { label: 'HSN/SAC', value: billSac(b).hotel },
    { label: c.bill.gst, value: formatINR(b.hotelGstPaise) },
    { label: c.bill.total, value: formatINR(b.totalHotelPaise), total: true },
    b.advanceHotelPaise > 0 && {
      label: b.advanceReceipt ? `${c.bill.advance} · ${b.advanceReceipt}` : c.bill.advance,
      value: minus(b.advanceHotelPaise),
    },
  ];
}

function foodItems(b: CompanyBill, c: Copy) {
  return [
    { label: c.bill.food, value: formatINR(b.foodPaise) },
    { label: 'HSN/SAC', value: billSac(b).food },
    { label: c.bill.gst, value: formatINR(b.foodGstPaise) },
    { label: c.bill.total, value: formatINR(b.totalFoodPaise), total: true },
    b.advanceFoodPaise > 0 && {
      label: c.bill.advance,
      value: minus(b.advanceFoodPaise),
    },
  ];
}

function BillBody({ detail, back, reload }: { detail: BillDetail; back: () => void; reload: () => void }) {
  const c = useCopy(corporateCopyByLanguage);
  const toast = useToast();
  const b = detail.bill;
  const due = billDuePaise(b);
  const status = billStatus(b, corporateToday());
  const [invoice, setInvoice] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [paying, setPaying] = useState(false);

  const pay = async () => {
    setPaying(true);
    const res = await corporateApi.payBill(b.id);
    setPaying(false);
    setConfirming(false);
    if (!res.ok) {
      toast.show({ tone: 'error', text: errorText(res.error) });
      return;
    }
    toast.show({ tone: 'success', text: c.dues.done(formatINR(due)) });
    reload();
  };

  const sideLabel = (mode: string | null) => (mode && mode !== 'On account' ? `${c.bill.paidAtCheckout} (${mode})` : c.bill.balance);
  const payLabel = `${c.bill.payThis} · ${formatINR(due)}`;
  const online = corporateCanPayOnline(detail);
  const by = detail.company.billedBy;
  const call = by.phone ? () => window.location.assign(telHref(by.phone)) : null;
  const mail = by.email ? () => window.location.assign(`mailto:${by.email}?subject=${encodeURIComponent(c.bill.title(b.billNumber))}`) : null;

  return (
    <div className="cp-page">
      <div className="page-head">
        <div>
          <nav className="crumbs app-hide-phone" aria-label={tr('Breadcrumb')}>
            <a
              className="crumbs-back"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                back();
              }}
            >
              <Bi name="arrow-left" />
              <span>{tr(W.back)}</span>
            </a>
          </nav>
          <h2 className="pms-title">
            {c.bill.title(b.billNumber)} <BillPill status={status} />
          </h2>
          <p className="pms-sub">{[formatDate(b.billDate), b.guestName, detail.company.billedBy.name].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="sh-head-actions">
          <Button variant="outline" icon="file-earmark-text" onClick={() => setInvoice(true)}>
            {tr(W.invoice)}
          </Button>
          <IconButton icon="printer" label={tr(W.print)} onClick={() => window.print()} />
        </div>
      </div>

      <div className="cp-bill-grid">
        <section className={`card cp-paybox${due > 0 ? '' : ' is-paid'}`} aria-label={due > 0 ? W.toPay : W.paidAll}>
          {due > 0 ? (
            <>
              <span className="cp-due-lab">{tr(W.toPay)}</span>
              <b className="cp-paybox-fig">{formatINR(due)}</b>
              <DetailList
                items={[
                  {
                    label: `${c.bill.hotelSide} · ${tr(sideLabel(b.hotelMode))}`,
                    value: formatINR(b.balanceHotelPaise),
                  },
                  {
                    label: `${c.bill.foodSide} · ${tr(sideLabel(b.foodMode))}`,
                    value: formatINR(b.balanceFoodPaise),
                  },
                ]}
              />
              {online ? (
                <>
                  <Button icon="credit-card" className="cp-paybox-btn app-hide-phone" onClick={() => setConfirming(true)}>
                    {payLabel}
                  </Button>
                  <p className="cp-note">
                    <Bi name="lock" /> {tr(W.payNote)}
                  </p>
                </>
              ) : (
                <div className="cp-howto">
                  <b>{tr(W.howToPay)}</b>
                  <p className="cp-note">
                    <Bi name="bank" /> {W.howToPayLine(by.name)}
                  </p>
                  <div className="cp-howto-acts app-hide-phone">
                    {call ? (
                      <Button icon="telephone" className="cp-paybox-btn" onClick={call}>
                        {tr(W.callAccounts)}
                      </Button>
                    ) : null}
                    {mail ? (
                      <Button variant={call ? 'outline' : 'primary'} icon="envelope" className="cp-paybox-btn" onClick={mail}>
                        {tr(W.emailAccounts)}
                      </Button>
                    ) : null}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="cp-paid">
              <GoldTick size={48} />
              <div>
                <b>{tr(W.paidAll)}</b>
                <span>
                  {c.bill.total} {formatINR(b.totalHotelPaise + b.totalFoodPaise)}
                </span>
              </div>
            </div>
          )}
        </section>

        <section className="card cp-info" aria-labelledby="cp-stay">
          <h3 id="cp-stay" className="cp-card-h">
            <Bi name="person" /> {tr(W.stay)}
          </h3>
          <DetailList
            items={[
              { label: c.bill.guest, value: b.guestName },
              b.persons && {
                label: 'Persons',
                value: `${personsText(b.persons)}${b.persons.names.length > 0 ? ` (${b.persons.names.join(', ')})` : ''}`,
              },
              b.guestMobile ? { label: c.bill.mobile, value: b.guestMobile } : false,
              {
                label: c.bill.room,
                value: b.roomNumber ? `${b.roomNumber}${b.roomType ? ` · ${b.roomType}` : ''}` : '-',
              },
              b.plan ? { label: c.bill.plan, value: b.plan } : false,
              {
                label: c.bill.dates,
                value: `${formatDate(b.checkIn)} · ${nights(b.nights)}`,
              },
              b.reference ? { label: c.bill.reference, value: b.reference } : false,
              b.note ? { label: c.bill.note, value: b.note } : false,
            ]}
          />
        </section>

        <section className="card cp-info cp-charges" aria-labelledby="cp-charges">
          <h3 id="cp-charges" className="cp-card-h">
            <Bi name="receipt" /> {tr(W.charges)}
          </h3>
          <div className="cp-charge-cols">
            <div>
              <h4 className="cp-sub-h">
                {c.bill.hotelSide} <span>{detail.company.billedBy.name}</span>
              </h4>
              <DetailList items={hotelItems(b, c)} />
            </div>
            <div>
              <h4 className="cp-sub-h">{c.bill.foodSide}</h4>
              <DetailList items={foodItems(b, c)} />
            </div>
          </div>
        </section>

        <section className="card cp-info" aria-labelledby="cp-paid">
          <h3 id="cp-paid" className="cp-card-h">
            <Bi name="wallet2" /> {tr(W.paid)}
          </h3>
          {b.settlements.length === 0 ? (
            <DetailNone>{c.bill.noPayments}</DetailNone>
          ) : (
            <ol className="pf-timeline">
              {b.settlements.map((p, i) => (
                <li key={`${p.date}-${i}`}>
                  <span className="pf-tl-dot" aria-hidden="true" />
                  <div className="pf-tl-body">
                    <b>
                      {formatINR(p.hotelPaise + p.foodPaise)}
                      {p.mode ? ` · ${p.mode}` : ''}
                    </b>
                    <small>{[formatDate(p.date), p.reference].filter(Boolean).join(' · ')}</small>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {due > 0 && online ? (
        <StickyActions label={c.bill.payThis}>
          <PortalButton icon="credit-card" onClick={() => setConfirming(true)}>
            {payLabel}
          </PortalButton>
        </StickyActions>
      ) : due > 0 && (call || mail) ? (
        <StickyActions label={W.howToPay}>
          <PortalButton icon={call ? 'telephone' : 'envelope'} onClick={call ?? mail ?? undefined}>
            {tr(call ? W.callAccounts : W.emailAccounts)}
          </PortalButton>
        </StickyActions>
      ) : null}

      <InvoicePreview detail={detail} open={invoice} onClose={() => setInvoice(false)} />
      <Dialog
        open={confirming}
        title={c.bill.payThisTitle}
        message={c.dues.confirmBody(formatINR(due))}
        confirmLabel={c.dues.confirm}
        icon="lock"
        busy={paying}
        onConfirm={() => void pay()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
