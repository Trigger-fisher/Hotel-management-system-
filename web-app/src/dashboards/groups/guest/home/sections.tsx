'use client';

// The cards of the guest's Home (decision 71) below the hero: recent activity, past stays, the after-stay rows, the arriving rows, the contact card and the
// advance line. Each draws only what the guest can act on; the Home page (../Home.tsx) picks them for the stage. The look is in guest-home.css.
import { billNumberText, stayRange, type GuestBill, type HistoryItem } from '@shared/dashboards/guest';
import { homeCopyByLanguage } from '@shared/dashboards/guestCopy/home.lang';
import type { StaySummary } from '@shared/dashboards/guestStage';

import { Bi, EmptyState } from '@/dashboards/pallav/ui';

import { inr } from '../../portal/parts';
import { ActivityRow, GgChip, GgRow, HotelInfoCard, telHref, type HotelSite } from '../kit';
import { useCopy } from '@/lib/i18n/language';


type Go = (viewId: string, params?: Record<string, string>) => void;

/** One bill's page, with the bill's own hotel (found whatever the sidebar shows). */
const billParams = (b: GuestBill): Record<string, string> => (b.hotelId ? { id: b.id, hotel: b.hotelId } : { id: b.id });

/** A card head: the title and, at the right, a quiet link to the page that has the rest. */
function CardHead({ id, title, link, onLink, linkLabel }: { id: string; title: string; link?: string; onLink?: () => void; linkLabel?: string }) {
  return (
    <div className="gg-card-head gh-head">
      <h2 id={id}>{title}</h2>
      {link && onLink ? (
        // check-shared-ignore: a card head's "see all" link (the kit's quiet capsule link)
        <button type="button" className="gg-more" onClick={onLink} aria-label={linkLabel}>
          {link} <Bi name="chevron-right" />
        </button>
      ) : null}
    </div>
  );
}

/** The last three charges and payments, with a link to Payments. */
export function RecentActivity({ items, navigate }: { items: HistoryItem[]; navigate: Go }) {
  const homeCopy = useCopy(homeCopyByLanguage);
  const s = homeCopy.sections;
  return (
    <section className="gg-card gh-blk gh-recent" aria-labelledby="gh-recent-title">
      <CardHead id="gh-recent-title" title={s.recentTitle} link={s.recentLink} linkLabel={s.recentLinkLabel} onLink={() => navigate('guest.history')} />
      {items.length === 0 ? (
        <EmptyState look="portal" icon="clock-history" text={s.recentEmpty} />
      ) : (
        <div className="gg-list">
          {items.slice(0, 3).map((item) => (
            <ActivityRow key={item.id} item={item} withDate />
          ))}
        </div>
      )}
    </section>
  );
}

/** Up to three earlier stays (from the bills): hotel, dates and room, what is still to pay there. One bill opens it; more open Bills. */
export function PastStays({ stays, navigate }: { stays: StaySummary[]; navigate: Go }) {
  const homeCopy = useCopy(homeCopyByLanguage);
  const s = homeCopy.sections;
  const shown = stays.slice(0, 3);
  if (shown.length === 0) return null;
  return (
    <section className="gg-card gh-blk gh-past" aria-labelledby="gh-past-title">
      <CardHead id="gh-past-title" title={s.pastTitle} link={s.pastLink} onLink={() => navigate('guest.bills')} />
      <div className="gg-list">
        {shown.map((st) => {
          const owing = st.money.duePaise > 0;
          const only = st.bills.length === 1 ? st.bills[0] : undefined;
          const room = st.roomNumber && st.roomNumber !== '—' ? `Room ${st.roomNumber}` : null;
          return (
            <GgRow
              key={st.key}
              icon="building"
              title={st.hotelName ?? stayRange(st.from, st.to)}
              sub={[st.hotelName ? stayRange(st.from, st.to) : null, room, s.pastBills(st.bills.length)].filter(Boolean).join(' · ')}
              right={
                st.cancelled ? (
                  <GgChip tone="muted">{s.pastCancelled}</GgChip>
                ) : owing ? (
                  <>
                    <span className="gg-amt warn">{inr(st.money.duePaise)}</span>
                    <GgChip tone={st.money.overduePaise > 0 ? 'bad' : 'warn'}>{st.money.overduePaise > 0 ? s.pastOverdue : s.pastToPayChip}</GgChip>
                  </>
                ) : (
                  <GgChip tone="ok">{s.pastPaid}</GgChip>
                )
              }
              tone={owing ? 'warn' : undefined}
              onPress={() => (only ? navigate('guest.bill', billParams(only)) : navigate('guest.bills'))}
            />
          );
        })}
      </div>
    </section>
  );
}

