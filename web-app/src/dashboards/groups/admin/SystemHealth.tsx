'use client';

// system/health/{index,errors,feature,_card,_error}.blade.php in Pallav's markup: every feature of the app on one map, how much it is used and
// whether it is working. The Blade's separate pages (error log, one feature) are views of this one screen; "Back" returns to the map.
// Loaded through systemApi (GET /system/health, POST /system/health/checks, GET /system/errors, POST /system/errors/{id}/resolve|reopen).
// A server that does not measure per-feature usage sends no features: the screen then says so in plain words instead of the cards and the map.
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { formatCount } from '@shared/dashboards/format';
import {
  connectionMap, dependentsOf,
  type CheckStatus, type FaultShow, type FeatureStatus, type HealthCheckRow, type HealthFault, type HealthFeature, type SystemHealthOverview,
} from '@shared/dashboards/adminSystem';
import { errorText, useDebounced, useToast } from '@/components/ui';
import { Bi, Button, ListSearch, Pager, Select, pagerView, Table } from '@/dashboards/pallav/ui';
import type { ScreenProps } from '../../types';
import { Wait, StaleNote, useLoaded } from '../payrollCore/load';
import { systemApi, systemNow } from './systemApi';

import { tr, trf } from '@/lib/i18n/language';
type View = { page: 'index' } | { page: 'errors'; feature: string; show: FaultShow } | { page: 'feature'; key: string };

const STATUS_WORD: Record<FeatureStatus, string> = { healthy: 'Working', degraded: 'Degraded', down: 'Down', idle: 'Unused' };
const CHECK_WORD: Record<CheckStatus, string> = { ok: 'Working', warn: 'Warning', down: 'Down' };
const BANNER_WORD = { healthy: 'All systems working', degraded: 'Some features need attention', down: 'Something is down' };
const BANNER_ICON = { healthy: 'check2-circle', degraded: 'exclamation-triangle', down: 'x-octagon' };

