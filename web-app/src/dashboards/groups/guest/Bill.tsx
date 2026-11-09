'use client';
// One bill (guest.bill, params.id), pushed on top of Bills. The summary card holds the one amount (To pay, Paid or Cancelled), who billed and the number, and
// one main action for the state (Pay, Call reception or Download PDF) with the rest in a More menu. Then two cards side by side (Bill details, Money), the
// charges by day and the payments as a timeline. Pay online when the hotel's online payment is set up (useCanPayOnline), else Call reception. `?preview=1` offers the PDF in a sheet.
import { useState, type ReactNode } from 'react';

import { formatDate, formatDateTime } from '@shared/dashboards';
import { billNumberText, billState, billTotals, guestBusinesses, paymentMethodLabel, personsText, stayRange, type BillLine, type GuestBill } from '@shared/dashboards/guest';
import { GST_SAC } from '@shared/dashboards/billing';
import { guestBillPdfPath } from '@shared/dashboards/guestDocuments';
import { billsCopyByLanguage } from '@shared/dashboards/guestCopy/bills.lang';
import { sellerName } from '@shared/dashboards/guestStage';

import { errorText, useAsync, useToast } from '@/components/ui';
import { Bi, DetailList, DetailNone, Dropdown, EmptyState, openPdf, PortalButton, wordsOf } from '@/dashboards/pallav/ui';
import type { ScreenProps } from '../../types';
import { guestApi, guestToday } from './api';
import { GuestPaySheet } from './parts';
import { useCanPayOnline, GgActionBar, GgPage, GgSheet, GgSkeleton, useGuestRefresh, useReceptionPhone, telHref } from './kit';
import { gpWordsByLanguage } from './kit/words';
import { inr, PtLoad } from '../portal/parts';
import { useCopy } from '@/lib/i18n/language';


export function GuestBill({ params, navigate }: ScreenProps) {
  const billsCopy = useCopy(billsCopyByLanguage);
  const c = billsCopy.bill;
  const id = params.id ?? '';
  // params.hotel: the bill's own hotel, given by the list that opened it (a page's hotel chips may differ from the sidebar); absent on a deep link
  const hotel = params.hotel;
  const { state, reload } = useAsync(() => guestApi.getBill(id, hotel), [id, hotel]);
  useGuestRefresh(reload);
  // held here, outside PtLoad: a reload (after paying, Try again) must not open the PDF sheet again
  const [pdfAsked, setPdfAsked] = useState(params.preview === '1');
  const bill = state.status === 'ready' ? state.data : null;
  const title = bill ? (bill.number.trim() ? c.titleNo(bill.number) : c.running) : billsCopy.title;
  const notFound = state.status === 'error' && (state.error.code === 'NOT_FOUND' || state.error.code === 'FORBIDDEN');

  return (
    <GgPage title={title} status={bill ? sellerName(bill) : undefined} className="gg-bill gp-billpage" push>
      {/* a desktop has no back arrow in the top bar (a phone does): Back to Bills sits on the page there */}
      {notFound ? null : (
        <div className="gg-bill-back">
          <PortalButton variant="line" icon="arrow-left" onClick={() => navigate('guest.bills')}>
            {c.backToBills}
          </PortalButton>
        </div>
      )}
      {notFound ? (
        <div className="gg-card gg-bill-missing" role="alert">
          <EmptyState look="portal" icon="receipt" title={c.notFoundTitle} text={c.notFoundBody}>
            <div className="mt-3">
              <PortalButton variant="line" icon="arrow-left" onClick={() => navigate('guest.bills')}>
                {c.backToBills}
              </PortalButton>
            </div>
          </EmptyState>
        </div>
      ) : (
        <PtLoad state={state} onRetry={reload} skeleton={<GgSkeleton variant="bill" />}>
          {(data) => <BillBody bill={data} navigate={navigate} pdfAsked={pdfAsked} closePdf={() => setPdfAsked(false)} />}
        </PtLoad>
      )}
    </GgPage>
  );
}