/** After a stay: download the bill, get a statement, call the hotel, review it on Google (only what is known). */
export function AfterStayRows({ bill, phone, reviewUrl, navigate }: { bill: GuestBill | null; phone: string | null; reviewUrl: string | null; navigate: Go }) {
  const homeCopy = useCopy(homeCopyByLanguage);
  const r = homeCopy.rows;
  return (
    <section className="gg-card gh-blk gh-after" aria-label={r.afterStayTitle}>
      <div className="gg-list">
        {bill ? <GgRow icon="file-earmark-arrow-down" title={r.downloadBill} sub={r.downloadBillSub(billNumberText(bill.number))} onPress={() => navigate('guest.bill', billParams(bill))} /> : null}
        <GgRow icon="file-earmark-text" title={r.statement} sub={r.statementSub} onPress={() => navigate('guest.history', { statement: '1' })} />
        {phone ? <GgRow icon="telephone" title={r.callHotel} sub={phone} href={telHref(phone)} /> : null}
        {reviewUrl ? <GgRow icon="star" title={r.googleReview} sub={r.googleReviewSub} href={reviewUrl} external /> : null}
      </div>
    </section>
  );
}

/** Arriving: the menu can be read now; ordering opens at check-in. */
export function ArrivingRows({ navigate }: { navigate: Go }) {
  const homeCopy = useCopy(homeCopyByLanguage);
  const r = homeCopy.rows;
  return (
    <section className="gg-card gh-blk gh-rows" aria-label={r.menu}>
      <div className="gg-list">
        <GgRow icon="cup-hot" title={r.menu} sub={r.menuSub} onPress={() => navigate('guest.order')} />
      </div>
    </section>
  );
}

/** Check-out day: a quiet reminder. */
export function KeyNote() {
  const homeCopy = useCopy(homeCopyByLanguage);
  const r = homeCopy.rows;
  return (
    <p className="gg-note gh-blk gh-keynote">
      <Bi name="key" /> {r.returnKey}
    </p>
  );
}

/** The advance already received for an upcoming booking, in ink (never coral: nothing is owed). */
export function AdvanceCard({ advancePaise }: { advancePaise: number }) {
  const homeCopy = useCopy(homeCopyByLanguage);
  if (advancePaise <= 0) return null;
  return (
    <section className="gg-card gh-blk gh-advance">
      <span className="gh-advance-ico" aria-hidden="true">
        <Bi name="wallet2" />
      </span>
      <span className="gh-advance-txt">
        <strong>{homeCopy.money.advance(inr(advancePaise))}</strong>
        <span>{homeCopy.money.advanceNote}</span>
      </span>
    </section>
  );
}

/**
 * The side card: the hotel's own card when its public facts are known (times, address, Call, Email), else a plain "Need anything?" card with Call reception.
 * Draws nothing when neither is known (never a made-up number).
 */
export function ContactCard({ hotelId, site, phone }: { hotelId: string | null; site: HotelSite | null; phone: string | null }) {
  const homeCopy = useCopy(homeCopyByLanguage);
  const s = homeCopy.sections;
  if (site) return <HotelInfoCard hotelId={hotelId} />;
  if (!phone) return null;
  return (
    <section className="gg-card gh-blk gh-contact" aria-labelledby="gh-contact-title">
      <div className="gg-card-head">
        <h2 id="gh-contact-title">{s.contactTitle}</h2>
        <span className="gg-card-sub">{s.contactSub}</span>
      </div>
      <div className="gg-list">
        <GgRow icon="telephone" title={homeCopy.actions.call} sub={phone} href={telHref(phone)} />
      </div>
    </section>
  );
}