function ago(at: string): string {
  const mins = Math.max(0, Math.round((systemNow() - new Date(at).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const days = Math.round(h / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
const short = (cls: string) => cls.split('\\').pop() ?? cls;
const num = (n: number) => formatCount(n);

/** What the screen knows about the features (none when the server does not measure usage). */
interface Known {
  features: HealthFeature[];
  checks: HealthCheckRow[];
  tables: Record<string, string[]>;
  flows: [string, string, number][];
}
const byKey = (k: Known, key: string) => k.features.find((f) => f.key === key);
const describe = (k: Known, key: string) => byKey(k, key) ?? ({ key, label: key, icon: 'question-circle', status: 'idle' } as HealthFeature);
/** A fault's feature chip: the feature's own page when there is one, else the error log for that feature. */
const featureView = (k: Known, key: string): View => (byKey(k, key) ? { page: 'feature', key } : { page: 'errors', feature: key, show: 'all' });

/** hotel.admin.system */
export function SystemHealth(props: ScreenProps) {
  // Rule 3 (MJ, 5 Nov 2026): the technical view (faults with their traces, timings, the feature map) is the Super Admin's; the hotel sees plain checks.
  if (props.user.role !== 'super_admin') return <PlainHealth />;
  return <TechHealth navigate={props.navigate} />;
}

function TechHealth({ navigate }: { navigate: ScreenProps['navigate'] }) {
  const toast = useToast();
  const [view, setView] = useState<View>({ page: 'index' });
  const [version, setVersion] = useState(0);
  const [checking, setChecking] = useState(false);
  const health = useLoaded(() => systemApi.getHealth(), [version]);

  const go = (v: View) => {
    setView(v);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  };
  async function setDone(id: string, done: boolean) {
    const res = done ? await systemApi.resolveFault(id) : await systemApi.reopenFault(id);
    if (res.ok) toast.show({ tone: 'success', text: res.data.message });
    else toast.show({ tone: 'error', text: errorText(res.error) });
    setVersion((n) => n + 1);
  }
  async function checkNow() {
    setChecking(true);
    const res = await systemApi.runHealthChecks();
    setChecking(false);
    if (res.ok) toast.show({ tone: 'success', text: res.data.message });
    else toast.show({ tone: 'error', text: errorText(res.error) });
    setVersion((n) => n + 1);
  }

  if (!health.data) return <Wait error={health.error} onRetry={health.reload} />;
  const data = health.data;
  const known: Known = { features: data.features, checks: data.checks, tables: data.tables, flows: data.flows };

  const back = (
    <a href="#" onClick={(e) => { e.preventDefault(); go({ page: 'index' }); }}>
      <Bi name="arrow-left" /> {tr("System Health")}
    </a>
  );
  const stale = <StaleNote error={health.error} onRetry={health.reload} />;

  if (view.page === 'errors') return <ErrorLog view={view} known={known} version={version} back={back} setView={go} onDone={setDone} />;
  if (view.page === 'feature') {
    const f = byKey(known, view.key);
    if (f) return <FeaturePage f={f} known={known} version={version} back={back} go={go} onDone={setDone} navigate={navigate} />;
  }
  return <Index data={data} known={known} stale={stale} go={go} onDone={setDone} checking={checking} onCheck={() => void checkNow()} />;
}

/* ------------------------------------------------------------------ pieces */

function Card({ f, go }: { f: HealthFeature; go: (v: View) => void }) {
  return (
    <a className={`hl-card ${f.status}`} href="#" onClick={(e) => { e.preventDefault(); go({ page: 'feature', key: f.key }); }}>
      <div className="hl-card-top">
        <Bi name={f.icon} />
        <strong>{f.label}</strong>
        <span className={`hl-pill ${f.status}`}>{STATUS_WORD[f.status]}</span>
      </div>
      <div className="hl-nums">
        <span><b>{num(f.hits7)}</b>{tr("visits / 7d")}</span>
        <span><b>{f.avgMs !== null ? `${f.avgMs} ms` : '–'}</b>{tr("average")}</span>
        <span><b>{f.errors7}</b>{tr("errors")}</span>
      </div>
      {f.status !== 'healthy' && f.status !== 'idle' && f.reasons[0] ? <p className="why">{f.reasons[0]}</p> : null}
    </a>
  );
}

function Fault({ e, known, go, onDone }: { e: HealthFault; known: Known; go: (v: View) => void; onDone: (id: string, done: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className={`hl-err ${e.resolved ? 'done' : ''}`}>
      <header>
        <strong>{short(e.exception)}</strong>
        <a className="hl-chip" href="#" onClick={(ev) => { ev.preventDefault(); go(featureView(known, e.feature)); }}>
          {describe(known, e.feature).label}
        </a>
        <span className={`hl-pill ${e.resolved ? 'ok' : 'down'}`}>{e.resolved ? tr("Fixed") : tr("Open")}</span>
        <span className="acts">
          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              setBusy(true);
              void onDone(e.id, !e.resolved).finally(() => setBusy(false));
            }}
          >
            <Button variant="outline" size="sm" type="submit" disabled={busy}>
              {e.resolved ? tr("Reopen") : tr("Mark fixed")}
            </Button>
          </form>
        </span>
      </header>
      <p className="msg">{e.message || tr("(no message)")}</p>
      <div className="meta">
        <span><Bi name="arrow-repeat" /> {num(e.occurrences)} {tr("time(s)")}</span>
        <span><Bi name="clock" /> {tr("last")} {ago(e.lastSeen)}</span>
        {e.path ? <span><Bi name="link-45deg" /> {e.method} /{e.path.replace(/^\//, '')}</span> : null}
        {e.userName ? <span><Bi name="person" /> {e.userName}</span> : null}
        {e.file ? <span className="hl-wrap"><Bi name="file-code" /> {e.file}:{e.line}</span> : null}
        {e.resolved ? <span><Bi name="check2" /> {tr("fixed by")} {e.resolvedBy}</span> : null}
      </div>
      {e.trace ? (
        <details>
          <summary>{tr("Stack trace")}</summary>
          <pre>{e.trace}</pre>
        </details>
      ) : null}
    </div>
  );
}

function CheckBox({ c, withUptime }: { c: HealthCheckRow; withUptime?: boolean }) {
  return (
    <div className={`hl-check ${c.status}`}>
      <Bi name={c.icon} />
      <div className="hl-check-body">
        <strong>
          {c.label} <span className={`hl-pill ${c.status}`}>{CHECK_WORD[c.status]}</span>
        </strong>
        <span className="msg">{c.message}</span>
        {withUptime ? (
          <em>
            {c.latencyMs !== null ? `${c.latencyMs} ms ` : ''}· {c.uptime !== null ? `${c.uptime}% up this week` : tr("no results this week yet")}
          </em>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ index */

function Index({ data, known, stale, go, onDone, checking, onCheck }: { data: SystemHealthOverview; known: Known; stale: ReactNode; go: (v: View) => void; onDone: (id: string, done: boolean) => Promise<void>; checking: boolean; onCheck: () => void }) {
  const feats = data.features;
  const measured = feats.length > 0;
  const overall = data.overall;
  const openErrors = data.openErrors;
  const troubled = feats.filter((f) => f.status === 'down' || f.status === 'degraded');
  const down = troubled.filter((f) => f.status === 'down').length;
  const deg = troubled.filter((f) => f.status === 'degraded').length;
  const totalHits = feats.reduce((s, f) => s + f.hits7, 0);
  const mostUsed = [...feats].filter((f) => f.hits30 > 0).sort((a, b) => b.hits30 - a.hits30).slice(0, 8);
  const maxHits = Math.max(1, ...mostUsed.map((f) => f.hits30));
  const leastUsed = [...feats].filter((f) => f.hits30 > 0).sort((a, b) => a.hits30 - b.hits30).slice(0, 6);
  const idle = feats.filter((f) => f.hits30 === 0);
  const map = useMemo(() => connectionMap(feats, data.tables, data.flows), [feats, data.tables, data.flows]);
  const groups = useMemo(() => {
    const m = new Map<string, HealthFeature[]>();
    feats.forEach((f) => m.set(f.group, [...(m.get(f.group) ?? []), f]));
    return [...m.entries()];
  }, [feats]);
  const recent = data.recentErrors.filter((e) => !e.resolved).slice(0, 3);
  // nothing checked or measured yet: a neutral banner, not "Some features need attention"
  const unchecked = !measured && data.checks.length === 0;

  return (
    <div className="hl">
      <div className="page-head reveal">
        <div>
          <p className="pms-sub">{tr("Every feature of the app, how much it is used, and whether it is working. New features appear here by themselves.")}</p>
        </div>
        <div className="sh-head-actions">
          {measured ? (
            <a className="btn btn-outline-p" href="#how-connect" onClick={(e) => { e.preventDefault(); document.getElementById('how-connect')?.scrollIntoView({ behavior: 'smooth' }); }}>
              <Bi name="diagram-3" /> {tr("Flow map")}
            </a>
          ) : null}
          <a className="btn btn-p sh-new" href="#" onClick={(e) => { e.preventDefault(); go({ page: 'errors', feature: '', show: 'open' }); }}>
            <Bi name="bug" /> {tr("Error log")} {openErrors ? `(${openErrors})` : ''}
          </a>
        </div>
      </div>

      {stale}

      <div className={`hl-banner ${unchecked ? '' : overall} reveal`}>
        <span className="big"><Bi name={unchecked ? 'hourglass' : BANNER_ICON[overall]} /></span>
        <div>
          <h2>{unchecked ? tr("Nothing checked yet") : BANNER_WORD[overall]}</h2>
          <p>
            {unchecked ? tr("Check now to see whether the systems underneath are working.") : measured ? `${feats.length} features found · ${num(totalHits)} ${data.usage ? 'recorded actions' : 'visits'} this week` : `${data.checks.length} systems checked`}
            {down ? ` · ${down} down` : ''}
            {deg ? ` · ${deg} degraded` : ''}
            {openErrors ? ` · ${openErrors} open fault(s)` : ''}
          </p>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onCheck(); }}>
          <Button variant="outline" type="submit" icon="arrow-repeat" disabled={checking}>
            {checking ? tr("Checking…") : tr("Check now")}
          </Button>
        </form>
      </div>

      {data.usage ? <p className="text-muted small mt-2">{data.usage.note}</p> : null}

      {troubled.length ? (
        <>
          <div className="hl-section"><h3>{tr("Needs attention")}</h3></div>
          <div className="hl-grid">{troubled.map((f) => <Card key={f.key} f={f} go={go} />)}</div>
        </>
      ) : null}

      <div className="hl-section"><h3>{tr("Systems underneath")}</h3><small>{tr("What the features stand on. A feature goes down with the system it depends on.")}</small></div>
      {data.checks.length ? <div className="hl-checks">{data.checks.map((c) => <CheckBox key={c.name} c={c} withUptime />)}</div> : <p className="text-muted small">{tr("No systems checked yet. Check now to see them.")}</p>}

      {measured ? (
        <>
          <div className="hl-section"><h3>{tr("Usage")}</h3><small>{tr("Last 30 days")}</small></div>
          <div className="hl-two">
            <div className="hl-panel">
              <strong className="hl-panel-title">{tr("Most used")}</strong>
              {mostUsed.length === 0 ? (
                <div className="hl-empty"><Bi name="hourglass-split" />{tr("Nothing has been used yet. Visits are counted from now on.")}</div>
              ) : (
                <ol className="hl-rank">
                  {mostUsed.map((f, i) => (
                    <li key={f.key}>
                      <span className="n">{i + 1}</span>
                      <div>
                        <a href="#" onClick={(e) => { e.preventDefault(); go({ page: 'feature', key: f.key }); }}><Bi name={f.icon} /> {f.label}</a>
                        <div className="hl-bar"><span style={{ width: `${Math.max(2, Math.round((100 * f.hits30) / maxHits))}%` }} /></div>
                      </div>
                      <span className="v">
                        {num(f.hits30)}{' '}
                        {f.trend !== 0 ? <span className={`hl-trend ${f.trend > 0 ? 'up' : 'dn'}`}>{f.trend > 0 ? '▲' : '▼'} {Math.abs(f.trend)}%</span> : null}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <div className="hl-panel">
              <strong className="hl-panel-title">{tr("Least used")}</strong>
              <ol className="hl-rank">
                {leastUsed.length ? (
                  leastUsed.map((f) => (
                    <li key={f.key}>
                      <span className="n"><Bi name={f.icon} /></span>
                      <a href="#" onClick={(e) => { e.preventDefault(); go({ page: 'feature', key: f.key }); }}>{f.label}</a>
                      <span className="v">{num(f.hits30)}</span>
                    </li>
                  ))
                ) : (
                  <li><span /><span className="hl-empty tight">{tr("No data yet.")}</span><span /></li>
                )}
              </ol>
              {idle.length ? (
                <>
                  <p className="hl-note idle">{tr("Never opened in 30 days (")}{idle.length}):</p>
                  <div className="hl-links">
                    {idle.slice(0, 14).map((f) => (
                      <a key={f.key} className="hl-chip" href="#" onClick={(e) => { e.preventDefault(); go({ page: 'feature', key: f.key }); }}>
                        <span className="dotc idle" />{f.label}
                      </a>
                    ))}
                    {idle.length > 14 ? <small className="hl-muted">+{idle.length - 14} {tr("more")}</small> : null}
                  </div>
                </>
              ) : null}
            </div>
          </div>

          <div className="hl-section" id="how-connect"><h3>{tr("How features connect")}</h3><small>{tr("Lines join features that share data or that people move between. Thicker means stronger.")}</small></div>
          <div className="hl-panel">
            {map.edges.length === 0 ? (
              <div className="hl-empty"><Bi name="diagram-3" />{tr("Connections are learned as the app is used: shared database tables and the pages people move between. Use the app and they will appear here.")}</div>
            ) : null}
            <div className="hl-map-wrap">
              <svg className="hl-map" viewBox={`-70 -10 ${map.size + 140} ${map.size + 20}`} role="img" aria-label={tr("Connections between features")}>
                {map.edges.map((e) => (
                  <line key={`${e.a.key}-${e.b.key}`} className={`edge ${e.kinds.includes('data') ? 'data' : 'journey'}`} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} strokeWidth={e.width}>
                    <title>{`${e.a.label} ↔ ${e.b.label} (${e.kinds.join(' + ')})`}</title>
                  </line>
                ))}
                {map.nodes.map((n) => {
                  const right = Math.cos(n.angle) >= 0;
                  const tx = n.x + (right ? 1 : -1) * (n.r + 5);
                  return (
                    <a key={n.key} href="#" className={n.status} onClick={(e) => { e.preventDefault(); go({ page: 'feature', key: n.key }); }}>
                      <g className="node">
                        <title>{trf("{0}: {1} visits in 30 days, {2}", [n.label, num(n.hits), n.status])}</title>
                        <circle className="dot" cx={n.x} cy={n.y} r={n.r} />
                        <text x={tx} y={n.y + 3.5} textAnchor={right ? 'start' : 'end'}>{n.label}</text>
                      </g>
                    </a>
                  );
                })}
              </svg>
            </div>
            <div className="hl-legend">
              <span><i className="data" />{tr("shared data")}</span>
              <span><i className="journey" />{tr("people move between")}</span>
              <span><span className="hl-pill healthy">{tr("Working")}</span></span>
              <span><span className="hl-pill degraded">{tr("Degraded")}</span></span>
              <span><span className="hl-pill down">{tr("Down")}</span></span>
              <span>{tr("Bigger circle = used more")}</span>
            </div>
          </div>

          <div className="hl-section"><h3>{tr("All features")}</h3><small>{tr("Click one to see it on its own")}</small></div>
          {groups.map(([group, items]) => (
            <Fragment key={group}>
              <p className="hl-group">
                {group} <span>({items.length})</span>
              </p>
              <div className="hl-grid">{items.map((f) => <Card key={f.key} f={f} go={go} />)}</div>
            </Fragment>
          ))}
        </>
      ) : (
        <>
          <div className="hl-section"><h3>{tr("Usage")}</h3></div>
          <div className="hl-panel hl-empty">
            <Bi name="bar-chart-line" />
            {tr("This server does not count visits per feature yet, so the usage lists, the feature cards and the map of how features connect are not shown. The checks above and the faults below are live.")}
          </div>
        </>
      )}

      {recent.length ? (
        <>
          <div className="hl-section">
            <h3>{tr("Latest faults")}</h3>
            <a href="#" onClick={(e) => { e.preventDefault(); go({ page: 'errors', feature: '', show: 'open' }); }}>{tr("See all")}</a>
          </div>
          {recent.map((e) => <Fault key={e.id} e={e} known={known} go={go} onDone={onDone} />)}
        </>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ error log */

const FAULT_PAGE = 25;

function ErrorLog({ view, known, version, back, setView, onDone }: { view: Extract<View, { page: 'errors' }>; known: Known; version: number; back: ReactNode; setView: (v: View) => void; onDone: (id: string, done: boolean) => Promise<void> }) {
  // The page belongs to one choice of feature and Open/Fixed/All: another choice starts at page 1.
  const [typed, setTyped] = useState('');
  const search = useDebounced(typed.trim(), 250);
  const choice = `${view.feature}|${view.show}|${search}`;
  const [paging, setPaging] = useState({ choice, page: 1 });
  const page = paging.choice === choice ? paging.page : 1;
  const setPage = (n: number) => setPaging({ choice, page: n });
  const list = useLoaded(() => systemApi.listFaults({ show: view.show, feature: view.feature, search, page, pageSize: FAULT_PAGE }), [view.show, view.feature, search, page, version]);
  const to = (v: Extract<View, { page: 'errors' }>) => setView(v);
  const chip = (key: FaultShow, text: string) => (
    <a key={key} className={`hl-chip ${view.show === key ? 'on' : ''}`} href="#" onClick={(e) => { e.preventDefault(); to({ ...view, show: key }); }}>
      {text}
    </a>
  );
  const data = list.data;
  const features = data ? [...new Set([...data.features, ...(view.feature ? [view.feature] : [])])] : [];
  const shown = data?.page.items ?? [];
  return (
    <div className="hl">
      <div className="page-head reveal">
        <div>
          <p className="pms-sub">{back} {tr("· Each distinct fault once, with how often it happened.")}</p>
        </div>
        <div className="sh-head-actions">
          <ListSearch value={typed} onChange={setTyped} onClear={() => setTyped('')} placeholder={tr("Search faults")} />
          <form className="pay-toolbar" onSubmit={(e) => e.preventDefault()}>
            <Select aria-label={tr("Feature")} value={view.feature} onChange={(e) => to({ ...view, feature: e.target.value })}>
              <option value="">{tr("All features")}</option>
              {features.map((k) => <option key={k} value={k}>{describe(known, k).label}</option>)}
            </Select>
          </form>
        </div>
      </div>
      {!data ? (
        <Wait error={list.error} onRetry={list.reload} tiles={false} />
      ) : (
        <>
          <StaleNote error={list.error} onRetry={list.reload} />
          <div className="hl-links tabs">
            {chip('open', `Open (${data.counts.open})`)}
            {chip('resolved', `Fixed (${data.counts.resolved})`)}
            {chip('all', 'All')}
          </div>
          {shown.length ? shown.map((e) => <Fault key={e.id} e={e} known={known} go={setView} onDone={onDone} />) : (
            <div className="hl-panel hl-empty"><Bi name="shield-check" />{search ? <>{tr("No fault matches that search.")} <a href="#" onClick={(e) => { e.preventDefault(); setTyped(''); }}>{tr("Clear search")}</a></> : view.show === 'open' ? tr("No open faults. Everything that went wrong has been looked at.") : tr("Nothing here.")}</div>
          )}
          {data.page.total > data.page.pageSize ? (
            <div className="card sh-pager-card">
              <Pager server view={pagerView(data.page, { setPage })} sizes={[FAULT_PAGE]} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ one feature */

function FeaturePage({ f, known, version, back, go, onDone, navigate }: { f: HealthFeature; known: Known; version: number; back: ReactNode; go: (v: View) => void; onDone: (id: string, done: boolean) => Promise<void>; navigate: ScreenProps['navigate'] }) {
  const list = useLoaded(() => systemApi.listFaults({ show: 'all', feature: f.key, page: 1, pageSize: 100 }), [f.key, version]);
  const mine = list.data?.page.items ?? [];
  const daily = f.daily;
  const peak = Math.max(1, ...daily.map((x) => x.hits));
  const dependents = dependentsOf(f, known.features);
  const rank = known.features.filter((x) => x.hits30 > 0).sort((a, b) => b.hits30 - a.hits30).findIndex((x) => x.key === f.key) + 1;
  const ranked = known.features.filter((x) => x.hits30 > 0).length;
  const sameData = Object.entries(known.tables)
    .filter(([k]) => k !== f.key)
    .map(([k, t]) => [k, t.filter((x) => x !== 'system_logs' && (known.tables[f.key] ?? []).includes(x))] as const)
    .filter(([, t]) => t.length);
  const tables = known.tables[f.key] ?? [];
  const into = known.flows.filter(([, b]) => b === f.key);
  const out = known.flows.filter(([a]) => a === f.key);
  const link = (k: string, n?: number) => (
    <a key={k} className="hl-chip" href="#" onClick={(e) => { e.preventDefault(); go({ page: 'feature', key: k }); }}>
      <span className={`dotc ${describe(known, k).status}`} />{describe(known, k).label}{n !== undefined ? <> <small>{num(n)}</small></> : null}
    </a>
  );
  const deps = f.depends.map((dep) => known.checks.find((c) => c.name === dep)).filter((c): c is HealthCheckRow => Boolean(c));
  const openMine = mine.filter((e) => !e.resolved).length;

  return (
    <div className="hl">
      <div className="page-head reveal">
        <div>
          <p className="pms-sub">{back} · {f.group}</p>
        </div>
        <div className="sh-head-actions">
          {f.openMenu ? (
            <a className="btn btn-p sh-new" href="#" onClick={(e) => { e.preventDefault(); navigate(f.openMenu as string); }}>
              <Bi name="box-arrow-up-right" /> {tr("Open")} {f.label}
            </a>
          ) : null}
        </div>
      </div>

      <div className={`hl-banner ${f.status === 'healthy' || f.status === 'idle' ? '' : f.status} reveal`}>
        <span className="big"><Bi name={f.icon} /></span>
        <div>
          <h2>{f.label} <span className={`hl-pill ${f.status}`}>{STATUS_WORD[f.status]}</span></h2>
          <p>{f.reasons.length ? f.reasons.join(' · ') : tr("Working normally.")}</p>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi reveal"><div className="kpi-top"><span className="kpi-icon month"><Bi name="cursor" /></span><span className="kpi-label">{tr("Visits (7 days)")}</span></div>
          <div className="kpi-value">{num(f.hits7)}</div>
          <div className="kpi-foot"><span className={`kpi-chip ${f.trend >= 0 ? 'up' : 'down'}`}>{f.trend >= 0 ? '▲' : '▼'} {Math.abs(f.trend)}{tr("% vs last week")}</span></div></div>
        <div className="kpi reveal"><div className="kpi-top"><span className="kpi-icon in"><Bi name="people" /></span><span className="kpi-label">{tr("People (7 days)")}</span></div>
          <div className="kpi-value">{num(f.users7)}</div>
          <div className="kpi-foot"><span className="kpi-chip">{rank ? `Ranks #${rank} of ${ranked}` : tr("Not ranked")}</span></div></div>
        <div className="kpi reveal"><div className="kpi-top"><span className="kpi-icon due"><Bi name="speedometer" /></span><span className="kpi-label">{tr("Average speed")}</span></div>
          <div className="kpi-value">{f.avgMs !== null ? `${f.avgMs} ms` : '–'}</div>
          <div className="kpi-foot"><span className="kpi-chip">{tr("Slowest")} {f.maxMs} {tr("ms")}</span></div></div>
        <div className="kpi reveal"><div className="kpi-top"><span className="kpi-icon out"><Bi name="bug" /></span><span className="kpi-label">{tr("Errors (7 days)")}</span></div>
          <div className="kpi-value">{f.errors7}</div>
          <div className="kpi-foot"><span className={`kpi-chip ${openMine ? 'down' : 'up'}`}>{openMine} {tr("open fault(s)")}</span></div></div>
      </div>

      <div className="hl-two">
        <div className="hl-panel">
          <strong className="hl-panel-title">{tr("Visits per day, last 30 days")}</strong>
          <div className="hl-spark">
            {daily.map((x) => (
              <span key={x.day} className={x.errors ? 'err' : ''} style={{ height: `${x.hits ? Math.max(3, Math.round((100 * x.hits) / peak)) : 2}%` }} title={trf("{0}: {1} visits, {2} errors, {3} ms average", [x.day, x.hits, x.errors, x.avgMs])} />
            ))}
          </div>
          <div className="hl-spark-axis"><span>{daily[0]?.day}</span><span>{tr("red = a day with errors")}</span><span>{tr("Today")}</span></div>
        </div>
        <div className="hl-panel">
          <strong className="hl-panel-title">{tr("Stands on")}</strong>
          <div className="hl-checks one">
            {deps.map((c) => <CheckBox key={c.name} c={c} />)}
          </div>
          {dependents.length ? (
            <>
              <p className="hl-note">{tr("Others that stand on the same systems:")}</p>
              <div className="hl-links">{dependents.map((o) => link(o.key))}</div>
            </>
          ) : null}
        </div>
      </div>

      <div className="hl-section"><h3>{tr("Connected to")}</h3><small>{tr("Learned from the data it uses and where people go next")}</small></div>
      <div className="hl-two">
        <div className="hl-panel">
          <strong className="hl-panel-title"><Bi name="database" /> {tr("Shares data with")}</strong>
          {sameData.length === 0 ? (
            <div className="hl-empty snug"><Bi name="database" />{tr("No other feature uses the same tables yet.")}</div>
          ) : (
            <Table className="hl-table spaced">
              <tbody>
                {sameData.slice(0, 10).map(([k, t]) => (
                  <tr key={k}>
                    <td><span className="hl-chip bare"><span className={`dotc ${describe(known, k).status}`} /><a href="#" onClick={(e) => { e.preventDefault(); go({ page: 'feature', key: k }); }}>{describe(known, k).label}</a></span></td>
                    <td className="muted">{t.slice(0, 4).join(', ')}{t.length > 4 ? ` +${t.length - 4}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {tables.length ? (
            <>
              <p className="hl-note">{tr("Tables it uses:")}</p>
              <div className="hl-links">{tables.map((t) => <span key={t} className="hl-chip">{t}</span>)}</div>
            </>
          ) : null}
        </div>
        <div className="hl-panel">
          <strong className="hl-panel-title"><Bi name="signpost-split" /> {tr("People come from, and go to")}</strong>
          {into.length === 0 && out.length === 0 ? (
            <div className="hl-empty snug"><Bi name="signpost-split" />{tr("No journeys recorded yet.")}</div>
          ) : (
            <>
              <p className="hl-note top">{tr("Before this")}</p>
              <div className="hl-links">{into.length ? into.map(([a, , n]) => link(a, n)) : <small className="hl-muted">{tr("Nothing yet")}</small>}</div>
              <p className="hl-note">{tr("After this")}</p>
              <div className="hl-links">{out.length ? out.map(([, b, n]) => link(b, n)) : <small className="hl-muted">{tr("Nothing yet")}</small>}</div>
            </>
          )}
        </div>
      </div>

      {f.routes.length ? (
        <>
          <div className="hl-section"><h3>{tr("Pages and actions")}</h3><small>{f.routes.length} {tr("routes, found automatically")}</small></div>
          <div className="hl-panel"><div className="hl-links">{f.routes.map((r) => <span key={r} className="hl-chip">{r}</span>)}</div></div>
        </>
      ) : null}

      <div className="hl-section">
        <h3>{tr("Faults")}</h3>
        <a href="#" onClick={(e) => { e.preventDefault(); go({ page: 'errors', feature: f.key, show: 'all' }); }}>{tr("See all")}</a>
      </div>
      {!list.data ? (
        <Wait error={list.error} onRetry={list.reload} tiles={false} rows={2} />
      ) : mine.length ? mine.map((e) => <Fault key={e.id} e={e} known={known} go={go} onDone={onDone} />) : (
        <div className="hl-panel hl-empty"><Bi name="shield-check" />{tr("No faults recorded for this feature.")}</div>
      )}
    </div>
  );
}

/** A hotel session: is each thing the hotel relies on working, in plain words; anything technical goes to the platform team. */
const TECHNICAL = /[A-Z][A-Z0-9]*_[A-Z0-9_]+|:\/\/|\bms\b|\bport\b|\bhost\b|exception|stack/i;
const plainMessage = (msg: string, ok: boolean): string => (ok ? msg : TECHNICAL.test(msg) ? tr('The platform team has been told and is looking at it.') : msg);

function PlainHealth() {
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const [checking, setChecking] = useState(false);
  const health = useLoaded(() => systemApi.getHealth(), [version]);
  if (!health.data) return <Wait error={health.error} onRetry={health.reload} />;
  const data = health.data;
  const troubled = data.features.filter((f) => f.status === 'down' || f.status === 'degraded');
  const bad = data.checks.filter((c) => c.status !== 'ok').length + troubled.length;
  const unchecked = data.checks.length === 0 && data.features.length === 0;
  async function checkNow() {
    setChecking(true);
    const res = await systemApi.runHealthChecks();
    setChecking(false);
    if (res.ok) toast.show({ tone: 'success', text: res.data.message });
    else toast.show({ tone: 'error', text: errorText(res.error) });
    setVersion((n) => n + 1);
  }
  return (
    <div className="hl">
      <div className="page-head reveal">
        <div><p className="pms-sub">{tr('Whether everything your hotel relies on is working. Problems are sent to the platform team by themselves.')}</p></div>
      </div>
      <StaleNote error={health.error} onRetry={health.reload} />
      <div className={`hl-banner ${unchecked ? '' : bad ? 'degraded' : 'healthy'} reveal`}>
        <span className="big"><Bi name={unchecked ? 'hourglass' : bad ? 'exclamation-triangle' : 'check2-circle'} /></span>
        <div>
          <h2>{unchecked ? tr('Nothing checked yet') : bad ? bad === 1 ? tr('1 thing needs attention') : trf('{0} things need attention', [bad]) : tr('Everything is working')}</h2>
          <p>{unchecked ? tr('Check now to see whether everything is working.') : bad ? tr('The platform team has been told. You can keep working; this page updates when it is fixed.') : tr('Mail, payments and the rest are working.')}</p>
        </div>
        <Button type="button" icon="arrow-repeat" disabled={checking} onClick={() => void checkNow()}>{checking ? tr('Checking…') : tr('Check now')}</Button>
      </div>
      {data.checks.length ? (
        <>
          <div className="hl-section"><h3>{tr('What your hotel relies on')}</h3></div>
          <div className="hl-checks">
            {data.checks.map((c) => (
              <div key={c.name} className={`hl-check ${c.status}`}>
                <Bi name={c.icon} />
                <div className="hl-check-body">
                  <strong>{c.label} <span className={`hl-pill ${c.status}`}>{c.status === 'ok' ? tr('Working') : tr('Needs attention')}</span></strong>
                  <span className="msg">{plainMessage(c.message, c.status === 'ok')}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
      {troubled.length ? (
        <>
          <div className="hl-section"><h3>{tr('Pages not working well')}</h3></div>
          <div className="hl-checks">
            {troubled.map((f) => (
              <div key={f.key} className={`hl-check ${f.status === 'down' ? 'down' : 'warn'}`}>
                <Bi name={f.icon} />
                <div className="hl-check-body">
                  <strong>{f.label} <span className={`hl-pill ${f.status}`}>{f.status === 'down' ? tr('Not working') : tr('Slow or failing at times')}</span></strong>
                  <span className="msg">{tr('The platform team has been told and is looking at it.')}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}