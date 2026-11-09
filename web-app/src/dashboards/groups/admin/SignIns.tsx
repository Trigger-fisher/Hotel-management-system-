'use client';

// users/sign-ins.blade.php: Pallav's Sign-in history, the page behind "Sign-in history" on My Profile. Newest first, a day at a time,
// one card per sign-in that opens for the detail; the places seen so far filter the list.
import { useState, type MouseEvent } from 'react';
import { formatDate, formatTime, formatWeekdayDate, istWallClock } from '@shared/dashboards/format';
import type { SignInRecord } from '@shared/dashboards/admin';
import { Bi, Button, Dialog, EmptyState, Pager, SearchField, useTableView, Table } from '@/dashboards/pallav/ui';
import { errorText, useAsync, useDebounced, useToast } from '@/components/ui';
import { Crumbs, PayKpi } from '../payrollCore/pms';
import { adminApi } from './api';
import { Ready } from './pallavParts';
import { clock24, deviceIcon, plural } from './accessLook';

import { tr } from '@/lib/i18n/language';
/** The hotel's day (IST) of a sign-in: "2026-10-10". */
const dayKey = (iso: string) => istWallClock(new Date(iso).getTime()).date;
function dayLabel(iso: string): string {
  return formatWeekdayDate(dayKey(iso));
}

export function SignIns({ initialIp, onBack }: { initialIp: string; onBack: () => void }) {
  const toast = useToast();
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed, 300);
  const [ip, setIp] = useState(initialIp);
  const [version, setVersion] = useState(0);
  const [del, setDel] = useState<SignInRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const { state, reload } = useAsync(() => adminApi.listSignIns({ ip: ip || undefined, search, page: 1, pageSize: 1000 }), [ip, search, version], { keep: true });
  const everything = useAsync(() => adminApi.listSignIns({ page: 1, pageSize: 1 }), [version], { keep: true });
  const devices = useAsync(() => adminApi.listDevices(), [version], { keep: true });

  async function remove() {
    if (!del) return;
    setBusy(true);
    const res = await adminApi.deleteSignIn(del.id);
    setBusy(false);
    setDel(null);
    if (res.ok) {
      toast.show({ tone: 'success', text: 'Sign-in record deleted.' });
      setVersion((v) => v + 1);
    } else toast.show({ tone: 'error', text: errorText(res.error) });
  }

  return (
    <Ready state={state} onRetry={reload}>
      {(d) => (
        <List
          items={d.page.items}
          places={d.places}
          allCount={everything.state.status === 'ready' ? everything.state.data.totals.all : d.totals.all}
          live={devices.state.status === 'ready' ? devices.state.data.length : 1}
          typed={typed}
          setTyped={setTyped}
          searching={search !== ''}
          ip={ip}
          setIp={setIp}
          onBack={onBack}
          onDelete={setDel}
          del={del}
          busy={busy}
          confirm={() => void remove()}
          cancel={() => setDel(null)}
        />
      )}
    </Ready>
  );
}

interface ListProps {
  items: SignInRecord[];
  places: { place: string; count: number }[];
  allCount: number;
  live: number;
  typed: string;
  setTyped: (v: string) => void;
  searching: boolean;
  ip: string;
  setIp: (v: string) => void;
  onBack: () => void;
  onDelete: (r: SignInRecord) => void;
  del: SignInRecord | null;
  busy: boolean;
  confirm: () => void;
  cancel: () => void;
}

