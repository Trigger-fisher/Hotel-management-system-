'use client';

// Possible duplicates (Super Admin only, the last area of Central): common guest or company profiles that share a mobile, email or GSTIN across hotels.
// Pick the profile that stays and merge (bills, stays and the hotels' own details are not touched), or mark them not the same (Show again undoes it).
import { useState } from 'react';

import { formatDate } from '@shared/dashboards/format';
import { platformCopy } from '@shared/dashboards/platform';
import {
  profileReviewCopy as T,
  type DuplicateGroup,
  type DuplicatePage,
  type ProfileKind,
  type ReviewProfile,
} from '@shared/dashboards/profileReview';
import { createProfileReviewMock } from '@shared/dashboards/profileReview.mock';

import type { ScreenProps } from '../../types';
import { useAction, useDebounced } from '@/components/ui';
import { createHttpProfileReviewApi } from '@/lib/api/adapters/profileReview';
import { chooseApi } from '@/lib/api/mode';
import { Bi, Button, DetailList, Dialog, EmptyState, Field, ListTabs, Modal, SearchField } from '@/dashboards/pallav/ui';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';
import { SuperOnlyCard } from './PlatformStaff';

import { tr, trf } from '@/lib/i18n/language';
const api = chooseApi(createHttpProfileReviewApi, createProfileReviewMock, { guard: false });
const P = platformCopy.duplicatesPage;

const PAGE_SIZE = 10;
const REASON_MIN = 3;
const REASON_MAX = 300;

type MergeAsk = { group: DuplicateGroup; keep: ReviewProfile; others: ReviewProfile[] };

export function PlatformDuplicatesScreen(props: ScreenProps) {
  if (props.user.role !== 'super_admin') return <SuperOnlyCard />;
  return <DuplicatesBody />;
}

const loginCount = (list: ReviewProfile[]): number => list.filter((p) => p.hasLogin).length;

