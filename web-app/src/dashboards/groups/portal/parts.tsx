'use client';

// Pieces both portals draw (Pallav resources/views/portal/*): the rupee format, section heads, rows, the hero card,
// the pay cards with their pay bar (portal/_bills and company/_dues), the load / error line and a document preview.
// Markup and class names are Pallav's `pt-*` (public/pallav/portal.css); nothing here uses the old kit.
import { useRef, useState, type ReactNode } from 'react';

import { sessionHotelNames } from '@shared/dashboards/common';
import { formatINR } from '@shared/dashboards/format';
import { portalNotSetUp, type PortalNotSetUp } from '@shared/dashboards/portalState';
import { portalCopyByLanguage } from '@shared/dashboards/portalState.lang';

import { errorText, useToast } from '@/components/ui';
import type { AsyncState } from '@/components/ui/useAsync';
import { Bi, Dialog, EmptyState, Modal, PageHead, SearchBox, StatusChip, PortalButton } from '@/dashboards/pallav/ui';
import { useCopy, tr } from '@/lib/i18n/language';

/**
 * PortalSample::inr: whole rupees, rounded ("₹15,624"). Money in our mocks is paise. Grouping follows the one central
 * switch in format.ts (MONEY_GROUPING, western like Pallav's number_format: "₹199,505").
 */
/** Money in the portals: the hotel pages' format with paise (plan rule D7), the same in the Guest and Company portals (the guest side showed whole rupees before). */
export const inr = (paise: number): string => formatINR(paise);

/** Bootstrap Icons names for the kit-icon names the mocks carry. */
const ICONS: Record<string, string> = {
  building: 'building',
  utensils: 'cup-hot',
  door: 'door-closed',
  star: 'stars',
  users: 'people',
  bed: 'door-open',
  tag: 'basket',
  inbox: 'bell',
  wallet: 'wallet2',
  calendar: 'calendar-check',
  receipt: 'receipt',
  card: 'credit-card-2-front',
  swap: 'arrow-repeat',
  arrowUp: 'arrow-return-left',
  check: 'check-circle',
};
export const biOf = (name: string): string => ICONS[name] ?? name;

export function PtSection({ title, sub, first, headSub }: { title: string; sub?: ReactNode; first?: boolean; headSub?: ReactNode }) {
  // desktop parity: a page's first section is its head. On a desktop it is the hotel page head (the graphite sentence: `headSub`, else `sub`, else the title;
  // the top bar already names the page); the phone keeps the heading.
  if (first) {
    return (
      <>
        <PageHead className="app-hide-phone" sub={headSub ?? sub ?? title} />
        <div className="app-only-phone">
          <div className="pt-section" style={{ marginTop: 0 }}>
            <h2>{title}</h2>
            {sub ? <span>{sub}</span> : null}
          </div>
        </div>
      </>
    );
  }
  return (
    <div className="pt-section" style={first ? { marginTop: 0 } : undefined}>
      <h2>{title}</h2>
      {sub ? <span>{sub}</span> : null}
    </div>
  );
}

