import type { ReactElement, ReactNode } from "react";
import { siteCopy as c } from "@shared/site/copy";
import type { LegalSection } from "@shared/site/pages";

// The pieces every page of the public website shares (MJ, 2 Nov 2026): icons, the drawn product samples, a page's opening, the closing call to action and the legal layout.
// Server components: no state, no script. Styles: .hp in globals.css.

const ICONS: Record<string, string> = {
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  calendar: "M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
  cash: "M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6.5 10v4M17.5 10v4",
  building: "M5 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17M15 9h3a1 1 0 0 1 1 1v11M3 21h18M9 8h2M9 12h2M9 16h2",
  people: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 3.5 6",
  phone: "M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.7 5.5 3.7 9S14.5 18.5 12 21c-2.5-2.5-3.7-5.5-3.7-9S9.5 5.5 12 3z",
  mail: "M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM3.5 7.5 12 13.5l8.5-6",
  shield: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM8.5 12l2.5 2.5 4.5-5",
};

export function Icon({ name }: { name: string }) {
  return (
    <svg className="hp-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONS[name] ?? ICONS.grid} />
    </svg>
  );
}

export function Arrow() {
  return (
    <svg className="hp-arrow" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function Tick({ small = false }: { small?: boolean }) {
  return (
    <svg className={`hp-tick${small ? " hp-tick-sm" : ""}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/** The two calls to action every page ends on: Book a demo (primary) and a second link. */
export function CtaRow({ second, center = false, invert = false }: { second?: { href: string; label: string }; center?: boolean; invert?: boolean }) {
  return (
    <div className={`hp-cta-row${center ? " hp-center" : ""}`}>
      <a className={`hp-btn ${invert ? "hp-btn-invert" : "hp-btn-solid"} hp-btn-lg`} href={c.demoPath}>{c.demo}<Arrow /></a>
      {second ? <a className={`hp-btn ${invert ? "hp-btn-outline-invert" : "hp-btn-line"} hp-btn-lg`} href={second.href}>{second.label}</a> : null}
    </div>
  );
}

/** A page's opening: eyebrow, the one heading of the page and the lead. */
export function PageIntro({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead: string; children?: ReactNode }) {
  return (
    <section className="hp-intro">
      <div className="hp-wrap">
        <p className="hp-eyebrow">{eyebrow}</p>
        <h1 className="hp-h1 hp-h1-page">{title}</h1>
        <p className="hp-lead">{lead}</p>
        {children}
      </div>
    </section>
  );
}

/** The dark closing band. */
export function CtaBand() {
  return (
    <section className="hp-final">
      <div className="hp-wrap hp-final-box">
        <h2>{c.cta.title}</h2>
        <p>{c.cta.body}</p>
        <CtaRow center invert second={{ href: c.signInPath, label: c.signIn }} />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ drawn product samples (never a customer's data) */

const ROOMS: { no: string; state: "free" | "busy" | "clean" }[] = [
  { no: "101", state: "busy" }, { no: "102", state: "free" }, { no: "103", state: "busy" }, { no: "104", state: "clean" }, { no: "105", state: "free" },
  { no: "201", state: "free" }, { no: "202", state: "busy" }, { no: "203", state: "busy" }, { no: "204", state: "free" }, { no: "205", state: "busy" },
  { no: "301", state: "clean" }, { no: "302", state: "busy" }, { no: "303", state: "free" }, { no: "304", state: "busy" }, { no: "305", state: "free" },
];
const ROOM_LABEL = { free: "Vacant", busy: "Occupied", clean: "Cleaning" } as const;

function WinBar({ title }: { title: string }) {
  return <div className="hp-win-bar"><span /><span /><span /><b>{title}</b><em>{c.sample}</em></div>;
}

export function HeroPreview() {
  return (
    <div className="hp-preview" role="img" aria-label="Sample room board and bill">
      <div className="hp-win">
        <WinBar title="Room board" />
        <div className="hp-board">
          {ROOMS.map((r) => (
            <div key={r.no} className={`hp-room hp-room-${r.state}`}>
              <b>{r.no}</b>
              <span>{ROOM_LABEL[r.state]}</span>
            </div>
          ))}
        </div>
        <div className="hp-legend"><i className="hp-room-free" />Vacant<i className="hp-room-busy" />Occupied<i className="hp-room-clean" />Cleaning</div>
      </div>
      <div className="hp-bill">
        <div className="hp-bill-head"><b>Bill · Room 203</b><span>Paid</span></div>
        <div className="hp-bill-row"><span>Room, 2 nights</span><span>₹ 6,400</span></div>
        <div className="hp-bill-row"><span>Dining</span><span>₹ 820</span></div>
        <div className="hp-bill-row"><span>GST</span><span>₹ 774</span></div>
        <div className="hp-bill-total"><span>Total</span><b>₹ 7,994</b></div>
      </div>
    </div>
  );
}

function DeskPanel() {
  return (
    <div className="hp-win" role="img" aria-label="Sample of today's arrivals and departures">
      <WinBar title="Today" />
      <div className="hp-panel">
        <p className="hp-panel-h">Arriving <i>3</i></p>
        <div className="hp-row"><div><b>Rohan Mehta</b><span>2 × Deluxe · 2 nights</span></div><u>Check in</u></div>
        <div className="hp-row"><div><b>Anita Shah</b><span>1 × Suite · 3 nights</span></div><u>Check in</u></div>
        <div className="hp-row"><div><b>Kiran Patel</b><span>1 × Standard · 1 night</span></div><u>Check in</u></div>
        <p className="hp-panel-h">Leaving <i>2</i></p>
        <div className="hp-row"><div><b>Dev Joshi</b><span>Room 204</span></div><u className="hp-out">Check out</u></div>
        <div className="hp-row"><div><b>Sara Khan</b><span>Room 312</span></div><u className="hp-out">Check out</u></div>
      </div>
    </div>
  );
}

function GstPanel() {
  return (
    <div className="hp-win" role="img" aria-label="Sample of a company filled in from its GST number">
      <WinBar title="Add company" />
      <div className="hp-panel">
        <p className="hp-field-l">GST number</p>
        <div className="hp-field">24AAAAA0000A1Z5<span>✓ Valid</span></div>
        <div className="hp-found">
          <p className="hp-found-h">Filled from the GST record</p>
          <dl>
            <dt>Name</dt><dd>Sample Traders Private Limited</dd>
            <dt>Address</dt><dd>12 Station Road, Ahmedabad</dd>
            <dt>State</dt><dd>Gujarat</dd>
            <dt>Status</dt><dd>Active</dd>
          </dl>
        </div>
      </div>
    </div>
  );
}

function CashPanel() {
  return (
    <div className="hp-win" role="img" aria-label="Sample of a shift handover">
      <WinBar title="Shift handover" />
      <div className="hp-panel">
        <div className="hp-bill-row"><span>Opening cash</span><span>₹ 12,000</span></div>
        <div className="hp-bill-row"><span>Cash in today</span><span>₹ 48,300</span></div>
        <div className="hp-bill-row"><span>Expenses paid</span><span>− ₹ 6,150</span></div>
        <div className="hp-bill-total"><span>To hand over</span><b>₹ 54,150</b></div>
        <p className="hp-match">✓ Drawer count matches the books</p>
      </div>
    </div>
  );
}

export const PANELS: Record<string, () => ReactElement> = { desk: DeskPanel, gst: GstPanel, cash: CashPanel };

/* ------------------------------------------------------------------ legal pages */

export function LegalPage({ title, updated, intro, sections }: { title: string; updated: string; intro: string; sections: readonly LegalSection[] }) {
  return (
    <section className="hp-section hp-legal">
      <div className="hp-wrap hp-legal-wrap">
        <h1 className="hp-h2">{title}</h1>
        <p className="hp-note">Last updated {updated}</p>
        <p className="hp-legal-intro">{intro}</p>
        {sections.map((s) => (
          <section key={s.title}>
            <h2>{s.title}</h2>
            {s.paras?.map((p) => <p key={p}>{p}</p>)}
            {s.points ? <ul>{s.points.map((p) => <li key={p}>{p}</li>)}</ul> : null}
          </section>
        ))}
        <p className="hp-legal-mail"><a href={`mailto:${c.contactEmail}`}>{c.contactEmail}</a></p>
      </div>
    </section>
  );
}
