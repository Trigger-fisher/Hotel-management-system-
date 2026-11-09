'use client';

// platform.archived (Super Admin only): archived hotels with the grace period, one card each. Export data first, Restore inside the grace period,
// Delete permanently (only once the grace period is over and the data was exported; a second step asks for the hotel's address typed exactly).
import { useState } from 'react';

import { formatDate, formatDateTime } from '@shared/dashboards/format';
import { platformCopy, type PlatformArchivedHotel } from '@shared/dashboards/platform';

import type { ScreenProps } from '../../types';
import { useAction, useDebounced } from '@/components/ui';
import { apiMode } from '@/lib/api/mode';
import { Bi, Button, DetailCard, DetailList, Dialog, Dropdown, EmptyState, Field, Modal, PageHead, Pager, SearchField, useTableView } from '@/dashboards/pallav/ui';
import { StaleNote, Wait, useLoaded } from '../payrollCore/load';
import { platformApi } from './api';
import { SuperOnlyCard, actAs } from './PlatformStaff';

const T = platformCopy.archivedHotels;
const V = platformCopy.archivedPage;
type Ask = { kind: 'export' | 'restore' | 'delete'; hotel: PlatformArchivedHotel };

export function PlatformArchivedScreen(props: ScreenProps) {
  if (props.user.role !== 'super_admin') return <SuperOnlyCard />;
  return <ArchivedBody {...props} />;
}

function ArchivedBody({ user, navigate }: ScreenProps) {
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed.trim(), 250);
  const [version, setVersion] = useState(0);
  const { data, error, reload } = useLoaded(() => platformApi.listArchivedHotels({ search }), [search, version]);
  const { busy, run } = useAction();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [typing, setTyping] = useState<PlatformArchivedHotel | null>(null);
  const refresh = () => setVersion((n) => n + 1);
  // the search is the server's; the view only pages the answer (the Pager, as every hotel list)
  const view = useTableView(data ?? [], { perPage: 25 });

  function confirmAsk(a: Ask) {
    if (a.kind === 'delete') {
      setAsk(null);
      setTyping(a.hotel);
      return;
    }
    actAs(user);
    const call =
      a.kind === 'export'
        ? run(() => platformApi.exportHotelData(a.hotel.id), { success: (r) => `${r.message}. ${T.exportFile(r.fileName)}`, onOk: refresh })
        : run(() => platformApi.restoreHotel(a.hotel.id), { success: (r) => r.message, onOk: refresh });
    void call.then(() => setAsk(null));
  }


  return (
    <>
      <PageHead className="reveal" sub={T.subtitle}>
        <SearchField wrapClass="pay-toolbar" smart clear value={typed} placeholder={T.searchPlaceholder} label={T.searchLabel} onChange={setTyped} />
      </PageHead>

      {!data ? (
        <Wait error={error} onRetry={reload} tiles={false} rows={3} />
      ) : (
        <>
          <StaleNote error={error} onRetry={reload} />
          {data.length === 0 ? (
            <div className="card reveal">
              {search ? (
                <EmptyState icon="search" title={T.noMatch.title} text={T.noMatch.body}>
                  <Button variant="outline" className="mt-3" onClick={() => setTyped('')}>
                    {T.clearSearch}
                  </Button>
                </EmptyState>
              ) : (
                <EmptyState icon="archive" title={T.empty.title} text={T.empty.body} />
              )}
            </div>
          ) : (
            <>
              <div className="hm-queue pf-ontheway reveal">
                <div className="hm-q">
                  <i className="hm-dot tone-muted" aria-hidden="true" />
                  <div className="hm-q-text">
                    <b>{V.ruleTitle}</b>
                    <small>
                      {T.exportFirstNote} {apiMode() === 'mock' ? T.exportMockNote : null}
                    </small>
                  </div>
                  <span />
                </div>
              </div>
              <div className="reveal">
                {view.rows.map((h) => (
                  <ArchivedCard key={h.id} h={h} busy={busy} onAsk={(kind) => setAsk({ kind, hotel: h })} onOpen={() => navigate('platform.hotel', { id: h.id })} />
                ))}
              </div>
              <div className="card sh-pager-card">
                <Pager view={view} />
              </div>
            </>          )}
        </>
      )}

      <Dialog
        open={ask !== null}
        tone={ask?.kind === 'delete' ? 'danger' : 'primary'}
        icon={ask ? { export: 'download', restore: 'arrow-counterclockwise', delete: 'trash3' }[ask.kind] : undefined}
        title={ask ? { export: T.exportTitle, restore: T.restoreTitle, delete: T.deleteTitle }[ask.kind](ask.hotel.name) : ''}
        message={ask ? { export: T.exportBody, restore: T.restoreBody, delete: T.deleteBody }[ask.kind] : undefined}
        confirmLabel={ask ? { export: T.exportConfirm, restore: T.restoreConfirm, delete: T.deleteStep1 }[ask.kind] : undefined}
        cancelLabel={T.cancel}
        busy={busy}
        onCancel={() => setAsk(null)}
        onConfirm={() => ask && confirmAsk(ask)}
      />

      {typing ? (
        <DeleteModal
          hotel={typing}
          user={user}
          onClose={() => setTyping(null)}
          onDone={() => {
            setTyping(null);
            refresh();
          }}
        />
      ) : null}
    </>
  );
}

