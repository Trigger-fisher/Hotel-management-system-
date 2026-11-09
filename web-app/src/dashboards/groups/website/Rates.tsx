'use client';
// hotel.web.rates (params.room scrolls to one room): rate plans per room category, priced by how many people stay.
import { useEffect, useState } from 'react';

import { formatINR } from '@shared/dashboards/format';
import { validatePlan, type WebRatePlan, type WebRatePlanInput, type WebRoom, type WebRoomRates } from '@shared/dashboards/website';
import { useAction, useAsync, useToast } from '@/components/ui';
import { Bi, DetailCard, DetailList, Dialog, Dropdown, EmptyState, FieldError, FormSection, ListSearch, LoadError, Modal, PageSkeleton, RequiredMark, StatusChip, Button, MayEdit } from '@/dashboards/pallav/ui';
import { HomeStats } from '../overview/HomeJobs';
import type { ScreenProps } from '../../types';
import { webApi } from './api';
import { Linked, Handle, WaNav, paiseOf, rupees, useReorder } from './parts';

import { tr, trf } from '@/lib/i18n/language';
const money = (paise: number) => formatINR(paise, { decimals: false });
const people = (n: number) => (n === 1 ? tr('1 person') : trf('{0} people', [n]));

interface Tier { key: number; guests: string; price: string }
let tierSeq = 0;
const tier = (guests: string, price: string): Tier => ({ key: ++tierSeq, guests, price });

const PRESETS: { name: string; code: string }[] = [
  { name: 'Room only', code: 'EP' },
  { name: 'With breakfast', code: 'CP' },
  { name: 'Breakfast and dinner', code: 'MAP' },
  { name: 'All meals', code: 'AP' },
];

export function WebsiteRates({ params, navigate }: ScreenProps) {
  const { state, reload } = useAsync(() => webApi.listRates(), []);
  const [modal, setModal] = useState<{ room: WebRoom; plan: WebRatePlan | null } | null>(null);
  const [del, setDel] = useState<WebRatePlan | null>(null);
  const { busy, run } = useAction();
  const [typed, setTyped] = useState('');
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  const all = state.status === 'ready' ? state.data : [];
  const blocks = all.filter((b) => words.every((w) => `${b.room.name} ${b.room.size} ${b.room.bedType} ${b.plans.map((p) => `${p.name} ${p.code ?? ''}`).join(' ')}`.toLowerCase().includes(w)));
  const target = params.room;
  const plans = all.flatMap((b) => b.plans);
  const without = all.filter((b) => b.plans.every((p) => !p.active)).length;

  const [landed, setLanded] = useState('');
  if (state.status === 'ready' && target && landed !== target) {
    setLanded(target);
    const b = state.data.find((x) => x.room.id === target);
    if (b && b.plans.length === 0) setModal({ room: b.room, plan: null });
  }
  useEffect(() => {
    if (landed) document.getElementById(`room-${landed}`)?.scrollIntoView({ block: 'start' });
  }, [landed]);

  return (
    <>
      <div className="page-head reveal">
        <div>
          <p className="pms-sub">{tr("Each room category has one or more rate plans, such as Room only and With breakfast. Prices for single days are set in the calendar; guests see today's price.")}</p>
        </div>
        <div className="sh-head-actions">
          {all.length > 3 ? <ListSearch value={typed} onChange={setTyped} onClear={() => setTyped('')} placeholder={tr('Search rooms and plans')} /> : null}
          <Button variant="outline" icon="calendar-week" onClick={() => navigate('hotel.web.calendar')}>{tr('Prices by day')}</Button>
        </div>
      </div>

      <WaNav active="rates" navigate={navigate} />

      {state.status === 'loading' ? (
        <PageSkeleton tiles={false} />
      ) : state.status === 'error' ? (
        <LoadError error={state.error} onRetry={reload} />
      ) : all.length === 0 ? (
        <div className="card reveal">
          <EmptyState icon="tags" title={tr('No room categories yet')} text={tr('Add a room category first, then give it a rate here.')}>
            <Button icon="plus-lg" className="mt-3" onClick={() => navigate('hotel.web.roomForm')}>{tr('Add room category')}</Button>
          </EmptyState>
        </div>
      ) : (
        <div className="ha-stack reveal">
          <HomeStats
            stats={[
              { id: 'rooms', label: tr('Room categories'), value: all.length, format: (n) => String(Math.round(n)), note: tr('On the website') },
              { id: 'live', label: tr('Rate plans'), value: plans.filter((p) => p.active).length, format: (n) => String(Math.round(n)), note: tr('Shown to guests') },
              { id: 'paused', label: tr('Paused'), value: plans.filter((p) => !p.active).length, format: (n) => String(Math.round(n)), note: tr('Hidden from guests') },
              { id: 'none', label: tr('Without a rate'), value: without, format: (n) => String(Math.round(n)), note: without ? tr('Guests cannot book these') : tr('Every room can be booked') },
            ]}
          />
          {blocks.length === 0 ? (
            <div className="card">
              <EmptyState icon="search" title={tr('No room or plan matches that search')} text={tr('Try another word.')}>
                <Button variant="outline" className="mt-3" onClick={() => setTyped('')}>{tr('Clear search')}</Button>
              </EmptyState>
            </div>
          ) : (
            blocks.map((b) => (
              <RoomBlock key={b.room.id} block={b} navigate={navigate} reload={reload} onPlan={(plan) => setModal({ room: b.room, plan })} onDelete={setDel} />
            ))
          )}
        </div>
      )}

      {modal ? <PlanModal key={modal.plan?.id ?? 'new'} room={modal.room} plan={modal.plan} taken={all.find((b) => b.room.id === modal.room.id)?.plans ?? []} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload(); }} /> : null}
      <Dialog
        open={del !== null}
        tone="danger"
        title={trf('Delete {0}?', [del?.name ?? ''])}
        message={tr('This plan and every price set for single days on it are removed for good. To hide it for a while, pause it instead.')}
        confirmLabel="Delete"
        busy={busy}
        onCancel={() => setDel(null)}
        onConfirm={() => {
          const p = del;
          if (p) void run(() => webApi.deletePlan(p.id), { success: 'Deleted.', onOk: () => { setDel(null); reload(); } });
        }}
      />
    </>
  );
}

