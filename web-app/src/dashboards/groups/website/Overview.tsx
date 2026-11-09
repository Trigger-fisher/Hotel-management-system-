'use client';
// hotel.web.overview: the website's Home - jobs that wait (pending enquiries, arrivals, closed dates), the year's figures, arrivals and recent enquiries side by side, then what changed.
import { useState } from 'react';

import { displayPhone, fyLabel, guestsLabel, adultsOf, type WebArrival, type WebEnquiryStatus, type WebOverview } from '@shared/dashboards/website';
import { formatDate, formatDateTime } from '@shared/dashboards/format';
import { useAsync } from '@/components/ui';
import { Bi, EmptyState, LoadError, PageSkeleton, Select, StatusChip } from '@/dashboards/pallav/ui';
import type { ScreenProps } from '../../types';
import { HomeJobs, HomeStats, type HomeJob } from '../overview/HomeJobs';
import { webApi } from './api';
import { WaNav, rangeText } from './parts';

import { tr, trf } from '@/lib/i18n/language';
const STATUS: Record<WebEnquiryStatus, { label: string; tone: 'warn' | 'ok' | 'neutral' }> = { pending: { label: 'Pending', tone: 'warn' }, confirmed: { label: 'Confirmed', tone: 'ok' }, declined: { label: 'Cancelled', tone: 'neutral' } };

