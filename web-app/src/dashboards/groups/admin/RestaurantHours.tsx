'use client';

// Settings > Restaurant hours: whether room service takes orders now, and the week's hours as one aligned row per day (Copy to every day saves six edits).
import { useState } from 'react';

import { DAY_NAMES, allDayHours, guestPortalCopy, validateHours, type RestaurantHours } from '@shared/dashboards/guestPortal';
import { formatTime } from '@shared/dashboards/format';

import { errorText, useAsync, useToast } from '@/components/ui';
import { Bi, Button, EmptyState, StatusChip } from '@/dashboards/pallav/ui';
import { restaurantApi } from '../guest/portalApi';

import { tr, trf } from '@/lib/i18n/language';
const c = guestPortalCopy.hours;

const clock = (hhmm: string) => formatTime(`2026-01-01T${hhmm}:00+05:30`);

export function RestaurantHoursCard() {
  const { state, reload } = useAsync(() => restaurantApi.getHours(), []);
  if (state.status === 'loading') return <div className="st-card"><p className="st-about">{tr('Loading…')}</p></div>;
  if (state.status === 'error') return <EmptyState icon="exclamation-triangle" title={errorText(state.error)} text=""><Button variant="outline" className="mt-3" onClick={reload}>{tr('Try again')}</Button></EmptyState>;
  return <HoursForm initial={state.data} />;
}

function HoursForm({ initial }: { initial: RestaurantHours }) {
  const toast = useToast();
  const [saved, setSaved] = useState<RestaurantHours>(initial.days.length === 7 ? initial : { ...allDayHours(), accepting: initial.accepting });
  const [hours, setHours] = useState<RestaurantHours>(saved);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(hours) !== JSON.stringify(saved);
  const setDay = (day: number, patch: Partial<RestaurantHours['days'][number]>) => setHours((h) => ({ ...h, days: h.days.map((d) => (d.day === day ? { ...d, ...patch } : d)) }));
  const copyToAll = (day: number) => {
    const from = hours.days.find((d) => d.day === day);
    if (from) setHours((h) => ({ ...h, days: h.days.map((d) => ({ ...d, closed: from.closed, opens: from.opens, closes: from.closes })) }));
  };

  const save = async () => {
    const found = validateHours(hours);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    const res = await restaurantApi.saveHours(hours);
    setBusy(false);
    if (!res.ok) {
      toast.show({ tone: 'error', text: errorText(res.error) });
      return;
    }
    setHours(res.data);
    setSaved(res.data);
    toast.show({ tone: 'success', text: c.saved });
  };

  return (
    <form
      className="st-card ha-hours"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="st-head">
        <div className="st-icon"><Bi name="cup-hot" /></div>
        <div>
          <h2 className="st-title">{c.title}</h2>
          <p className="st-about">{c.about}</p>
        </div>
      </div>

      <label className={`ha-take${hours.accepting ? '' : ' is-paused'}`} htmlFor="rh-accepting">
        <span className="ha-take-text">
          <b>{c.accepting}</b>
          <small>{c.acceptingHint}</small>
        </span>
        <StatusChip tone={hours.accepting ? 'ok' : 'warn'}>{hours.accepting ? tr('Taking orders') : tr('Paused')}</StatusChip>
        <span className="form-check form-switch m-0">
          <input className="form-check-input" type="checkbox" role="switch" id="rh-accepting" checked={hours.accepting} onChange={(e) => setHours((h) => ({ ...h, accepting: e.target.checked }))} />
        </span>
      </label>

      <div className="ha-week" role="table" aria-label={tr('Hours by day')}>
        <div className="ha-week-row is-head" role="row">
          <span role="columnheader">{tr('Day')}</span>
          <span role="columnheader">{tr('Open')}</span>
          <span role="columnheader">{tr('Hours')}</span>
          <span role="columnheader" className="visually-hidden">{tr('Copy')}</span>
        </div>
        {hours.days.map((d) => {
          const err = errors[`day${d.day}`];
          return (
            <div key={d.day} className={`ha-week-row${d.closed ? ' is-closed' : ''}${err ? ' is-bad' : ''}`} role="row">
              <span role="cell" className="ha-week-day">{DAY_NAMES[d.day]}</span>
              <span role="cell">
                <span className="form-check form-switch m-0">
                  <input className="form-check-input" type="checkbox" role="switch" checked={!d.closed} onChange={(e) => setDay(d.day, { closed: !e.target.checked })} aria-label={trf('{0} open', [DAY_NAMES[d.day]])} />
                </span>
              </span>
              <span role="cell" className="ha-week-hours">
                {d.closed ? (
                  <span className="ha-week-shut">{c.closed}</span>
                ) : (
                  <>
                    <input type="time" className="form-control" aria-label={`${DAY_NAMES[d.day]} ${c.opens}`} value={d.opens} onChange={(e) => setDay(d.day, { opens: e.target.value })} />
                    <span className="ha-week-to">{tr('to')}</span>
                    <input type="time" className="form-control" aria-label={`${DAY_NAMES[d.day]} ${c.closes}`} value={d.closes} onChange={(e) => setDay(d.day, { closes: e.target.value })} />
                    <small className="ha-week-read">{`${clock(d.opens)} - ${clock(d.closes)}`}</small>
                  </>
                )}
                {err ? <span className="ha-week-err" role="alert">{err}</span> : null}
              </span>
              <span role="cell" className="ha-week-copy">
                <Button size="sm" variant="ghost" icon="files" onClick={() => copyToAll(d.day)} title={trf('Use {0} for every day', [DAY_NAMES[d.day]])}>{tr('Copy to every day')}</Button>
              </span>
            </div>
          );
        })}
      </div>

      <div className="st-actions ha-hours-foot">
        <span className="ha-hours-state">{dirty ? tr('Changes not saved yet') : tr('All changes saved')}</span>
        <Button type="submit" icon="check2" busy={busy} disabled={!dirty}>{c.save}</Button>
      </div>
    </form>
  );
}
