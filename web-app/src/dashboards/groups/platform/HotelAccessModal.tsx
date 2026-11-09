'use client';

// Platform staff > "Hotel access" (Super Admin only): whether one Platform Admin may view hotels (never change them: full visits are the Super Admin's),
// all hotels or a chosen list, and a written reason for the audit log.
import { useMemo, useState } from 'react';

import { formatDateTime } from '@shared/dashboards/format';
import { platformCopy, type PlatformAdminHotelAccess, type PlatformStaff } from '@shared/dashboards/platform';

import type { ScreenProps } from '../../types';
import { useAction } from '@/components/ui';
import { Button, Field, FieldHint, Modal } from '@/dashboards/pallav/ui';
import { Wait, useLoaded } from '../payrollCore/load';
import { platformApi } from './api';
import { asActor as actAs } from './enter';

const T = platformCopy.platformStaff.hotelAccess;
type Level = PlatformAdminHotelAccess['level'];
const LEVELS: Level[] = ['view', 'none'];

export function HotelAccessModal({ user, staff, onClose, onSaved }: { user: ScreenProps['user']; staff: PlatformStaff; onClose: () => void; onSaved: () => void }) {
  const current = useLoaded(() => {
    actAs(user);
    return platformApi.getPlatformStaffHotelAccess(staff.id);
  }, [staff.id]);
  const hotels = useLoaded(() => platformApi.listHotels({ pageSize: 500 }), []);
  if (!current.data || !hotels.data) {
    return (
      <Modal open onClose={onClose} title={T.title(staff.name)} staticBackdrop footer={<Button variant="ghost" onClick={onClose}>{T.cancel}</Button>}>
        <Wait error={current.error ?? hotels.error} onRetry={() => { current.reload(); hotels.reload(); }} tiles={false} rows={3} />
      </Modal>
    );
  }
  return <AccessForm user={user} staff={staff} start={current.data} hotels={hotels.data.items.map((h) => ({ id: h.id, name: h.name }))} onClose={onClose} onSaved={onSaved} />;
}

function AccessForm({ user, staff, start, hotels, onClose, onSaved }: { user: ScreenProps['user']; staff: PlatformStaff; start: PlatformAdminHotelAccess; hotels: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const [level, setLevel] = useState<Level>(start.level === 'full' ? 'view' : start.level);
  const [allHotels, setAllHotels] = useState(start.allHotels);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(start.hotelIds));
  const [find, setFind] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const shown = useMemo(() => hotels.filter((h) => !find.trim() || h.name.toLowerCase().includes(find.trim().toLowerCase())), [hotels, find]);
  const picking = level !== 'none' && !allHotels;

  const submit = () => {
    actAs(user);
    void run(() => platformApi.setPlatformStaffHotelAccess(staff.id, { level, allHotels, ...(allHotels ? {} : { hotelIds: [...chosen] }), reason: reason.trim() }), {
      success: T.saved(staff.name),
      onFields: (f) => setErrors(f),
      onOk: onSaved,
    });
  };

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={T.title(staff.name)}
      staticBackdrop
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {T.cancel}
          </Button>
          <Button type="submit" icon="door-open" disabled={busy}>
            {busy ? T.saving : T.save}
          </Button>
        </>
      }
    >
      <p className="small text-muted">{T.hint}</p>
      <p className="small text-muted mb-3">{start.updatedAt && start.updatedBy ? T.lastChanged(start.updatedBy, formatDateTime(start.updatedAt)) : T.neverChanged}</p>
      <fieldset disabled={busy}>
        <div className="mb-3" role="radiogroup" aria-label={T.levelLabel}>
          <div className="fw-semibold mb-1">{T.levelLabel}</div>
          {LEVELS.map((l) => (
            <label key={l} className="form-check d-block mb-2">
              <input className="form-check-input" type="radio" name="hotel-access-level" checked={level === l} onChange={() => setLevel(l)} />
              <span className="form-check-label fw-semibold">{T.levels[l]}</span>
              <span className="d-block small text-muted">{T.levelHints[l]}</span>
            </label>
          ))}
          <div className="small text-muted">{T.fullNote}</div>
        </div>

        {level !== 'none' ? (
          <div className="mb-3" role="radiogroup" aria-label={T.hotelsLabel}>
            <div className="fw-semibold mb-1">{T.hotelsLabel}</div>
            <label className="form-check d-block mb-1">
              <input className="form-check-input" type="radio" name="hotel-access-scope" checked={allHotels} onChange={() => setAllHotels(true)} />
              <span className="form-check-label">{T.allHotels}</span>
            </label>
            <label className="form-check d-block mb-2">
              <input className="form-check-input" type="radio" name="hotel-access-scope" checked={!allHotels} onChange={() => setAllHotels(false)} />
              <span className="form-check-label">{T.chosenHotels}</span>
            </label>
            {picking ? (
              <div className={errors.hotelIds ? 'is-invalid' : ''}>
                <input className="form-control mb-2" type="search" value={find} placeholder={T.searchHotels} aria-label={T.searchHotels} onChange={(e) => setFind(e.target.value)} />
                <div className="border rounded p-2" style={{ maxHeight: 180, overflowY: 'auto' }}>
                  {shown.map((h) => (
                    <label key={h.id} className="form-check d-block mb-1">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        checked={chosen.has(h.id)}
                        onChange={(e) => {
                          const next = new Set(chosen);
                          if (e.target.checked) next.add(h.id);
                          else next.delete(h.id);
                          setChosen(next);
                          if (errors.hotelIds) setErrors((p) => ({ ...p, hotelIds: '' }));
                        }}
                      />
                      <span className="form-check-label">{h.name}</span>
                    </label>
                  ))}
                </div>
                <div className="small text-muted mt-1">{T.chooseHotels(chosen.size)}</div>
                {errors.hotelIds ? <div className="invalid-feedback d-block">{errors.hotelIds}</div> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="row g-3">
          <Field label={T.reasonLabel} required error={errors.reason}>
            <textarea
              className={`form-control${errors.reason ? ' is-invalid' : ''}`}
              rows={3}
              maxLength={500}
              required
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (errors.reason) setErrors((p) => ({ ...p, reason: '' }));
              }}
            />
            <FieldHint>{T.reasonHint}</FieldHint>
          </Field>
        </div>
      </fieldset>
    </Modal>
  );
}