export function WebsiteOverview({ navigate }: ScreenProps) {
  const [fy, setFy] = useState<number | undefined>(undefined);
  const { state, reload } = useAsync(() => webApi.getOverview(fy), [fy]);
  const [last, setLast] = useState<WebOverview | null>(null);
  if (state.status === 'ready' && state.data !== last) setLast(state.data);
  const d = state.status === 'ready' ? state.data : last;
  const enquiries = (tab?: string) => navigate('hotel.web.enquiries', tab ? { tab } : {});

  if (!d) {
    return (
      <>
        <div className="page-head reveal">
          <div><p className="pms-sub">{tr('The hotel website: its enquiries, rooms, rates, photos and wording are all managed here.')}</p></div>
        </div>
        <WaNav active="overview" navigate={navigate} />
        {state.status === 'error' ? <LoadError error={state.error} onRetry={reload} /> : <PageSkeleton />}
      </>
    );
  }

  const host = d.siteUrl.replace(/^https?:\/\//, '');
  const jobs: HomeJob[] = [
    { id: 'pending', label: tr('Enquiries to answer'), note: d.stats.pending ? tr('Confirm or cancel each one') : tr('Nothing waits'), count: d.stats.pending, hot: d.stats.pending > 0, onOpen: () => enquiries('pending') },
    { id: 'today', label: tr('Arriving today'), note: d.arrivingToday.length ? tr('Confirmed website bookings') : tr('No one today'), count: d.arrivingToday.length, onOpen: () => enquiries('confirmed') },
    { id: 'blocked', label: tr('Closed to booking'), note: d.blocked.length ? tr('Rooms and dates closed on the site') : tr('Every room is open'), count: d.blocked.length, onOpen: () => navigate('hotel.web.calendar') },
    { id: 'rooms', label: tr('Rooms on the site'), note: trf('{0} gallery photos', [d.facts.photos]), count: d.facts.rooms, onOpen: () => navigate('hotel.web.rooms') },
  ];
  const arrivals: (WebArrival & { when: string })[] = [...d.arrivingToday.map((a) => ({ ...a, when: tr('Today') })), ...d.arrivingWeek.map((a) => ({ ...a, when: formatDate(a.checkIn) }))];

  return (
    <>
      <div className="page-head reveal">
        <div><p className="pms-sub">{tr('Enquiries, rooms, rates, photos and wording of the hotel website.')}</p></div>
        <div className="sh-head-actions">
          <form className="pay-toolbar" onSubmit={(e) => e.preventDefault()}>
            <Select className="form-select" aria-label={tr('Financial year')} value={d.fy} onChange={(e) => setFy(Number(e.target.value))}>
              {d.years.map((y) => (
                <option key={y} value={y}>
                  {fyLabel(y)}
                  {y === d.currentFy ? tr(' (current)') : ''}
                </option>
              ))}
            </Select>
          </form>
        </div>
      </div>

      <WaNav active="overview" navigate={navigate} />
      {state.status === 'error' ? <LoadError error={state.error} onRetry={reload} /> : null}

      <div className="ha-home wo-home" aria-busy={state.status === 'loading' || undefined}>
        <div className="hm-greet">
          <div>
            <h2>{tr('Hotel website')}</h2>
            <p>{host}</p>
          </div>
        </div>

        <HomeJobs jobs={jobs} label={tr('Website jobs')} />

        <HomeStats
          stats={[
            { id: 'all', label: tr('Enquiries'), value: d.stats.all, format: (n) => String(Math.round(n)), note: fyLabel(d.fy) },
            { id: 'confirmed', label: tr('Confirmed'), value: d.stats.confirmed, format: (n) => String(Math.round(n)), note: tr('Became bookings') },
            { id: 'declined', label: tr('Cancelled'), value: d.stats.declined, format: (n) => String(Math.round(n)), note: tr('Not going ahead') },
            { id: 'week', label: tr('Arriving this week'), value: d.arrivingWeek.length, format: (n) => String(Math.round(n)), note: tr('Next 7 days') },
          ]}
        />

        <div className="hm-cols">
          <div className="hm-col">
            <div className="hd-sec"><h3>{trf('Arriving soon · {0}', [arrivals.length])}</h3></div>
            {arrivals.length ? (
              <div className="hm-queue ha-list">
                {arrivals.map((a) => (
                  <div key={`${a.when}-${a.id}`} className="hm-q">
                    <span className="ha-when">{a.when}</span>
                    <div className="hm-q-text">
                      <b title={a.name}>{a.name} <span className="ha-ref">{a.reference}</span></b>
                      <small>{[a.roomName ?? tr('No room'), guestsLabel(adultsOf(a), a.children), a.message].filter(Boolean).join(' · ')}</small>
                    </div>
                    {a.phone ? <a className="btn btn-sm btn-outline-p" href={`tel:${a.phone}`} aria-label={trf('Call {0}', [a.name])}><Bi name="telephone" className="me-1" />{displayPhone(a.phone)}</a> : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="hm-empty"><EmptyState icon="calendar-check" title={tr('No arrivals in the next 7 days')} text={tr('Confirmed website bookings show here.')} /></div>
            )}
          </div>
          <div className="hm-col">
            <div className="hd-sec">
              <h3>{tr('Recent enquiries')}</h3>
              <a href="#" onClick={(e) => { e.preventDefault(); enquiries(); }}>{tr('See all')} <Bi name="arrow-right-short" /></a>
            </div>
            {d.recent.length ? (
              <div className="hm-queue ha-list">
                {d.recent.map((e) => (
                  <div key={e.id} className="hm-q">
                    <StatusChip tone={STATUS[e.status].tone}>{STATUS[e.status].label}</StatusChip>
                    <div className="hm-q-text">
                      <b title={e.name}>{e.name} <span className="ha-ref">{e.reference}</span></b>
                      <small>{`${e.roomName ?? tr('Room not chosen')} · ${formatDate(e.checkIn)} - ${formatDate(e.checkOut)}`}</small>
                    </div>
                    <span className="ha-ref" title={formatDateTime(e.createdAt)}>{formatDate(e.createdAt)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="hm-empty"><EmptyState icon="inbox" title={tr('No enquiries in this year yet')} /></div>
            )}
          </div>
        </div>

        <div className="hm-cols">
          <div className="hm-col">
            <div className="hd-sec">
              <h3>{tr('Closed to booking')}</h3>
              <a href="#" onClick={(e) => { e.preventDefault(); navigate('hotel.web.calendar'); }}>{tr('Calendar')} <Bi name="arrow-right-short" /></a>
            </div>
            {d.blocked.length ? (
              <div className="card ha-card">
                <ul className="ha-items">
                  {d.blocked.map((b) => (
                    <li key={`${b.roomId}-${b.start}`}>
                      <span className="ha-item-main"><b>{b.roomName}</b><small>{rangeText(b)}</small></span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="hm-empty"><EmptyState icon="calendar2-check" title={tr('Nothing is closed right now')} /></div>
            )}
          </div>
          <div className="hm-col">
            <div className="hd-sec"><h3>{tr('Recent changes')}</h3></div>
            {d.changes.length ? (
              <div className="card ha-card">
                <ol className="pf-timeline">
                  {d.changes.map((c) => (
                    <li key={c.id}>
                      <span className="pf-tl-dot" aria-hidden="true" />
                      <div className="pf-tl-body">
                        <b>{c.summary}</b>
                        <small>{`${formatDateTime(c.at)} · ${c.userName || tr('System')}`}</small>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <div className="hm-empty"><EmptyState icon="clock-history" title={tr('Nothing changed yet')} /></div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