/** The bill's lines by day, oldest day first (the order a stay runs). */
function linesByDay(lines: readonly BillLine[]): { date: string; lines: BillLine[] }[] {
  const by = new Map<string, BillLine[]>();
  for (const l of lines) {
    const day = l.date.slice(0, 10);
    const list = by.get(day);
    if (list) list.push(l);
    else by.set(day, [l]);
  }
  return [...by].sort(([a], [b]) => a.localeCompare(b)).map(([date, ls]) => ({ date, lines: ls }));
}

function BillBody({ bill, navigate, pdfAsked, closePdf }: { bill: GuestBill; navigate: ScreenProps['navigate']; pdfAsked: boolean; closePdf: () => void }) {
  const billsCopy = useCopy(billsCopyByLanguage);
  const c = billsCopy.bill;
  const w = useCopy(gpWordsByLanguage).bill;
  const toast = useToast();
  const today = guestToday();
  const t = billTotals(bill);
  const st = billState(bill, today);
  const cancelled = st === 'cancelled';
  const payable = t.duePaise > 0 && !cancelled;
  const online = useCanPayOnline(bill.hotelId);
  const phone = useReceptionPhone(bill.hotelId);
  const [paying, setPaying] = useState(false);
  const [mailing, setMailing] = useState(false);
  const [needEmail, setNeedEmail] = useState(false);
  const biz = guestBusinesses[bill.business];
  const seller = sellerName(bill);
  const gstin = bill.seller?.gstin ?? biz.gstin;
  const address = bill.seller?.address ?? null;
  // the server's bill carries its own GST (the rate may differ from the business default), so no rate is printed then
  const gstLabel = bill.totals ? c.gst : biz.gstLabel;
  const persons = bill.persons ? personsText(bill.persons) : '';
  const personNames = bill.persons && bill.persons.names.length > 0 ? bill.persons.names.join(', ') : '';
  const issued = !bill.current;
  const pdfUrl = guestBillPdfPath(bill.id, bill.hotelId);

  const downloadPdf = () => void openPdf(pdfUrl, (text) => toast.show({ tone: 'error', text }), (text) => toast.show({ tone: 'info', text }));
  const call = () => {
    if (phone) window.location.href = telHref(phone);
  };

  const email = async () => {
    setMailing(true);
    const res = await guestApi.emailBill(bill.id, bill.hotelId);
    setMailing(false);
    if (res.ok) {
      setNeedEmail(false);
      toast.show({ tone: 'success', text: c.emailed(res.data.sentTo) });
      return;
    }
    toast.show({ tone: 'error', text: errorText(res.error) });
    // 422 on `email`: no usable email on the account; Account's email sheet fixes it
    if (res.error.details?.fields?.email) setNeedEmail(true);
  };

  // the one amount: what is still to pay (coral), else "Paid" or "Cancelled"
  const statusLine =
    st === 'overdue' && bill.dueOn ? (
      <span className="gg-bill-bad">{c.overdueSince(formatDate(bill.dueOn))}</span>
    ) : st === 'due' ? (
      <span>{bill.dueOn ? c.payBy(formatDate(bill.dueOn)) : c.payAtCheckout}</span>
    ) : null;

  const more: { id: string; label: string; icon: string; run: () => void }[] = [];
  let main: ReactNode = null;
  if (payable && online) {
    main = (
      <PortalButton icon="lock" onClick={() => setPaying(true)}>
        {c.pay(inr(t.duePaise))}
      </PortalButton>
    );
  } else if (payable && phone) {
    main = (
      <PortalButton icon="telephone" onClick={call}>
        {c.callReception}
      </PortalButton>
    );
  }
  if (issued) {
    if (main) more.push({ id: 'pdf', label: c.download, icon: 'download', run: downloadPdf });
    else
      main = (
        <PortalButton icon="download" onClick={downloadPdf}>
          {c.download}
        </PortalButton>
      );
    more.push({ id: 'email', label: mailing ? c.sending : c.email, icon: 'envelope', run: () => void email() });
  }

  const amountLine = payable ? (t.paidPaise > 0 ? c.paidOf(inr(t.paidPaise), inr(t.totalPaise)) : c.totalLine(inr(t.totalPaise))) : null;

  return (
    <>
      {cancelled ? (
        <div className="gg-note" role="status">
          <Bi name="slash-circle" />
          <span>{c.cancelledNote}</span>
        </div>
      ) : null}
      {!issued && !cancelled ? (
        <div className="gg-note" role="status">
          <Bi name="hourglass-split" />
          <span>{c.runningNote}</span>
        </div>
      ) : null}

      <section className={`gg-card gp-billsum gp-billsum-${st}${payable && (online || phone) ? ' gp-has-bar' : ''}`} aria-label={c.actions}>
        <div className="gp-billsum-who">
          <span className="gp-billsum-ico" aria-hidden="true">
            <Bi name={bill.business === 'hotel' ? 'building' : 'cup-hot'} />
          </span>
          <span className="gp-billsum-txt">
            <span className="gp-eyebrow">{seller}</span>
            <span className="gp-billsum-no">
              {billNumberText(bill.number)}
              {issued ? ` · ${formatDate(bill.issuedOn)}` : ''}
            </span>
          </span>
        </div>
        <div className="gp-billsum-amt">
          <span className="gp-billsum-label">{payable ? c.toPay : cancelled ? c.cancelled : c.paid}</span>
          <strong>{inr(payable ? t.duePaise : t.totalPaise)}</strong>
          {amountLine ? <span className="gp-billsum-line">{amountLine}</span> : null}
          {statusLine ? <span className="gp-billsum-line">{statusLine}</span> : null}
          {payable && !online ? <span className="gp-billsum-line">{c.atReception(inr(t.duePaise))}</span> : null}
        </div>
        {main || more.length > 0 ? (
          <div className="gp-billsum-act">
            {main ? <span className="gp-billsum-main">{main}</span> : null}
            {more.length > 0 ? (
              <Dropdown
                align="end"
                button={(p) => (
                  <PortalButton variant="line" icon="three-dots" aria-label={w.moreLabel} {...p}>
                    {w.more}
                  </PortalButton>
                )}
              >
                {more.map((m) => (
                  <a
                    key={m.id}
                    href="#"
                    className="dropdown-item"
                    onClick={(e) => {
                      e.preventDefault();
                      m.run();
                    }}
                  >
                    <Bi name={m.icon} className="me-2" />
                    {m.label}
                  </a>
                ))}
              </Dropdown>
            ) : null}
          </div>
        ) : null}
      </section>

      {needEmail ? (
        <div className="gg-note gg-bill-needemail" role="status">
          <Bi name="envelope-exclamation" />
          <span>{c.needEmail}</span>
          <PortalButton variant="line" onClick={() => navigate('guest.profile')}>
            {c.addEmail}
          </PortalButton>
        </div>
      ) : null}

      <div className="gp-bill-cards">
        <section className="gg-card gp-bill-card" aria-labelledby="gbl-about">
          <h2 id="gbl-about" className="gp-sec-h">
            {c.facts}
          </h2>
          <DetailList
            items={[
              { label: c.billedBy, value: address ? `${seller}, ${address}` : seller },
              gstin ? { label: c.gstin, value: gstin } : null,
              gstin ? { label: 'HSN/SAC', value: bill.sac ?? GST_SAC[bill.business] } : null,
              { label: c.room, value: bill.roomNumber },
              { label: c.stay, value: stayRange(bill.stayFrom, bill.stayTo) },
              persons ? { label: c.persons, value: personNames ? `${persons} · ${personNames}` : persons } : null,
              issued ? { label: c.issued, value: formatDate(bill.issuedOn) } : null,
            ]}
          />
        </section>
        <section className="gg-card gp-bill-card" aria-labelledby="gbl-money">
          <h2 id="gbl-money" className="gp-sec-h">
            {w.money}
          </h2>
          <DetailList
            items={[
              { label: c.subtotal, value: inr(t.subtotalPaise) },
              { label: gstLabel, value: inr(t.gstPaise) },
              { label: c.total, value: inr(t.totalPaise), total: true },
              { label: c.paid, value: `− ${inr(t.paidPaise)}` },
              cancelled ? null : { label: c.balance, value: inr(t.duePaise), total: true },
            ]}
          />
          <p className="gp-bill-words">
            {c.inWords}: {wordsOf(t.totalPaise)}
          </p>
        </section>
      </div>

      <section className="gg-card gp-bill-card" aria-labelledby="gbl-charges">
        <h2 id="gbl-charges" className="gp-sec-h">
          {c.charges} <span className="gp-count">{bill.lines.length}</span>
        </h2>
        {bill.lines.length === 0 ? (
          <DetailNone>{c.noCharges}</DetailNone>
        ) : (
          linesByDay(bill.lines).map((day) => (
            <div key={day.date} className="gp-billday">
              <div className="gp-billday-h">{formatDate(day.date)}</div>
              {day.lines.map((l) => (
                <div key={l.id} className="gp-billline">
                  <span className="gp-billline-txt">
                    <span>{l.label}</span>
                    {l.detail ? <small>{l.detail}</small> : null}
                  </span>
                  <span className="gp-billline-amt">{inr(l.amountPaise)}</span>
                </div>
              ))}
            </div>
          ))
        )}
      </section>

      <section className="gg-card gp-bill-card" aria-labelledby="gbl-payments">
        <h2 id="gbl-payments" className="gp-sec-h">
          {c.payments} <span className="gp-count">{bill.payments.length}</span>
        </h2>
        {bill.payments.length === 0 ? (
          <DetailNone>{c.noPayments}</DetailNone>
        ) : (
          <ol className="pf-timeline">
            {[...bill.payments]
              .sort((x, y) => y.at.localeCompare(x.at))
              .map((pm) => (
                <li key={pm.id}>
                  <span className="pf-tl-dot" aria-hidden="true" />
                  <span className="pf-tl-body">
                    <b>{`${paymentMethodLabel[pm.method]} · ${inr(pm.amountPaise)}`}</b>
                    <small>{`${formatDateTime(pm.at)}${pm.reference ? ` · ${pm.reference}` : ''}`}</small>
                  </span>
                </li>
              ))}
          </ol>
        )}
      </section>

      {/* a direct child of the page (never inside an animated block, which would hold the fixed bar); a phone only: the card has the actions elsewhere */}
      {payable ? (
        <GgActionBar
          label={c.actions}
          summary={online ? `${c.toPay} ${inr(t.duePaise)}` : c.atReception(inr(t.duePaise))}
          action={
            online ? (
              <PortalButton icon="lock" onClick={() => setPaying(true)}>
                {c.pay(inr(t.duePaise))}
              </PortalButton>
            ) : phone ? (
              <PortalButton icon="telephone" onClick={call}>
                {billsCopy.bar.call}
              </PortalButton>
            ) : null
          }
        />
      ) : null}

      {online ? <GuestPaySheet open={paying} bills={[bill]} onClose={() => setPaying(false)} onReceipt={() => navigate('guest.history')} /> : null}

      <GgSheet
        open={pdfAsked && issued}
        title={c.pdfTitle}
        onClose={closePdf}
        footer={
          <>
            <PortalButton variant="line" onClick={closePdf}>
              {billsCopy.pay.cancel}
            </PortalButton>
            <PortalButton
              icon="download"
              onClick={() => {
                closePdf();
                downloadPdf();
              }}
            >
              {c.download}
            </PortalButton>
          </>
        }
      >
        <p className="mb-0">{c.pdfBody}</p>
      </GgSheet>
    </>
  );
}