function RoomBlock({ block, navigate, reload, onPlan, onDelete }: {
  block: WebRoomRates; navigate: ScreenProps['navigate']; reload: () => void; onPlan: (plan: WebRatePlan | null) => void; onDelete: (p: WebRatePlan) => void;
}) {
  const { room, plans, tonightPaise } = block;
  const toast = useToast();
  const order = useReorder(plans, (id, direction) => webApi.movePlan(id, { direction }), reload);
  const live = plans.some((p) => p.active);
  const sub = [room.size, room.bedType, room.showPrice ? tr('Prices shown to guests') : tr('Prices hidden from guests')].filter(Boolean).join(' · ');

  async function toggle(plan: WebRatePlan, undo = false) {
    const res = await webApi.togglePlan(plan.id);
    if (!res.ok) return toast.show({ tone: 'error', text: tr('That did not save. Try again.') });
    reload();
    if (undo) return;
    toast.show({
      tone: 'success',
      text: plan.active ? trf('{0} paused: guests no longer see it.', [plan.name]) : trf('{0} is shown to guests again.', [plan.name]),
      action: { label: 'Undo', onClick: () => void toggle({ ...plan, active: !plan.active }, true) },
    });
  }

  return (
    <section className={`card wr-rates${live ? '' : ' is-warn'}`} id={`room-${room.id}`} aria-labelledby={`room-${room.id}-h`}>
      <div className="wr-rates-head">
        <div className="ha-co-name">
          <h3 id={`room-${room.id}-h`}>{room.name}</h3>
          <small>{sub}</small>
        </div>
        <div className="wr-rates-tonight">
          <small>{tr("Today's rate")}</small>
          <strong>{live ? money(tonightPaise) : <span className="is-warn">{tr('None yet')}</span>}</strong>
        </div>
        <div className="ha-co-acts">
          <Dropdown align="end" button={(p) => <Button variant="ghost" icon="three-dots" aria-label={trf('More for {0}', [room.name])} {...p}>{tr('More')}</Button>}>
            <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); navigate('hotel.web.roomForm', { id: room.id }); }}><Bi name="pencil-square" className="me-2" />{tr('Edit room category')}</a>
          </Dropdown>
          <MayEdit module="website"><Button icon="plus-lg" variant={plans.length ? 'outline' : 'primary'} onClick={() => onPlan(null)}>{plans.length ? tr('Add rate plan') : tr('Add a rate')}</Button></MayEdit>
        </div>
      </div>

      {plans.length === 0 ? (
        <p className="wr-rates-none"><Bi name="exclamation-circle" /> {tr('No rate yet, so guests cannot book this room. Add one: Room only is a good start.')}</p>
      ) : (
        <div className="wr-plans">
          {order.ordered.map((plan) => {
            const from = plan.tiers.length ? Math.min(...plan.tiers.map((t) => t.pricePaise)) : 0;
            return (
              <div className={`wr-plan${order.dragClass(plan.id)}`} key={plan.id} {...order.cardProps(plan.id)}>
                {plans.length > 1 ? <Handle props={order.handleProps(plan.id)} /> : null}
                <DetailCard
                  className={plan.active ? undefined : 'is-off'}
                  label={trf('{0} for {1}', [plan.name, room.name])}
                  lead={{ big: plan.code || '-', tag: plan.active ? tr('Shown') : tr('Paused') }}
                  facts={[
                    { label: tr('Plan'), value: plan.name },
                    ...plan.tiers.slice(0, 2).map((t) => ({ label: people(t.guests), value: money(t.pricePaise) })),
                    { label: tr('Extra person'), value: plan.extraPersonPaise !== null ? money(plan.extraPersonPaise) : '', empty: tr('Not offered') },
                  ]}
                  amount={{ label: tr('From'), value: money(from), tone: plan.active ? 'ok' : 'muted' }}
                  sections={[
                    {
                      icon: 'people',
                      title: tr('Price by number of people'),
                      content: (
                        <DetailList
                          items={[
                            ...plan.tiers.map((t) => ({ key: String(t.guests), label: people(t.guests), value: money(t.pricePaise) })),
                            { key: 'extra', label: tr('Each extra person'), value: plan.extraPersonPaise !== null ? money(plan.extraPersonPaise) : tr('Not offered') },
                          ]}
                        />
                      ),
                    },
                    {
                      icon: 'tag',
                      title: tr('Plan'),
                      content: (
                        <DetailList
                          items={[
                            { label: tr('Name'), value: plan.name },
                            { label: tr('Short code'), value: plan.code },
                            { label: tr('On the website'), value: <StatusChip tone={plan.active ? 'ok' : 'neutral'}>{plan.active ? tr('Shown to guests') : tr('Paused')}</StatusChip> },
                          ]}
                        />
                      ),
                    },
                  ]}
                  actions={
                    <MayEdit module="website">
                      <Button size="sm" variant="outline" icon={plan.active ? 'pause-circle' : 'play-circle'} onClick={() => void toggle(plan)}>{plan.active ? tr('Pause') : tr('Show again')}</Button>
                      <Button size="sm" variant="outline" icon="pencil-square" onClick={() => onPlan(plan)}>{tr('Edit')}</Button>
                      <Dropdown align="end" button={(p) => <Button size="sm" variant="ghost" icon="three-dots" aria-label={trf('More for {0}', [plan.name])} {...p}>{tr('More')}</Button>}>
                        <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); navigate('hotel.web.calendar'); }}><Bi name="calendar-week" className="me-2" />{tr('Prices by day')}</a>
                        <a href="#" className="dropdown-item text-danger" onClick={(e) => { e.preventDefault(); onDelete(plan); }}><Bi name="trash" className="me-2" />{tr('Delete rate plan')}</a>
                      </Dropdown>
                    </MayEdit>
                  }
                />
              </div>
            );
          })}
          {plans.length > 1 ? <p className="wr-rates-hint"><Bi name="grip-vertical" /> {tr('Drag a plan by its handle to change the order guests see.')}</p> : null}
        </div>
      )}
    </section>
  );
}

