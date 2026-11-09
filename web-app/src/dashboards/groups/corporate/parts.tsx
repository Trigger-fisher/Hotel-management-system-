'use client';

// The bill's invoice preview (the real PDF comes with the backend).
import { billSac } from '@shared/dashboards/billing';
import { billTotalPaise, type BillDetail, type CompanyProfile } from '@shared/dashboards/corporate';
import { corporateCopyByLanguage } from '@shared/dashboards/corporate.lang';
import { formatDate } from '@shared/dashboards/format';

import { wordsOf } from '@/dashboards/pallav/ui';
import { tr, useCopy } from '@/lib/i18n/language';
import { inr, PtDoc } from '../portal/parts';

function DocTop({ company, docTitle, meta }: { company: CompanyProfile; docTitle: string; meta: string[] }) {
  const c = useCopy(corporateCopyByLanguage);
  const by = company.billedBy;
  return (
    <>
      <div className="cp-doc-top">
        <div className="pt-row-main">
          <div className="pt-row-title">{by.name}</div>
          <div className="pt-row-sub">
            {by.address} {tr('· GSTIN')} {by.gstin} · {by.phone} · {by.email}
          </div>
        </div>
        <div className="cp-doc-meta">
          <div className="pt-row-title">{docTitle}</div>
          <div className="pt-row-sub">{meta.filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      <div className="pt-row-sub my-2">
        {c.preview.billTo}: <b>{company.name}</b> · {company.address}, {company.city}, {company.state} {company.pincode} {tr('· GSTIN')} {company.gstin}
      </div>
    </>
  );
}

export function InvoicePreview({ detail, open, onClose }: { detail: BillDetail; open: boolean; onClose: () => void }) {
  const c = useCopy(corporateCopyByLanguage);
  const { bill, company } = detail;
  const sac = billSac(bill);
  const items: [string, number, string][] = [
    [`Room tariff: ${bill.roomType ?? 'Room'} ${bill.roomNumber ?? ''}, ${bill.nights} ${bill.nights === 1 ? 'night' : 'nights'}`, bill.roomTariffPaise, sac.hotel],
    [`${c.bill.discount} (${company.discountPct}%)`, -bill.discountPaise, sac.hotel],
    [c.bill.laundry, bill.laundryPaise, sac.hotel],
    [`${c.bill.gst} on stay (12%)`, bill.hotelGstPaise, sac.hotel],
    [c.bill.food, bill.foodPaise, sac.food],
    [`${c.bill.gst} on food (5%)`, bill.foodGstPaise, sac.food],
  ];
  const total = billTotalPaise(bill);
  return (
    <PtDoc open={open} title={`${c.preview.taxInvoice} ${bill.billNumber}`} note={c.preview.pdfNote} onClose={onClose}>
      <DocTop company={company} docTitle={c.preview.taxInvoice} meta={[`Bill ${bill.billNumber}`, formatDate(bill.billDate), `Guest: ${bill.guestName}`]} />
      <div className="pt-card pt-table-wrap">
        <table className="pt-led">
          <thead>
            <tr>
              <th>{tr('Description')}</th>
              <th>HSN/SAC</th>
              <th className="num">{tr('Amount')}</th>
            </tr>
          </thead>
          <tbody>
            {items
              .filter(([, p]) => p !== 0)
              .map(([label, p, code]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td>{code}</td>
                  <td className="num">{p < 0 ? `− ${inr(-p)}` : inr(p)}</td>
                </tr>
              ))}
            <tr className="carry">
              <td colSpan={2}>{c.bill.total}</td>
              <td className="num">{inr(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="pt-row-sub mt-2">
        {c.preview.amountInWords}: {wordsOf(total)}
      </div>
    </PtDoc>
  );
}
