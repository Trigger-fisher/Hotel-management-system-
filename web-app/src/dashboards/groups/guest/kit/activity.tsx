'use client';

// A charge or payment row (moved here from guest/parts.tsx, decision 71; parts.tsx re-exports it during the move): Home's recent activity and Payments.
import { formatDate, formatTime } from '@shared/dashboards';
import { guestBusinesses, historyIcon, type HistoryItem } from '@shared/dashboards/guest';
import { guestCopyByLanguage } from '@shared/dashboards/guest.lang';

import { StatusChip } from '@/dashboards/pallav/ui';

import { biOf, inr } from '../../portal/parts';
import { useCopy } from '@/lib/i18n/language';


/** Title, day and business, the amount (a payment is a credit, "− ₹5,000.00") and, with `withStatus`, its status chip. */
export function ActivityRow({ item, withDate, withStatus }: { item: HistoryItem; withDate?: boolean; withStatus?: boolean }) {
  const guestCopy = useCopy(guestCopyByLanguage);
  const c = guestCopy;
  const biz = guestBusinesses[item.business].name;
  const where = item.hotelName?.trim() || biz;
  const when = withDate ? `${formatDate(item.at)}, ${formatTime(item.at)}` : formatTime(item.at);
  const sub = [when, where, item.billNumber ? `${c.history.billRef} ${item.billNumber}` : null].filter(Boolean).join(' · ');
  const credit = item.kind === 'payment';
  const amount = `${credit ? '− ' : ''}${inr(item.amountPaise)}`;
  return (
    <div className="pt-row gg-activity">
      <span className="pt-row-ico">
        <i className={`bi bi-${biOf(historyIcon[item.category])}`} />
      </span>
      <div className="pt-row-main">
        <div className="pt-row-title">{item.title}</div>
        <div className="pt-row-sub">{sub}</div>
      </div>
      {withStatus ? (
        <div className="gg-activity-end">
          <div className={credit ? 'pt-row-amt credit' : 'pt-row-amt'}>{amount}</div>
          <StatusChip look="portal" tone={item.status === 'paid' ? 'ok' : item.status === 'on_bill' ? 'warn' : 'neutral'}>{c.history.status[item.status]}</StatusChip>
        </div>
      ) : (
        <div className={credit ? 'pt-row-amt credit' : 'pt-row-amt'}>{amount}</div>
      )}
    </div>
  );
}
