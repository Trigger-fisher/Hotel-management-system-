'use client';

// The Today page's job tiles and the KPI card strip every page uses (HomeStats, the original .kpi card; look in public/pallav/areas/kit.css).
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Bi } from '@/dashboards/pallav/ui';

import { useMedia } from '@/components/ui';
import { tr, trn } from '@/lib/i18n/language';

export interface HomeJob {
  id: string;
  label: string;
  note: string;
  /** Null when the figure cannot be had: the tile shows without a number rather than a fake one. */
  count: ReactNode | null;
  /** A money figure: drawn smaller than a count. */
  money?: boolean;
  /** The job of the hour (arrivals waiting): a gold edge. */
  hot?: boolean;
  onOpen: () => void;
  /** Set when the read behind the figure failed: the tile offers Try again instead of opening its page. */
  retry?: () => void;
}

export function HomeJobs({ jobs, label }: { jobs: HomeJob[]; label: string }) {
  if (jobs.length === 0) return null;
  return (
    <div className="hm-jobs" role="group" aria-label={trn(label)}>
      {jobs.map((j) =>
        j.retry ? (
          <div key={j.id} className="hm-job no-count failed">
            <b>{trn(j.label)}</b>
            <small>
              {trn(j.note)} · <button type="button" className="btn btn-link btn-sm p-0" onClick={j.retry}>{tr("Try again")}</button>
            </small>
          </div>
        ) : (
          // check-shared-ignore: a job tile (count, name, note) has no kit equivalent
          <button key={j.id} type="button" className={`hm-job${j.hot ? ' hot' : ''}${j.count === null ? ' no-count' : ''}`} onClick={j.onOpen}>
            {j.count !== null && <span className={`hm-job-count${j.money ? ' money' : ''}`}>{j.count}</span>}
            <b>{trn(j.label)}</b>
            <small>{trn(j.note)}</small>
          </button>
        ),
      )}
    </div>
  );
}

/** A figure that counts up from the last one shown (0 at first) over `ms`; still under prefers-reduced-motion. */
export function useCountUp(target: number, ms = 640): number {
  const still = useMedia('(prefers-reduced-motion: reduce)');
  const [shown, setShown] = useState(0);
  const current = useRef(0);
  useEffect(() => {
    if (still || typeof requestAnimationFrame === 'undefined') {
      current.current = target;
      return;
    }
    const from = current.current;
    const start = performance.now();
    let id = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const v = p < 1 ? from + (target - from) * (1 - (1 - p) ** 3) : target;
      current.current = v;
      setShown(v);
      if (p < 1) id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [target, ms, still]);
  return still ? target : shown;
}

export type KpiTone = 'in' | 'out' | 'month' | 'due';

export interface HomeStat {
  id: string;
  label: string;
  value: number;
  format: (n: number) => string;
  /** The one-line detail under the figure. */
  note?: string;
  icon?: string;
  tone?: KpiTone;
  /** Makes the card a link to the page's matching list or filter. */
  onOpen?: () => void;
}

const BAD = /cancel|reject|refus|fail|problem|wrong|locked|suspend|declin|out of order|not sent|error|overdue|past /i;
const WARN = /owe|still|unpaid|outstanding|pending|waiting|\bdue\b|to pay|unread|need|balance|to answer|\bopen\b|unassign|closing|not fully|older|expir|without|empty|not on|bare|never|no backup|stuck|inactive/i;
const GOOD = /paid|receiv|confirm|collect|active|\blive\b|signed in|deposit|healthy|credit|settled|sent|read\b|answered|vacant|clean|ready|taking|done|closed|relieved|rejoined|recovered|running|restore/i;

/** The tile colour a figure's name asks for: red for what went wrong, amber for what waits, green for what is done, graphite for the rest. */
export function kpiTone(label: string, value: number): KpiTone {
  if (BAD.test(label)) return value > 0 ? 'out' : 'month';
  if (WARN.test(label)) return value > 0 ? 'due' : 'month';
  if (GOOD.test(label)) return 'in';
  return 'month';
}

const GLYPHS: [RegExp, string][] = [
  [/room|vacant|occupan|bed/i, 'door-open'],
  [/guest|people|staff|user|admin|customer|account|person|login|profile/i, 'people'],
  [/bill|slip|invoice|receipt/i, 'receipt'],
  [/mail|notice|message|chat|unread|waiting for a reply/i, 'envelope'],
  [/hotel|compan|group/i, 'buildings'],
  [/night|date|today|month|year|day|arriv|leaving/i, 'calendar3'],
  [/photo|gallery/i, 'image'],
  [/money|salary|paid|pay|cash|income|revenue|price|gst|amount|total|owe|balance|advance|credit|billed|received|refund|fee|net/i, 'currency-rupee'],
];
const TONE_GLYPH: Record<KpiTone, string> = { in: 'check2-circle', out: 'x-circle', due: 'hourglass-split', month: 'bar-chart-line' };

export function kpiGlyph(label: string, tone: KpiTone): string {
  for (const [re, g] of GLYPHS) if (re.test(label)) return g;
  return TONE_GLYPH[tone];
}

/** The shared KPI card (the original .kpi: icon tile, label, big figure, one-line detail), as a link when `onOpen` is given. */
export function KpiCard({ label, value, note, tone, icon, num = 0, onOpen, className = '', pressed }: { label: string; value: ReactNode; note?: ReactNode; tone?: KpiTone; icon?: string; num?: number; onOpen?: () => void; className?: string; pressed?: boolean }) {
  const t = tone ?? kpiTone(label, num);
  const body = (
    <>
      <div className="kpi-top">
        <span className={`kpi-icon ${t}`}><Bi name={icon ?? kpiGlyph(label, t)} /></span>
        <span className="kpi-label">{trn(label)}</span>
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-foot">{note ? <span className={`kpi-chip${t === 'out' && num > 0 ? ' down' : ''}${onOpen ? ' link' : ''}`}>{typeof note === 'string' ? trn(note) : note}</span> : null}</div>
    </>
  );
  const cls = `kpi${className ? ` ${className}` : ''}`;
  if (!onOpen) return <div className={cls}>{body}</div>;
  return (
    // check-shared-ignore: the card is the shared kit's own
    <button type="button" className={`${cls} kpi-press`} aria-pressed={pressed} onClick={onOpen}>
      {body}
    </button>
  );
}

function Stat({ stat }: { stat: HomeStat }) {
  const n = useCountUp(stat.value);
  return <KpiCard label={stat.label} value={stat.format(n)} note={stat.note} tone={stat.tone} icon={stat.icon} num={stat.value} onOpen={stat.onOpen} />;
}

export function HomeStats({ stats }: { stats: HomeStat[] }) {
  if (stats.length === 0) return null;
  return (
    <div className={`kpi-grid n-${stats.length > 6 ? 'many' : stats.length}`}>
      {stats.map((s) => <Stat key={s.id} stat={s} />)}
    </div>
  );
}