/** Still `.skel` blocks (pms.css) in the portal's card while a call runs: a row per expected line. */
function PtSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="pt-card" role="status" aria-busy="true" aria-label={tr("Loading")}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="pt-row">
          <span className="pt-row-ico skel" />
          <div className="pt-row-main">
            <div className="skel" style={{ height: 14, width: `${45 + ((i * 17) % 35)}%`, marginBottom: 8 }} />
            <div className="skel" style={{ height: 11, width: `${25 + ((i * 11) % 25)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A short "What you can do here" card at the top of a portal's first page. */
export function PtIntro({ title, lines, rememberKey }: { title: string; lines: readonly string[]; rememberKey?: string }) {
  // with a rememberKey the card can be closed ("Got it") and stays closed in this browser; blocked storage just shows it again next time
  const storeKey = rememberKey ? `hms-portal-intro-closed:${rememberKey}` : null;
  const [closed, setClosed] = useState(() => {
    if (!storeKey) return false;
    try {
      return window.localStorage.getItem(storeKey) === '1';
    } catch {
      return false;
    }
  });
  if (closed) return null;
  return (
    <section className="pt-card pt-intro-card" aria-label={title}>
      <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
        <h2 className="h6 mb-0">{title}</h2>
        {storeKey ? (
          <PortalButton
            variant="line"
            onClick={() => {
              setClosed(true);
              try {
                window.localStorage.setItem(storeKey, '1');
              } catch {
                // private window: closed for this visit only
              }
            }}
          >
            {tr("Got it")}
          </PortalButton>
        ) : null}
      </div>
      <ul className="pt-intro">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </section>
  );
}

/** The page of an account that is in the hotel but not linked to its guest, company or staff record (decision 47): never "Not allowed", never a bare Try again. */
export function PtNotSetUp({ info }: { info: PortalNotSetUp }) {
  const portalCopy = useCopy(portalCopyByLanguage);
  const hotel = sessionHotelNames()?.hotel ?? null;
  return (
    <div className="pt-card" role="alert">
      <EmptyState look="portal" icon="link-45deg" title={info.inactive ? portalCopy.inactiveTitle : portalCopy.notSetUpTitle} text={info.message}>
        <p className="mt-3 mb-1">{info.inactive ? portalCopy.inactiveTodo : portalCopy.todo}</p>
        <p className="small text-muted mb-0">{portalCopy.contact(hotel)}</p>
      </EmptyState>
    </div>
  );
}

/**
 * Skeleton while a call runs, the friendly "not set up yet" page, the error (offline has its own icon) with Try again, then `children(data)`.
 * `skeleton` (decision 71, the guest pages): the page's own loading shape in place of the plain rows (e.g. `<GgSkeleton variant="list" />`).
 */
export function PtLoad<T>({ state, onRetry, children, rows, skeleton }: { state: AsyncState<T>; onRetry: () => void; children: (data: T) => ReactNode; rows?: number; skeleton?: ReactNode }) {
  if (state.status === 'loading') return skeleton !== undefined ? <>{skeleton}</> : <PtSkeleton rows={rows} />;
  if (state.status === 'error') {
    const notSetUp = portalNotSetUp(state.error);
    if (notSetUp) return <PtNotSetUp info={notSetUp} />;
    const offline = state.error.code === 'NETWORK_OFFLINE';
    return (
      <div className="pt-card" role="alert">
        <EmptyState look="portal" icon={offline ? 'wifi-off' : 'exclamation-circle'} text={errorText(state.error)}>
          <div className="mt-3">
            <PortalButton variant="line" icon="arrow-clockwise" onClick={onRetry}>{tr("Try again")}</PortalButton>
          </div>
        </EmptyState>
      </div>
    );
  }
  return <>{children(state.data)}</>;
}

/** `.pt-row` as in Pallav's history and activity lists. */
export function PtRow({ icon, title, sub, right, credit, onPress, padded }: { icon: string; title: ReactNode; sub?: ReactNode; right?: ReactNode; credit?: boolean; onPress?: () => void; padded?: boolean }) {
  const press = onPress ? { role: 'button', tabIndex: 0, style: { cursor: 'pointer' }, onClick: onPress, onKeyDown: (e: React.KeyboardEvent) => e.key === 'Enter' && onPress() } : {};
  return (
    <div className="pt-row" {...press} {...(padded ? { style: { padding: '10px 0' } } : {})}>
      <span className="pt-row-ico">
        <Bi name={icon} />
      </span>
      <div className="pt-row-main">
        <div className="pt-row-title">{title}</div>
        {sub ? <div className="pt-row-sub">{sub}</div> : null}
      </div>
      {right !== undefined ? <div className={credit ? 'pt-row-amt credit' : 'pt-row-amt'}>{right}</div> : null}
    </div>
  );
}

/** `.pt-hero` (home and company/_hero). */
export function PtHero({ hello, name, chips, dueLabel, dueValue, action }: { hello: string; name: string; chips: { icon: string; text: string }[]; dueLabel?: string; dueValue?: string; action?: ReactNode }) {
  return (
    <section className="pt-hero">
      <div>
        <div className="pt-hello">{hello}</div>
        <h1>{name}</h1>
        <div className="pt-stay">
          {chips.map((c) => (
            <span key={c.text} className="pt-chip">
              <Bi name={c.icon} /> {c.text}
            </span>
          ))}
        </div>
      </div>
      {dueValue !== undefined ? (
        <div className="pt-hero-due">
          <small>{dueLabel}</small>
          <strong>{dueValue}</strong>
          {action ? <div className="mt-2">{action}</div> : null}
        </div>
      ) : null}
    </section>
  );
}

/** One `.pt-line`: label left, amount right. */
export function PtLine({ label, value, paid }: { label: ReactNode; value: ReactNode; paid?: boolean }) {
  return (
    <div className={paid ? 'pt-line paid' : 'pt-line'}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pay cards + pay bar
// ---------------------------------------------------------------------------

export interface PayCard {
  id: string;
  icon: string;
  name: string;
  sub: string;
  duePaise: number;
  /** Lines of the bill (portal/_bills); company dues cards have none. */
  lines?: { label: string; paise: number }[];
  gst?: { label: string; paise: number };
  totalPaise?: number;
  paidPaise?: number;
  /** Badge on the right when nothing is due ("Paid" on a bill, "Settled" on a due). */
  settledLabel?: string;
  /** Opens the bill (our addition: Pallav's cards are not links). */
  onOpen?: () => void;
}

interface PayResultView {
  ok: boolean;
  text: string;
}

/**
 * The cards and the pay bar. Ticked cards are what "Pay now" pays; "Pay both together" ticks all. Pallav opens an alert
 * ("Design preview"); here a confirm dialog comes first and `onPay` runs the mock payment for the ticked ids.
 */
export function PayPanel({
  cards,
  razor,
  confirmBody,
  onPay,
  onDone,
  allLabel,
}: {
  cards: PayCard[];
  razor: string;
  confirmBody: (total: string, count: number) => string;
  onPay: (ids: string[]) => Promise<PayResultView>;
  onDone: (r: PayResultView) => void;
  allLabel?: string;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(cards.filter((c) => c.duePaise > 0).map((c) => c.id)));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const on = cards.filter((c) => c.duePaise > 0 && picked.has(c.id));
  const sum = on.reduce((s, c) => s + c.duePaise, 0);
  const count = on.length;
  const payable = cards.filter((c) => c.duePaise > 0).length;
  const label = count === 2 ? 'Both businesses together' : count === 1 ? 'One business selected' : count > 2 ? 'All selected bills together' : 'Nothing selected';

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function pay() {
    setBusy(true);
    const r = await onPay(on.map((c) => c.id));
    setBusy(false);
    setConfirming(false);
    onDone(r);
  }

  return (
    <>
      <div className="pt-grid" data-bills>
        {cards.map((b) => {
          const due = b.duePaise > 0;
          return (
            <article key={b.id} className={`pt-card pt-bill ${due && picked.has(b.id) ? 'selected' : ''}`}>
              <div className="pt-bill-head">
                <span className="pt-bill-ico">
                  <Bi name={b.icon} />
                </span>
                <div>
                  <div className="pt-bill-name">{b.name}</div>
                  <div className="pt-bill-no">{b.sub}</div>
                </div>
                {due ? (
                  <label className="pt-pick">
                    <input type="checkbox" checked={picked.has(b.id)} onChange={() => toggle(b.id)} /> {tr("Pay")}
                  </label>
                ) : (
                  <StatusChip tone="ok" look="portal" className="ms-auto">
                    <Bi name="check-circle-fill" /> {b.settledLabel ?? tr("Paid")}
                  </StatusChip>
                )}
              </div>
              {b.lines ? (
                <div className="pt-lines">
                  {b.lines.map((l, i) => (
                    <PtLine key={`${l.label}-${i}`} label={l.label} value={inr(l.paise)} />
                  ))}
                  {b.gst ? <PtLine label={b.gst.label} value={inr(b.gst.paise)} /> : null}
                  {b.totalPaise !== undefined ? <PtLine label={tr("Bill total")} value={inr(b.totalPaise)} /> : null}
                  {b.paidPaise ? <PtLine paid label={tr("Paid already")} value={`− ${inr(b.paidPaise)}`} /> : null}
                </div>
              ) : null}
              <div className={`pt-bill-due ${due ? '' : 'clear'}`} style={b.lines ? undefined : { marginTop: 'auto' }}>
                <small>{due ? tr("To pay") : tr("Nothing due")}</small>
                <strong>{inr(b.duePaise)}</strong>
              </div>
              {b.onOpen ? (
                <PortalButton variant="line" icon="file-earmark-text" onClick={b.onOpen} className="mt-2">{tr("View bill")}</PortalButton>
              ) : null}
            </article>
          );
        })}
      </div>

      <div className="pt-paybar" data-paybar>
        <div className="pt-pay-sum">
          <small aria-live="polite">{label === 'Nothing selected' && payable === 0 ? tr("Nothing to pay") : label}</small>
          <strong>{inr(sum)}</strong>
        </div>
        <PortalButton variant="ghost" icon="collection" onClick={() => setPicked(new Set(cards.filter((c) => c.duePaise > 0).map((c) => c.id)))} disabled={payable < 2 || count === payable}>{allLabel ?? (payable > 2 ? tr("Select all") : tr("Select both"))}</PortalButton>
        <PortalButton variant="primary" icon="lock" disabled={sum <= 0} onClick={() => setConfirming(true)}>{tr("Pay now")}</PortalButton>
        <div className="pt-razor">
          <Bi name="shield-check" /> {razor}
        </div>
      </div>

      <Dialog
        open={confirming}
        title={tr("Pay now?")}
        message={confirmBody(inr(sum), count)}
        confirmLabel={`Pay ${inr(sum)}`}
        icon="lock"
        busy={busy}
        onConfirm={() => void pay()}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Document preview (no PDF library: the real file comes with the backend)
// ---------------------------------------------------------------------------

/**
 * Prints the document alone: a new window with the page's own stylesheets (day look) and the preview's markup, printed once the sheets load.
 * Until the server makes the real PDF this is the printable copy (Print to PDF saves it).
 */
function printDoc(title: string, body: HTMLElement | null): boolean {
  if (!body) return false;
  const w = window.open('', '_blank', 'width=900,height=760');
  if (!w) return false;
  const doc = w.document;
  doc.title = title;
  const sheets = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].filter((l) => !l.href.includes('pms-dark.css'));
  const loads = sheets.map(
    (s) =>
      new Promise<void>((resolve) => {
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = s.href;
        link.onload = () => resolve();
        link.onerror = () => resolve();
        doc.head.appendChild(link);
      }),
  );
  doc.body.style.padding = '28px';
  doc.body.innerHTML = body.innerHTML;
  void Promise.all(loads).then(() => {
    w.focus();
    w.print();
  });
  return true;
}

export function PtDoc({ open, title, note, onClose, children, printLabel = 'Print' }: { open: boolean; title: string; note: string; onClose: () => void; children: ReactNode; printLabel?: string }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const print = () => {
    if (!printDoc(title, bodyRef.current)) toast.show({ tone: 'error', text: 'The print window was blocked. Allow pop-ups for this site and try again.' });
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      footer={<PortalButton icon="printer" onClick={print}>{printLabel}</PortalButton>}
    >
      <div className="pt-row-sub mb-3">{note}</div>
      <div ref={bodyRef}>{children}</div>
    </Modal>
  );
}

/** A validation line under a portal field (Pallav's portal has no inline-validation style of its own; Bootstrap's invalid-feedback colour). */
export function FieldErr({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <div role="alert" className="invalid-feedback d-block fw-semibold">
      {children}
    </div>
  );
}

/** Previous / Next under a portal list (both portals). */
export function PtPager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  if (total <= pageSize) return null;
  return (
    <div className="d-flex justify-content-between align-items-center p-3">
      <PortalButton variant="line" icon="chevron-left" disabled={page <= 1} onClick={() => onPage(page - 1)}>{tr("Previous")}</PortalButton>
      <span className="pt-row-sub" aria-live="polite">
        {tr("Page")} {page} {tr("of")} {Math.ceil(total / pageSize)}
      </span>
      <PortalButton variant="line" disabled={page * pageSize >= total} onClick={() => onPage(page + 1)}>{tr("Next")} <Bi name="chevron-right" /></PortalButton>
    </div>
  );
}

/** The search box above a portal list: the app's one search box (`SearchBox`, pallav/ui) in the portal theme (`.pt-form` > `.pt-input`); Escape empties it. */
export function PtSearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <SearchBox theme="portal" value={value} onChange={onChange} placeholder={placeholder} label={placeholder} />;
}
