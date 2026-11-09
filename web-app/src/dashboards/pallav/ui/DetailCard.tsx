'use client';

// The expandable list card (MJ, 5 Nov 2026): the Shift Handover card made into one shared piece for every list whose row holds more than it
// shows (handovers, bills, advances, company profiles, reservations, in-house guests). One row of key facts, the full record below.
//
//   <DetailCard
//     lead={{ big: '14:05', tag: 'Morning' }}                           the time / number / name block at the left
//     facts={[{ label: 'Guest', value: 'Amit Joshi', sub: '98xx' }]}   the summary row; long values are cut with the full text in title
//     amount={{ label: 'Total cash', value: formatINR(p) }}             the figure at the right
//     sections={[{ icon: 'cash-coin', title: 'Cash count', content }]} the open body, in a responsive grid
//     meta="Recorded 5 Nov 2026" actions={<Button>Edit</Button>} />
//
// It is a native <details>: it opens without JavaScript and the browser keeps it open across re-renders. The caret turns, the body slides
// open in CSS alone (off under prefers-reduced-motion), the summary has a visible focus ring and the browser says whether it is open. A screen
// reader hears the `label` and then the row's facts and amount, so a bare row never reads as just an id. On a phone the facts stack two per row and
// the amount moves under the lead. Look: `.dc-*` in public/pallav/hms-overrides.css (theme variables only).
import type { ReactNode } from 'react';

import { Bi } from '../Bi';
import { tr, trn } from '@/lib/i18n/language';

export type DetailTone = 'default' | 'ok' | 'warn' | 'danger' | 'info' | 'muted';

/** The block at the left of the row: a big figure (time, room, number), an optional small line and an optional tag under it. */
export interface DetailLead {
  big: ReactNode;
  /** The seconds, the type, the source ... shown smaller inside the big figure. */
  small?: ReactNode;
  tag?: ReactNode;
  title?: string;
  /** Draw the big figure in the muted colour (e.g. no room number). */
  muted?: boolean;
}

export interface DetailFact {
  label: ReactNode;
  /** Empty (null, undefined, '') shows the `empty` word in the muted colour. */
  value?: ReactNode;
  /** A second, smaller line under the value (mobile, GST number). */
  sub?: ReactNode;
  /** The full text when the value may be cut; a string value is its own title. */
  title?: string;
  /** A small count after the label ("Notes 3"). */
  count?: number;
  tone?: DetailTone;
  /** Draw the value lighter, as running text rather than a name or number. */
  text?: boolean;
  /** Takes two columns of the row. */
  wide?: boolean;
  /** The word for an empty value; "None" unless given. */
  empty?: ReactNode;
}

export interface DetailAmount {
  label: ReactNode;
  value: ReactNode;
  /** Small parts under the figure (Hotel ₹x · Food ₹y). */
  sub?: ReactNode;
  tone?: DetailTone;
  /** Anything else under the figure, e.g. a Pay button. */
  extra?: ReactNode;
}

export interface DetailSection {
  icon?: string;
  title: ReactNode;
  count?: number;
  tone?: DetailTone;
  content: ReactNode;
  /** Takes the whole width of the body. */
  wide?: boolean;
  key?: string;
}

export interface DetailCardProps {
  lead: ReactNode | DetailLead;
  facts: DetailFact[];
  amount?: DetailAmount;
  sections?: DetailSection[];
  /** Anything after the sections (a record history, a table). */
  children?: ReactNode;
  /** The small line at the left of the footer: recorded / updated. */
  meta?: ReactNode;
  /** The footer buttons. */
  actions?: ReactNode;
  defaultOpen?: boolean;
  /** Something in this row needs attention: an amber edge. */
  warn?: boolean;
  /** Width of the lead block: 'md' 92px (a time), 'lg' 112px (a room number with a capsule). */
  leadWidth?: 'md' | 'lg';
  /** What the row is, for a screen reader ("Handover 12"); read before the facts, not instead of them. */
  label?: string;
  className?: string;
  id?: string;
}

const isLead = (x: ReactNode | DetailLead): x is DetailLead => typeof x === 'object' && x !== null && !Array.isArray(x) && 'big' in x;
const toneClass = (t?: DetailTone) => (t && t !== 'default' ? ` tone-${t}` : '');
const empty = (v: ReactNode) => v === null || v === undefined || v === '' || v === false;
/** A long name or line takes the whole row on a phone, so it shows in full. */
const isLong = (value: ReactNode, sub: ReactNode) => (typeof value === 'string' && value.length > 22) || (typeof sub === 'string' && sub.length > 28);