function List({ items, places, allCount, live, typed, setTyped, searching, ip, setIp, onBack, onDelete, del, busy, confirm, cancel }: ListProps) {
  const view = useTableView(items, { perPage: 10 });
  const latest = items[0];
  const days = [...new Set(view.rows.map((r) => dayKey(r.at)))];
  const placeOfIp = (address: string) => places.find((p) => p.place && items.find((i) => i.ip === address)?.place === p.place)?.place ?? '';

  return (
    <>
      <div className="pay-head reveal">
        <div className="ph-text">
          <Crumbs
            trail={[
              { label: 'My profile', icon: 'person-circle', onPress: onBack },
              { label: 'Sign-in history' },
            ]}
          />
          <p className="pms-subtitle">{tr("Every sign-in this account has made, newest first, with where it came from and how long it stayed. Records are kept until you remove them.")}</p>
        </div>
        <div className="ph-actions">
          <SearchField wrapClass="log-search" clear value={typed} onChange={setTyped} placeholder={tr("Address, place, browser or date…")} label={tr("Search sign-ins")} />
        </div>
      </div>

      <div className="kpi-grid">
        <PayKpi icon="box-arrow-in-right" tone="month" label={tr("Sign-ins")} value={items.length} chip={ip ? `From ${ip}` : 'From every address'} />
        <PayKpi icon="geo-alt" tone="in" label={tr("Places used")} value={places.length} chip={places.length === 1 ? 'One address so far' : 'Different addresses so far'} />
        <PayKpi icon="laptop" tone="due" label={tr("Signed in now")} value={live} chip={live === 1 ? 'This device only' : 'Devices holding a session'} />
        <div className="kpi reveal">
          <div className="kpi-top">
            <span className="kpi-icon out">
              <Bi name="clock-history" />
            </span>
            <span className="kpi-label">{tr("Latest sign-in")}</span>
          </div>
          {latest ? (
            <>
              <div className="kpi-value sh-kpi-small">
                {dayLabel(latest.at)} {tr("·")} {clock24(latest.at)}
              </div>
              <div className="kpi-foot">
                <span className="kpi-chip">{latest.place}</span>
              </div>
            </>
          ) : (
            <>
              <div className="kpi-value sh-kpi-small">{tr("None yet")}</div>
              <div className="kpi-foot">
                <span className="kpi-chip">{tr("Nothing recorded")}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* The addresses seen so far, each one a filter for the list below */}
      {places.length || ip ? (
        <div className="pay-toolbar reveal">
          <a className={`pf-place ${ip ? '' : 'active'}`} href="#" onClick={go(() => setIp(''))}>
            <Bi name="collection" />
            <span>
              {tr("All addresses")}<small>{allCount} {tr("sign-ins")}</small>
            </span>
          </a>
          {[...new Set(items.map((i) => i.ip))].map((address) => {
            const times = items.filter((i) => i.ip === address).length;
            return (
              <a key={address} className={`pf-place ${ip === address ? 'active' : ''}`} href="#" onClick={go(() => setIp(address))}>
                <Bi name="hdd-network" />
                <span>
                  {address}
                  <small>
                    {items.find((i) => i.ip === address)?.place || placeOfIp(address)} {tr("·")} {times}
                  </small>
                </span>
              </a>
            );
          })}
          <div className="toolbar-end">
            <span className="text-muted fs-sm">
              {plural(items.length, 'sign-in')}
              {searching ? tr(" match") : ''}
            </span>
          </div>
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="card reveal">
          <EmptyState
            icon="clock-history"
            title={searching ? 'No sign-in matches that search' : ip ? 'Nothing from that address' : 'No sign-ins recorded yet'}
            text={
              searching
                ? 'Try a different word: an address like 203.0.113.24, a place like Rajkot, a browser like Chrome, or a date like 27-09-2026.'
                : ip
                  ? 'That address has nothing left in the history. Every other sign-in is still listed.'
                  : 'Each time this account signs in, the time, the place and the browser are kept here.'
            }
          >
            {searching || ip ? (
              <a
                className="btn btn-outline-p mt-3"
                href="#"
                onClick={go(() => {
                  setTyped('');
                  setIp('');
                })}
              >
                {tr("Show everything")}
              </a>
            ) : null}
          </EmptyState>
        </div>
      ) : (
        <>
          {days.map((key) => {
            const group = view.rows.filter((r) => dayKey(r.at) === key);
            return (
              <div key={key} className="sh-day reveal">
                <div className="sh-day-head">
                  <span>{dayLabel(group[0]?.at ?? '')}</span>
                  <span className="sh-day-meta">{plural(group.length, 'sign-in')}</span>
                </div>
                {group.map((r) => (
                  <Card key={r.id} r={r} onOnlyThis={() => setIp(r.ip)} onDelete={() => onDelete(r)} />
                ))}
              </div>
            );
          })}
          {items.length > 10 ? (
            <div className="card sh-pager-card">
              <Pager server view={view} />
            </div>
          ) : null}
        </>
      )}

      <Dialog open={del !== null} tone="danger" title={tr("Remove this sign-in?")} message={del ? `The record of ${formatDate(del.at)} at ${clock24(del.at)} is deleted for good.` : ''} confirmLabel="Remove it" busy={busy} onConfirm={confirm} onCancel={cancel} />
    </>
  );
}

function Card({ r, onOnlyThis, onDelete }: { r: SignInRecord; onOnlyThis: () => void; onDelete: () => void }) {
  const open = !r.ended && r.result === 'success';
  const stayed = r.endedAt ? duration(r.at, r.endedAt) : open ? 'Open now' : '-';
  const failed = r.result === 'failed';
  return (
    <details className={`sh-card si-card ${open ? 'is-live' : ''}`}>
      <summary>
        <div className="sh-when">
          <span className="sh-time">{clock24(r.at)}</span>
          <span className="sh-shift">{formatDate(r.at)}</span>
        </div>

        <div className="sh-cols si-cols">
          <div className="sh-col">
            <span className="sh-lab">{tr("Stayed")}</span>
            <span className="sh-val">{failed ? (r.username ? `Failed attempt · ${r.username}` : tr("Failed attempt")) : stayed}</span>
          </div>
          <div className="sh-col">
            <span className="sh-lab">{tr("Address")}</span>
            <span className="sh-val">{r.ip || tr("Not recorded")}</span>
          </div>
          <div className="sh-col">
            <span className="sh-lab">
              <Bi name="geo-alt" /> {tr("Location")}
            </span>
            <span className="sh-val text" title={r.place}>
              {r.place}
            </span>
          </div>
          <div className="sh-col">
            <span className="sh-lab">{tr("Device")}</span>
            <span className="sh-val text" title={r.device}>
              <Bi name={deviceIcon(r.device)} /> {r.device}
            </span>
          </div>
        </div>

        <div className="sh-cash si-ago">
          <small>{open ? tr("Signed in") : failed ? tr("Refused") : tr("Ended")}</small>
          <strong>{formatTime(r.endedAt && !open ? r.endedAt : r.at)}</strong>
        </div>

        <Bi name="chevron-down" className="sh-caret" />
      </summary>

      <div className="sh-body">
        <div className="sh-body-grid">
          <div>
            <h6 className="sh-h">
              <Bi name="clock" /> {tr("When")}
            </h6>
            <Table className="sh-count-table">
              <tbody>
                <tr>
                  <td>{tr("Signed in")}</td>
                  <td className="text-muted" />
                  <td className="text-end">
                    {formatDate(r.at)} {tr("·")} {clock24(r.at)}
                  </td>
                </tr>
                <tr>
                  <td>{tr("Signed out")}</td>
                  <td className="text-muted" />
                  <td className="text-end">{r.endedAt ? `${formatDate(r.endedAt)} · ${clock24(r.endedAt)}` : open ? tr("Not yet") : '-'}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>{tr("Time logged in")}</td>
                  <td className="text-end">{stayed === 'Open now' ? '-' : stayed}</td>
                </tr>
              </tfoot>
            </Table>
          </div>

          <div>
            <h6 className="sh-h">
              <Bi name="geo-alt" /> {tr("Where from")}
            </h6>
            <ul className="sh-points">
              <li>
                <strong>{r.place}</strong>
              </li>
              <li>{tr("Address")} {r.ip || tr("not recorded")}</li>
              <li>{r.device}</li>
            </ul>

            <h6 className="sh-h mt-3">
              <Bi name="window" /> {tr("Browser")}
            </h6>
            <div className="si-agent">
              <code>{r.userAgent || tr("No browser recorded for this sign-in")}</code>
            </div>
          </div>
        </div>

        <div className="sh-actions">
          <span className="text-muted small me-auto">{open ? tr("This session is still running, so it stays until it ends.") : tr("Kept until you remove it.")}</span>
          {r.ip ? (
            <a className="btn btn-sm btn-outline-p" href="#" onClick={go(onOnlyThis)}>
              <Bi name="funnel" /> {tr("Only this address")}
            </a>
          ) : null}
          {!open ? (
            <form
              className="d-inline"
              onSubmit={(e) => {
                e.preventDefault();
                onDelete();
              }}
            >
              <Button type="submit" variant="danger" size="sm" icon="trash">
                {tr("Delete")}
              </Button>
            </form>
          ) : null}
        </div>
      </div>
    </details>
  );
}

/** Pallav writes these as links (`<a href>`); here the click runs the filter instead of loading a page. */
function go(run: () => void) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    run();
  };
}

function duration(from: string, to: string): string {
  const mins = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000));
  return mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} m` : `${mins} m`;
}