function PlanModal({ room, plan, taken, onClose, onSaved }: { room: WebRoom; plan: WebRatePlan | null; taken: WebRatePlan[]; onClose: () => void; onSaved: () => void }) {
  const first = PRESETS.find((p) => !taken.some((t) => t.name.toLowerCase() === p.name.toLowerCase()));
  const [name, setName] = useState(plan?.name ?? first?.name ?? '');
  const [code, setCode] = useState(plan?.code ?? first?.code ?? '');
  const startTiers = () => Array.from({ length: Math.min(Math.max(room.maxGuests, 1), 3) }, (_, i) => tier(String(i + 1), ''));
  const [tiers, setTiers] = useState<Tier[]>(plan ? plan.tiers.map((t) => tier(String(t.guests), rupees(t.pricePaise))) : startTiers());
  const [extra, setExtra] = useState(plan?.extraPersonPaise != null ? rupees(plan.extraPersonPaise) : '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const setTier = (key: number, patch: Partial<Tier>) => setTiers((ts) => ts.map((t) => (t.key === key ? { ...t, ...patch } : t)));

  const save = () => {
    const extraPaise = paiseOf(extra);
    const input: WebRatePlanInput = {
      name, code: code.toUpperCase(),
      tiers: tiers.filter((t) => t.price.trim() !== '' || tiers.length === 1).map((t) => ({ guests: Number.parseInt(t.guests, 10) || 0, pricePaise: paiseOf(t.price) ?? 0 })),
      extraPersonPaise: extraPaise && extraPaise > 0 ? extraPaise : null,
    };
    const v = validatePlan(input);
    setErrors(v);
    if (Object.keys(v).length) return;
    void run(() => (plan ? webApi.updatePlan(plan.id, input) : webApi.createPlan(room.id, input)), {
      success: plan ? 'Saved. The website follows straight away.' : trf('{0} added. Guests can now see it.', [name.trim()]),
      onFields: setErrors,
      onOk: onSaved,
    });
  };
  const err = (k: string) => <FieldError>{errors[k]}</FieldError>;

  return (
    <Modal
      open
      className="pay-form-modal"
      staticBackdrop
      eyebrow={room.name}
      title={plan ? trf('Edit {0}', [plan.name]) : tr('Add rate plan')}
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{tr('Cancel')}</Button>
          <Button icon="check2" type="submit" disabled={busy}>{busy ? tr('Saving…') : plan ? tr('Save changes') : tr('Add rate plan')}</Button>
        </>
      }
    >
      <FormSection icon="tag" title={tr('The plan')} hint={tr('What is included. The short code shows on the calendar.')}>
        {!plan ? (
          <div className="wr-presets" role="group" aria-label={tr('Common plans')}>
            {PRESETS.map((p) => (
              <Button key={p.code} size="sm" variant={name === p.name ? 'primary' : 'outline'} onClick={() => { setName(p.name); setCode(p.code); }}>{tr(p.name)}</Button>
            ))}
          </div>
        ) : null}
        <div className="row g-3">
          <Linked className="col-8"><label className="form-label">{tr('Plan name')}<RequiredMark /></label><input className="form-control" maxLength={60} placeholder={tr('e.g. With breakfast')} value={name} onChange={(e) => setName(e.target.value)} />{err('name')}</Linked>
          <Linked className="col-4"><label className="form-label">{tr('Short code')}<RequiredMark /></label><input className="form-control" maxLength={10} placeholder={tr('e.g. CP')} value={code} onChange={(e) => setCode(e.target.value)} />{err('code')}</Linked>
        </div>
      </FormSection>

      <FormSection icon="people" title={tr('Price per night')} hint={trf('By how many people stay. {0} takes up to {1}.', [room.name, room.maxGuests])}>
        <div role="group" aria-label={tr('Price by number of people')}>
          {tiers.map((t) => (
            <div className="wr-tier" key={t.key}>
              <input type="number" inputMode="numeric" className="form-control wr-tier-n" min={1} max={20} value={t.guests} onChange={(e) => setTier(t.key, { guests: e.target.value })} aria-label={tr('Number of people')} />
              <span className="wr-tier-word">{Number.parseInt(t.guests, 10) === 1 ? tr('person') : tr('people')}</span>
              <div className="input-group">
                <span className="input-group-text">₹</span>
                <input type="number" inputMode="decimal" className="form-control" min={0} placeholder={tr('Price')} value={t.price} onChange={(e) => setTier(t.key, { price: e.target.value })} aria-label={trf('Price for {0}', [people(Number.parseInt(t.guests, 10) || 0)])} />
              </div>
              {tiers.length > 1 ? <Button variant="ghost" size="sm" icon="x-lg" aria-label={tr('Remove this price')} onClick={() => setTiers((ts) => ts.filter((x) => x.key !== t.key))} /> : null}
            </div>
          ))}
        </div>
        {err('tiers')}
        <Button variant="ghost" size="sm" icon="plus-lg" onClick={() => setTiers((ts) => [...ts, tier(String((Number.parseInt(ts[ts.length - 1]?.guests ?? '', 10) || 0) + 1), '')])}>{tr('Add a price for more people')}</Button>
        <Linked className="mt-3">
          <label className="form-label">{tr('Each extra person')} <span className="wz-optional">{tr('optional')}</span></label>
          <div className="input-group">
            <span className="input-group-text">₹</span>
            <input type="number" inputMode="decimal" className="form-control" min={0} placeholder={tr('Leave empty if not offered')} value={extra} onChange={(e) => setExtra(e.target.value)} />
          </div>
        </Linked>
      </FormSection>
    </Modal>
  );
}