export function DetailCard({ lead, facts, amount, sections = [], children, meta, actions, defaultOpen = false, warn = false, leadWidth = 'md', label, className = '', id }: DetailCardProps) {
  const classes = ['dc-card', warn ? 'warn' : '', amount ? '' : 'no-amount', leadWidth === 'lg' ? 'lead-lg' : '', className].filter(Boolean).join(' ');
  return (
    <details id={id} className={classes} open={defaultOpen || undefined}>
      {/* no aria-label here: a summary is a button, whose name would then hide every fact in the row */}
      <summary className="dc-sum">
        {label && <span className="visually-hidden">{label}: </span>}
        <div className="dc-lead" title={isLead(lead) ? lead.title : undefined}>
          {isLead(lead) ? (
            <>
              <span className={`dc-lead-big${lead.muted ? ' muted' : ''}`}>
                {lead.big}
                {!empty(lead.small) && <small>{lead.small}</small>}
              </span>
              {!empty(lead.tag) && <span className="dc-lead-tag">{trn(lead.tag)}</span>}
            </>
          ) : (
            lead
          )}
        </div>

        <div className="dc-facts">
          {facts.map((f, i) => {
            const none = empty(f.value);
            const title = f.title ?? (typeof f.value === 'string' ? f.value : undefined);
            return (
              <div key={i} className={`dc-fact${f.wide ? ' wide' : ''}${isLong(f.value, f.sub) ? ' long' : ''}${toneClass(f.tone)}`}>
                <span className="dc-lab">
                  {trn(f.label)}
                  {f.count !== undefined && <b>{f.count}</b>}
                </span>
                {none ? (
                  <span className="dc-val none">{f.empty === undefined ? tr('None') : trn(f.empty)}</span>
                ) : (
                  <span className={`dc-val${f.text ? ' text' : ''}`} title={title}>{trn(f.value)}</span>
                )}
                {!empty(f.sub) && <span className="dc-sub" title={typeof f.sub === 'string' ? f.sub : undefined}>{trn(f.sub)}</span>}
              </div>
            );
          })}
        </div>

        {amount && (
          <div className={`dc-amt${toneClass(amount.tone)}`}>
            <small>{trn(amount.label)}</small>
            <strong>{amount.value}</strong>
            {!empty(amount.sub) && <span className="dc-amt-sub">{amount.sub}</span>}
            {!empty(amount.extra) && <span className="dc-amt-extra">{amount.extra}</span>}
          </div>
        )}

        <Bi name="chevron-down" className="dc-caret" />
      </summary>

      <div className="dc-body">
        {sections.length > 0 && (
          <div className="dc-grid">
            {sections.map((s, i) => (
              <section key={s.key ?? i} className={`dc-sec${s.wide ? ' wide' : ''}${toneClass(s.tone)}`}>
                <h6 className="dc-h">
                  {s.icon && <Bi name={s.icon} />} {trn(s.title)}
                  {s.count !== undefined && <span className={`dc-count${toneClass(s.tone)}`}>{s.count}</span>}
                </h6>
                {s.content}
              </section>
            ))}
          </div>
        )}
        {children !== undefined && children !== null && children !== false && <div className="dc-extra">{children}</div>}
        {(meta || actions) && (
          <div className="dc-foot">
            {meta && <span className="dc-meta">{meta}</span>}
            {actions}
          </div>
        )}
      </div>
    </details>
  );
}

export interface DetailListItem {
  label: ReactNode;
  value: ReactNode;
  /** The closing line (a total): bold, with a rule above. */
  total?: boolean;
  key?: string;
}

/** The label | value lines inside a section (`.dc-dl`). `false` and `undefined` entries are skipped, so `cond && { ... }` reads well. */
export function DetailList({ items, className = '' }: { items: (DetailListItem | false | undefined | null)[]; className?: string }) {
  const rows = items.filter((x): x is DetailListItem => Boolean(x));
  if (rows.length === 0) return null;
  return (
    <dl className={`dc-dl ${className}`.trim()}>
      {rows.map((r, i) => (
        <div key={r.key ?? i} className={`dc-dl-row${r.total ? ' total' : ''}`}>
          <dt>{trn(r.label)}</dt>
          <dd>{trn(r.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** "Nothing here" inside a section, in the muted colour. */
export function DetailNone({ children }: { children: ReactNode }) {
  return <p className="dc-none">{trn(children)}</p>;
}