export function DuplicatesBody() {
  const [kind, setKind] = useState<ProfileKind>('guest');
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed.trim(), 250);
  const [version, setVersion] = useState(0);
  const key = `${kind}|${search}|${version}`;
  const first = useLoaded(() => api.duplicates({ kind, search: search || undefined, page: 1, pageSize: PAGE_SIZE }), [kind, search, version]);
  const [more, setMore] = useState<{ key: string; items: DuplicateGroup[]; page: number } | null>(null);
  const moreNow = more && more.key === key ? more : null;
  const { busy: loadingMore, run: runMore } = useAction();
  const { busy, run } = useAction();
  const [mergeAsk, setMergeAsk] = useState<MergeAsk | null>(null);
  const [apartAsk, setApartAsk] = useState<DuplicateGroup | null>(null);
  const [hidden, setHidden] = useState<{ kind: ProfileKind; pair: [string, string]; text: string }[]>([]);
  const refresh = () => setVersion((n) => n + 1);

  const items = first.data ? [...first.data.items, ...(moreNow?.items ?? [])] : [];
  const total = first.data?.total ?? 0;
  const page = moreNow?.page ?? 1;

  function loadMore() {
    const next = page + 1;
    void runMore(() => api.duplicates({ kind, search: search || undefined, page: next, pageSize: PAGE_SIZE }), {
      onOk: (p: DuplicatePage) => setMore({ key, items: [...(moreNow?.items ?? []), ...p.items], page: next }),
    });
  }

  function keepApart(group: DuplicateGroup) {
    const ids = group.profiles.map((p) => p.id);
    const done = new Set(group.keptApart.map(([a, b]) => `${a}|${b}`));
    const pairs: [string, string][] = [];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.push(ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]]);
    const todo = pairs.filter(([a, b]) => !done.has(`${a}|${b}`));
    if (todo.length === 0) {
      setApartAsk(null);
      return;
    }
    const nameOf = (id: string) => group.profiles.find((p) => p.id === id)?.name ?? P.aProfile;
    void run(
      async () => {
        let last = await api.keepApart({ kind, leftId: todo[0][0], rightId: todo[0][1] });
        for (const [a, b] of todo.slice(1)) {
          if (!last.ok) break;
          last = await api.keepApart({ kind, leftId: a, rightId: b });
        }
        return last;
      },
      {
        success: P.apartDone,
        onOk: () => {
          setApartAsk(null);
          setHidden((h) => [...h, ...todo.map(([a, b]) => ({ kind, pair: [a, b] as [string, string], text: trf("{0} and {1}", [nameOf(a), nameOf(b)]) }))]);
          refresh();
        },
      },
    ).then((ok) => {
      if (!ok) refresh();
    });
  }

  function undo(h: { kind: ProfileKind; pair: [string, string] }) {
    void run(() => api.undoKeepApart({ kind: h.kind, leftId: h.pair[0], rightId: h.pair[1] }), {
      success: P.undoDone,
      onOk: () => {
        setHidden((list) => list.filter((x) => !(x.kind === h.kind && x.pair[0] === h.pair[0] && x.pair[1] === h.pair[1])));
        refresh();
      },
    });
  }

  return (
    <>
      <ListTabs
        className="mb-3"
        label={P.kindLabel}
        active={kind}
        onChange={(id) => setKind(id as ProfileKind)}
        tabs={[
          { id: 'guest', label: T.kind.guest, icon: 'person' },
          { id: 'company', label: T.kind.company, icon: 'building' },
        ]}
      />
      <div className="hm-queue pf-ontheway reveal">
        <div className="hm-q">
          <i className="hm-dot tone-warn" aria-hidden="true" />
          <div className="hm-q-text">
            <b>{P.ruleTitle}</b>
            <small>{T.subtitle}</small>
          </div>
          <span />
        </div>
        {hidden.map((h) => (
          <div key={`${h.kind}|${h.pair[0]}|${h.pair[1]}`} className="hm-q">
            <i className="hm-dot tone-muted" aria-hidden="true" />
            <div className="hm-q-text">
              <b>{h.text}</b>
              <small>{P.hiddenNote}</small>
            </div>
            <Button variant="outline" size="sm" icon="arrow-counterclockwise" disabled={busy} onClick={() => undo(h)}>
              {T.undoKeepApart}
            </Button>
          </div>
        ))}
      </div>
      <div className="pf-toolbar">
        <SearchField wrapClass="pay-toolbar" smart clear value={typed} placeholder={kind === 'guest' ? P.searchGuest : P.searchCompany} label={P.searchLabel} onChange={setTyped} />
        {first.data && items.length > 0 ? <span className="pf-sec-note">{P.count(total)}</span> : null}
      </div>

      {!first.data ? (
        <Wait error={first.error} onRetry={first.reload} tiles={false} rows={3} />
      ) : (
        <>
          <StaleNote error={first.error} onRetry={first.reload} />
          {items.length === 0 ? (
            <div className="card reveal">
              {search ? (
                <EmptyState icon="search" title={P.noMatch} text={P.noMatchText}>
                  <Button variant="outline" className="mt-3" onClick={() => setTyped('')}>
                    {tr("Clear search")}
                  </Button>
                </EmptyState>
              ) : (
                <EmptyState icon="people" title={T.empty} text={kind === 'guest' ? P.noneGuests : P.noneCompanies} />
              )}
            </div>
          ) : (
            <>
              {items.map((g) => (
                <GroupCard key={g.key} group={g} busy={busy} onMerge={setMergeAsk} onApart={setApartAsk} onUndo={(pair) => undo({ kind, pair })} />
              ))}
              {items.length < total ? (
                <div className="pf-more">
                  <Button variant="outline" icon="arrow-down-circle" busy={loadingMore} onClick={loadMore}>
                    {P.loadMore(total - items.length)}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </>
      )}

      {mergeAsk ? (
        <MergeModal
          kind={kind}
          ask={mergeAsk}
          onStale={refresh}
          onClose={() => setMergeAsk(null)}
          onDone={() => {
            setMergeAsk(null);
            refresh();
          }}
        />
      ) : null}

      <Dialog
        open={apartAsk !== null}
        icon="person-x"
        title={P.apartTitle}
        message={P.apartBody}
        confirmLabel={T.keepApart}
        busy={busy}
        onCancel={() => setApartAsk(null)}
        onConfirm={() => apartAsk && keepApart(apartAsk)}
      />
    </>
  );
}

function GroupCard({ group, busy, onMerge, onApart, onUndo }: { group: DuplicateGroup; busy: boolean; onMerge: (a: MergeAsk) => void; onApart: (g: DuplicateGroup) => void; onUndo: (pair: [string, string]) => void }) {
  const [keepId, setKeepId] = useState(group.profiles[0]?.id ?? '');
  const keep = group.profiles.find((p) => p.id === keepId) ?? group.profiles[0];
  const others = group.profiles.filter((p) => p.id !== keep.id);
  const twoLogins = loginCount(group.profiles) > 1;
  const name = (id: string) => group.profiles.find((p) => p.id === id)?.name ?? P.aProfile;

  return (
    <section className="card pf-dup reveal" aria-label={trf("{0}: {1}", [T.by[group.by], group.value])}>
      <header className="pf-dup-head">
        <span className="pf-kind" aria-hidden="true">
          <Bi name="intersect" />
        </span>
        <div className="pf-dup-title">
          <small>{T.by[group.by]}</small>
          <b>{group.value}</b>
        </div>
        <span className="pf-sec-note">{P.profiles(group.profiles.length)}</span>
      </header>

      <div className="pf-dup-grid">
        {group.profiles.map((p) => (
          <ProfileTile key={p.id} profile={p} keeping={p.id === keep.id} groupKey={group.key} onKeep={() => setKeepId(p.id)} />
        ))}
      </div>

      {group.keptApart.length > 0 ? (
        <ul className="pf-dup-apart">
          {group.keptApart.map(([a, b]) => (
            <li key={`${a}|${b}`}>
              <span>{P.markedApart(name(a), name(b))}</span>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => onUndo([a, b])}>
                {T.undoKeepApart}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <footer className="pf-dup-foot">
        <span className="pf-sec-note">{twoLogins ? T.twoLogins : P.keepNote(keep.name)}</span>
        <Button variant="ghost" size="sm" icon="person-x" disabled={busy} onClick={() => onApart(group)}>
          {T.keepApart}
        </Button>
        <Button size="sm" icon="intersect" disabled={busy || twoLogins} onClick={() => onMerge({ group, keep, others })}>
          {T.merge}
        </Button>
      </footer>
    </section>
  );
}

function ProfileTile({ profile: p, keeping, groupKey, onKeep }: { profile: ReviewProfile; keeping: boolean; groupKey: string; onKeep: () => void }) {
  const inputId = `keep-${groupKey}-${p.id}`;
  return (
    <label className={`pf-dup-tile${keeping ? ' keep' : ''}`} htmlFor={inputId}>
      <span className="pf-dup-tile-top">
        <input type="radio" name={`keep-${groupKey}`} id={inputId} checked={keeping} aria-label={trf("Keep {0}", [p.name])} onChange={onKeep} />
        <b>{p.name}</b>
        {p.hasLogin ? (
          <span className="pay-pill pay-paid">
            <Bi name="person-check" />
            {P.hasSignIn}
          </span>
        ) : null}
      </span>
      <DetailList
        items={[
          p.mobile ? { label: P.mobile, value: p.mobile } : null,
          p.email ? { label: P.email, value: p.email } : null,
          p.gstin ? { label: P.gstin, value: p.gstin } : null,
          p.city ? { label: P.city, value: p.city } : null,
          { label: P.created, value: formatDate(p.createdAt) },
          { label: P.appearsIn, value: p.hotels.length ? p.hotels.map((h) => h.hotelName).join(', ') : P.noHotel },
        ]}
      />
      <span className="pf-dup-keep">{keeping ? P.staying : T.keep}</span>
    </label>
  );
}

function MergeModal({ kind, ask, onClose, onDone, onStale }: { kind: ProfileKind; ask: MergeAsk; onClose: () => void; onDone: () => void; onStale: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [sure, setSure] = useState(false);
  const { busy, run } = useAction();
  const trimmed = reason.trim();

  function submit() {
    if (trimmed.length < REASON_MIN) {
      setError(P.reasonShort);
      return;
    }
    setError('');
    setSure(true);
  }

  function confirm() {
    void run(() => api.merge({ kind, keepId: ask.keep.id, mergeIds: ask.others.map((p) => p.id), reason: trimmed }), {
      success: (r) => T.merged(r.merged),
      onFields: (f) => {
        if (f.reason) setError(f.reason);
      },
      onOk: onDone,
    }).then((ok) => {
      if (!ok) {
        setSure(false);
        onStale();
      }
    });
  }

  return (
    <>
      <Modal
        open={!sure}
        onClose={onClose}
        title={trf("{0}: keep {1}", [T.merge, ask.keep.name])}
        size="md"
        staticBackdrop
        onSubmit={submit}
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              {tr("Cancel")}
            </Button>
            <Button type="submit" icon="intersect" busy={busy}>
              {tr("Continue")}
            </Button>
          </>
        }
      >
        <DetailList
          items={[
            { label: P.keeping, value: ask.keep.name },
            { label: P.mergingIn, value: ask.others.map((p) => p.name).join(', ') },
          ]}
        />
        <p className="small text-muted mt-3">{T.mergeNote}</p>
        <div className="row g-3">
          <Field label={P.reason} required error={error}>
            <textarea
              className={`form-control${error ? ' is-invalid' : ''}`}
              placeholder={T.reasonLabel}
              rows={3}
              maxLength={REASON_MAX}
              value={reason}
              aria-invalid={error ? true : undefined}
              onChange={(e) => {
                setReason(e.target.value);
                if (error) setError('');
              }}
            />
            <div className="small text-muted text-end">
              {reason.length}/{REASON_MAX}
            </div>
          </Field>
        </div>
      </Modal>
      <Dialog
        open={sure}
        tone="warning"
        icon="intersect"
        title={P.sureTitle(ask.others.length, ask.keep.name)}
        message={`${T.mergeNote} ${P.noUndo}`}
        confirmLabel={T.merge}
        busy={busy}
        onCancel={() => setSure(false)}
        onConfirm={confirm}
      />
    </>
  );
}