function ArchivedCard({ h, busy, onAsk, onOpen }: { h: PlatformArchivedHotel; busy: boolean; onAsk: (k: Ask['kind']) => void; onOpen: () => void }) {
  const K = V.card;
  const mayDelete = h.daysLeft <= 0 && Boolean(h.exportedAt);
  const deleteRule = h.daysLeft > 0 ? T.deleteInGrace(h.daysLeft) : !h.exportedAt ? T.deleteNeedsExport : T.eligible;
  return (
    <DetailCard
      label={`${K.hotel} ${h.name}`}
      className="pf-hotel"
      warn={h.daysLeft <= 0}
      lead={
        h.daysLeft > 0 ? (
          <span className="pay-pill pay-hold">
            <Bi name="hourglass-split" />
            {T.daysLeft(h.daysLeft, h.graceDays)}
          </span>
        ) : (
          <span className="pay-pill pay-failed">
            <Bi name="calendar-x" />
            {T.graceOver}
          </span>
        )
      }
      facts={[
        { label: K.hotel, value: h.name, sub: `${h.slug} · ${h.city}` },
        { label: K.archived, value: formatDate(h.archivedAt), sub: `${T.columns.by} ${h.archivedBy}` },
        { label: K.reason, value: h.reason ?? undefined, empty: T.noReason },
        { label: K.exported, value: h.exportedAt ? formatDateTime(h.exportedAt) : T.notExported, tone: h.exportedAt ? undefined : 'warn', sub: h.exportFileName ?? undefined },
      ]}
      sections={[
        {
          icon: 'info-circle',
          title: K.next,
          content: (
            <DetailList
              items={[
                { label: T.restore, value: h.canRestore ? K.restoreYes : T.restoreOnlyInGrace },
                { label: T.deleteForever, value: deleteRule },
              ]}
            />
          ),
        },
      ]}
      actions={
        <>
          <Dropdown align="end" button={(p) => <Button variant="ghost" size="sm" icon="three-dots" title={K.moreLabel(h.name)} disabled={busy} {...p}>{K.more}</Button>}>
            <a
              href="#"
              className="dropdown-item"
              onClick={(e) => {
                e.preventDefault();
                onOpen();
              }}
            >
              <Bi name="building" /> {K.open}
            </a>
            {h.exportedAt ? (
              <a
                href="#"
                className="dropdown-item"
                onClick={(e) => {
                  e.preventDefault();
                  onAsk('export');
                }}
              >
                <Bi name="download" /> {T.exportData}
              </a>
            ) : null}
            {mayDelete ? (
              <a
                href="#"
                className="dropdown-item text-danger"
                onClick={(e) => {
                  e.preventDefault();
                  onAsk('delete');
                }}
              >
                <Bi name="trash3" /> {T.deleteForever}
              </a>
            ) : null}
          </Dropdown>
          {!h.exportedAt ? (
            <Button size="sm" icon="download" disabled={busy} onClick={() => onAsk('export')}>
              {T.exportData}
            </Button>
          ) : null}
          {h.canRestore ? (
            <Button size="sm" variant={h.exportedAt ? 'primary' : 'outline'} icon="arrow-counterclockwise" disabled={busy} onClick={() => onAsk('restore')}>
              {T.restore}
            </Button>
          ) : null}
        </>
      }
    />
  );
}

/** Second step of a permanent delete: the hotel's address typed exactly. */
function DeleteModal({ hotel, user, onClose, onDone }: { hotel: PlatformArchivedHotel; user: ScreenProps['user']; onClose: () => void; onDone: () => void }) {
  const [slug, setSlug] = useState('');
  const [error, setError] = useState('');
  const { busy, run } = useAction();
  const matches = slug.trim() === hotel.slug;
  return (
    <Modal
      open
      onClose={onClose}
      title={T.deleteTypeTitle(hotel.name)}
      size="sm"
      staticBackdrop
      onSubmit={() => {
        if (!matches) {
          setError(T.deleteSlugMismatch);
          return;
        }
        actAs(user);
        void run(() => platformApi.deleteHotelPermanently(hotel.id, slug), {
          success: (r) => r.message,
          onFields: (f) => setError(f.confirmSlug ?? ''),
          onOk: onDone,
        });
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {T.cancel}
          </Button>
          <Button type="submit" variant="dangerSolid" busy={busy} disabled={!matches} icon="trash3">{T.deleteConfirm}</Button>
        </>
      }
    >
      <p className="small text-muted">{T.deleteTypeHint}</p>
      <div className="row g-3">
        <Field label={T.deleteTypeLabel(hotel.slug)} required error={error}>
          <input
            className={`form-control${error ? ' is-invalid' : ''}`}
            autoComplete="off"
            spellCheck={false}
            maxLength={60}
            value={slug}
            disabled={busy}
            aria-invalid={error ? true : undefined}
            onChange={(e) => {
              setSlug(e.target.value);
              if (error) setError('');
            }}
          />
        </Field>
      </div>
    </Modal>
  );
}
