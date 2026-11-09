'use client';

// Cash flow chart (Pallav dashboard): grouped bars per day, money in (graphite) beside money out (light grey),
// a y axis in thousands and a short date under each group. Plain SVG; no chart library.
import { useEffect, useRef, useState } from 'react';

import { formatINR } from '@shared/dashboards/format';
import type { TrendDay } from '@shared/dashboards/overview';
import s from './flowChart.module.css';

import { trf } from '@/lib/i18n/language';
const H = 250;
const PAD = { top: 12, right: 8, bottom: 34, left: 46 };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (iso: string) => `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ''}`;

/** A round axis maximum (rupees) so the grid lines land on 10k / 20k / 25k style numbers. */
function niceMax(rupees: number): number {
  if (rupees <= 0) return 10000;
  const steps = [10000, 20000, 25000, 40000, 50000, 80000, 100000, 200000, 250000, 400000, 500000, 1000000, 2000000, 5000000];
  return steps.find((x) => x >= rupees) ?? Math.ceil(rupees / 1000000) * 1000000;
}

const axisText = (rupees: number) => (rupees === 0 ? '0' : rupees >= 100000 ? `${rupees / 100000}L` : `${rupees / 1000}k`);

export function FlowChart({ days, inLabel, outLabel }: { days: TrendDay[]; inLabel: string; outLabel: string }) {
  // drawn at the width it has, so the axis and the dates keep their size on a phone
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => { if (e) setW(Math.max(280, Math.round(e.contentRect.width))); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const max = niceMax(Math.max(...days.flatMap((d) => [d.inPaise, d.outPaise]), 0) / 100);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const group = plotW / Math.max(days.length, 1);
  const bar = Math.min(18, group * 0.3);
  const y = (rupees: number) => PAD.top + plotH - (rupees / max) * plotH;
  const ticks = [0, 1, 2, 3, 4].map((i) => (max / 4) * i);
  // Keep the date labels from touching: show every n-th one.
  const every = group >= 40 ? 1 : group >= 22 ? 2 : 4;
  const total = days.reduce((n, d) => n + d.inPaise + d.outPaise, 0);

  return (
    <div ref={box} className={s.flowChart}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={trf("{0} and {1}, {2} days, {3} in total", [inLabel, outLabel, days.length, formatINR(total)])} className={s.flowSvg}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className={s.flowGrid} />
            <text x={PAD.left - 8} y={y(t) + 3.5} textAnchor="end" className={s.flowAxis}>
              {axisText(t)}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const x0 = PAD.left + group * i + group / 2;
          const inH = (d.inPaise / 100 / max) * plotH;
          const outH = (d.outPaise / 100 / max) * plotH;
          return (
            <g key={d.date}>
              <title>{`${dayLabel(d.date)}: ${inLabel} ${formatINR(d.inPaise)}, ${outLabel} ${formatINR(d.outPaise)}`}</title>
              <rect x={x0 - bar - 1} y={PAD.top + plotH - inH} width={bar} height={inH} rx={3} className={s.flowIn} />
              <rect x={x0 + 1} y={PAD.top + plotH - outH} width={bar} height={outH} rx={3} className={s.flowOut} />
              {i % every === 0 && (
                <text x={x0} y={H - 12} textAnchor="middle" className={s.flowAxis}>
                  {dayLabel(d.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
