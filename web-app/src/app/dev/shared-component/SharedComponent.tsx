"use client";

// Shared Component: every reusable UI piece of the hotel screens with its variants and states, plus the design tokens (colours in day and
// night with contrast ratios, type scale, spacing, radius, shadows, breakpoints, layers). Dev only (/dev/shared-component).
// Rule (docs/UI.md): new UI = use or add a Shared Component. The kit is web-app/src/dashboards/pallav/ui/index.ts.
import { useEffect, useState, type ReactNode } from "react";
import type { WhatsAppMessage } from "@shared/dashboards/whatsapp";
import { WhatsAppBubble } from "@/dashboards/groups/conversations/WhatsAppBubble";
import { loadPallavBase, setPageSheets } from "@/dashboards/pallav/assets";
import {
  Alert, Bi, Button, CellStack, ChannelIcon, ChatBubble, EmptyState, MailFrame, MessageTicks, FieldError, FieldHint, Footer, IconButton, Kpi, KpiGrid, Modal, ModalFooter, PageHead, PmsDate, PmsSelect,
  ListTabs, Pager, RemoveButton, RequiredMark, SegTabs, Skeleton, StatusChip, Table, TextAction, Th, useTableView, type ChipTone,
} from "@/dashboards/pallav/ui";

type Theme = "light" | "dark";

function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mb-5">
      <h2 className="fs-xl fw-bold mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Spec({ name, note, snippet, children }: { name: string; note?: string; snippet: string; children: ReactNode }) {
  return (
    <div className="card p-3 mb-3">
      <div className="d-flex flex-wrap justify-content-between gap-2 mb-2">
        <strong className="fs-lg">{name}</strong>
        {note && <span className="fs-sm text-muted">{note}</span>}
      </div>
      <div className="d-flex flex-wrap align-items-start gap-3 mb-3">{children}</div>
      <code className="fs-sm t-num" style={{ whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)" }}>{snippet}</code>
    </div>
  );
}

// ---- colour maths (reads the live CSS variables for the theme that is on) ----
type RGBA = [number, number, number, number];
function parse(css: string): RGBA | null {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  return [p[0], p[1], p[2], p[3] ?? 1];
}
function over(top: RGBA, base: RGBA): RGBA {
  const a = top[3];
  return [top[0] * a + base[0] * (1 - a), top[1] * a + base[1] * (1 - a), top[2] * a + base[2] * (1 - a), 1];
}
function lum([r, g, b]: RGBA): number {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a: RGBA, b: RGBA): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const hex = ([r, g, b, a]: RGBA) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase()}${a < 1 ? ` @${Math.round(a * 100)}%` : ""}`;
function valueOf(token: string): RGBA | null {
  const probe = document.createElement("span");
  probe.style.color = `var(${token})`;
  document.body.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return parse(c);
}

const COLOURS: { role: string; tokens: string[] }[] = [
  { role: "Brand", tokens: ["--p200", "--p600", "--p700", "--p800", "--accent-solid", "--brand-deep-1", "--brand-deep-2", "--brand-deep-3", "--brand-deep-4", "--brand-deep-5", "--brand-soft-1", "--brand-soft-2", "--brand-soft-3", "--brand-soft-4", "--brand-soft-5"] },
  { role: "Text", tokens: ["--ink", "--ink2", "--muted", "--white", "--link"] },
  { role: "Surface and border", tokens: ["--surface", "--surface-2", "--cream", "--line", "--line2"] },
  { role: "Success", tokens: ["--ok", "--ok-bg"] },
  { role: "Warning", tokens: ["--warn", "--warn-bg"] },
  { role: "Danger", tokens: ["--bad", "--bad-bg"] },
  { role: "Info", tokens: ["--info", "--info-bg"] },
];
const PAIRS: [string, string, string][] = [
  ["--ink", "--surface", "Body text on a card"],
  ["--ink2", "--surface", "Secondary text on a card"],
  ["--muted", "--surface", "Muted text on a card"],
  ["--link", "--surface", "Links on a card"],
  ["--white", "--accent-solid", "Text on a primary button"],
  ["--ok", "--ok-bg", "Success text on its tint"],
  ["--warn", "--warn-bg", "Warning text on its tint"],
  ["--bad", "--bad-bg", "Danger text on its tint"],
  ["--info", "--info-bg", "Info text on its tint"],
  ["--bad", "--surface", "Small red text on a card"],
];

function Swatch({ token, theme }: { token: string; theme: Theme }) {
  const [shown, setShown] = useState<string>("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => { const v = valueOf(token); setShown(v ? hex(v) : "(unset)"); }, 60);
    return () => clearTimeout(t);
  }, [token, theme]);
  return (
    <button
      type="button"
      className="d-flex align-items-center gap-2 p-2 border rounded text-start bg-transparent"
      style={{ minWidth: 220 }}
      onClick={() => { void navigator.clipboard?.writeText(shown.split(" ")[0]); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
      aria-label={`${token} ${shown}, click to copy`}
    >
      <span style={{ width: 28, height: 28, borderRadius: "var(--radius-sm, 6px)", background: `var(${token})`, border: "1px solid var(--line2)" }} />
      <span>
        <span className="d-block fs-sm fw-semibold">{token}</span>
        <span className="d-block fs-xs text-muted t-num">{copied ? "copied" : shown || "…"}</span>
      </span>
    </button>
  );
}

function Contrast({ theme }: { theme: Theme }) {
  const [rows, setRows] = useState<{ label: string; fg: string; bg: string; r: number }[]>([]);
  useEffect(() => {
    const t = setTimeout(() => {
      const surface = valueOf("--surface") ?? [255, 255, 255, 1];
      setRows(PAIRS.map(([fg, bg, label]) => {
        const b0 = valueOf(bg) ?? surface;
        const b = over(b0, surface);
        const f = over(valueOf(fg) ?? [0, 0, 0, 1], b);
        return { label, fg, bg, r: ratio(f, b) };
      }));
    }, 80);
    return () => clearTimeout(t);
  }, [theme]);
  return (
    <Table className="table table-sm align-middle">
      <thead><tr><th>Pair actually used</th><th>Text</th><th>On</th><th className="text-end">Ratio</th><th>Normal 4.5:1</th><th>Large 3:1</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.fg}${r.bg}`}>
            <td>{r.label}</td><td className="fs-sm">{r.fg}</td><td className="fs-sm">{r.bg}</td>
            <td className="text-end t-num">{r.r.toFixed(2)}:1</td>
            <td>{r.r >= 4.5 ? "pass" : "FAIL"}</td><td>{r.r >= 3 ? "pass" : "FAIL"}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

const SIZES: [string, string, string][] = [
  ["Page title", "--fs-2xl", "Revenue"], ["Section heading", "--fs-xl", "Today's collections"], ["Card title", "--fs-lg", "Front desk board"],
  ["Body", "--fs-base", "Guests arriving today are listed first."], ["Small", "--fs-md", "Updated a minute ago"], ["Caption", "--fs-sm", "Includes GST"],
  ["Label (uppercase)", "--fs-2xs", "Room type"], ["Tabular numbers", "--fs-lg", "₹ 1,24,500.00"],
];

const ROWS = [
  { id: "1", guest: "Amit Joshi", room: "204", status: "ok" as ChipTone, amount: 12400 },
  { id: "2", guest: "Deepa Iyer", room: "112", status: "warn" as ChipTone, amount: 8650 },
  { id: "3", guest: "Ravi Kumar", room: "305", status: "danger" as ChipTone, amount: 20100 },
  { id: "4", guest: "Anita Shah", room: "118", status: "neutral" as ChipTone, amount: 3200 },
];

function TableDemo() {
  const view = useTableView(ROWS, { perPage: 2, sorters: { guest: { kind: "text", value: (r) => r.guest }, amount: { kind: "num", value: (r) => r.amount } } });
  return (
    <div className="w-100">
      <Table className="table table-hover align-middle mb-0">
        <thead><tr><Th view={view} id="guest">Guest</Th><th>Room</th><th>Status</th><Th view={view} id="amount" className="text-end">Amount</Th></tr></thead>
        <tbody>
          {view.rows.map((r) => (
            <tr key={r.id}>
              <td><CellStack main={r.guest} sub={`Room ${r.room}`} /></td><td>{r.room}</td>
              <td><StatusChip tone={r.status}>{r.status}</StatusChip></td><td className="text-end t-num">₹ {r.amount.toLocaleString("en-IN")}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Pager view={view} sizes={[10, 25]} />
    </div>
  );
}

function FocusDemo() {
  return (
    <>
      <div><p className="fs-xs text-muted mb-1">Buttons: default and disabled (Tab to one to see the focus ring)</p><div className="d-flex gap-2"><Button>Default</Button><Button disabled>Disabled</Button></div></div>
      <div><p className="fs-xs text-muted mb-1">Inputs: default, disabled, invalid</p>
        <input className="form-control mb-1" defaultValue="Default" aria-label="Default input" />
        <input className="form-control mb-1" defaultValue="Disabled" disabled aria-label="Disabled input" />
        <input className="form-control is-invalid" defaultValue="Invalid" aria-label="Invalid input" />
      </div>
      <p className="fs-sm text-muted mb-0 align-self-center" style={{ maxWidth: 360 }}>Hover and pressed states come with the pointer (a lighter fill on hover, darker when pressed). Tab to any control to see the focus ring.</p>
    </>
  );
}

// Conversations (decision 66): every WhatsApp message type and tick, drawn by the screen's own bubble on the kit's ChatBubble.
const AT = "2026-10-24T09:35:00.000Z";
const PIC = `data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='280' height='160'><rect width='280' height='160' fill='#111114'/></svg>")}`; // check-shared-ignore: a sample picture for the demo
const NEHA = { id: "u-neha", name: "Neha Patel" };
const WA_SAMPLES: WhatsAppMessage[] = [
  { kind: "whatsapp", id: "d1", direction: "in", status: "received", at: AT, sentBy: null, sentFrom: "contact", type: "text", text: "Is early check-in possible tomorrow?" },
  { kind: "whatsapp", id: "d2", direction: "out", status: "pending", at: AT, sentBy: NEHA, sentFrom: "hms", type: "text", text: "Sending: the clock tick." },
  { kind: "whatsapp", id: "d3", direction: "out", status: "sent", at: AT, sentBy: NEHA, sentFrom: "hms", type: "text", text: "Sent: one tick." },
  { kind: "whatsapp", id: "d4", direction: "out", status: "delivered", at: AT, sentBy: NEHA, sentFrom: "hms", type: "text", text: "Delivered: two ticks.", reactions: [{ emoji: "👍", fromContact: true }] },
  { kind: "whatsapp", id: "d5", direction: "out", status: "read", at: AT, sentBy: NEHA, sentFrom: "hms", type: "text", text: "Read: two ticks in the accent colour.", replyTo: { id: "d1", preview: "Is early check-in possible tomorrow?" } },
  { kind: "whatsapp", id: "d6", direction: "out", status: "failed", at: AT, sentBy: NEHA, sentFrom: "hms", type: "text", text: "Not delivered.", failure: "The guest's phone did not receive it." },
  { kind: "whatsapp", id: "d7", direction: "out", status: "read", at: AT, sentBy: null, sentFrom: "phone", type: "text", text: "Answered from the hotel's own phone." },
  { kind: "whatsapp", id: "d8", direction: "out", status: "read", at: AT, sentBy: null, sentFrom: "auto", type: "template", template: { name: "booking_confirmed", language: "en", category: "utility", text: "Hello Sneha, your booking is confirmed for 1 Nov to 3 Nov." } },
  { kind: "whatsapp", id: "d9", direction: "in", status: "received", at: AT, sentBy: null, sentFrom: "contact", type: "image", media: { name: "ticket.jpg", size: 184320, mime: "image/jpeg", caption: "A photo with a caption", previewUrl: PIC } },
  { kind: "whatsapp", id: "d10", direction: "in", status: "received", at: AT, sentBy: null, sentFrom: "contact", type: "video", media: { name: "gate.mp4", size: 2840000, mime: "video/mp4", duration: 14, previewUrl: PIC } },
  { kind: "whatsapp", id: "d11", direction: "in", status: "received", at: AT, sentBy: null, sentFrom: "contact", type: "document", media: { name: "PO-4471.pdf", size: 248000, mime: "application/pdf" } },
  { kind: "whatsapp", id: "d12", direction: "in", status: "received", at: AT, sentBy: null, sentFrom: "contact", type: "audio", media: { name: "voice.ogg", size: 42000, mime: "audio/ogg", duration: 18 } },
  { kind: "whatsapp", id: "d13", direction: "in", status: "received", at: AT, sentBy: null, sentFrom: "contact", type: "sticker", media: { name: "sticker.webp", size: 18000, mime: "image/webp", previewUrl: PIC } },
  { kind: "whatsapp", id: "d14", direction: "in", status: "received", at: AT, sentBy: null, sentFrom: "contact", type: "location", location: { label: "Kalawad Road, Rajkot" } },
  { kind: "whatsapp", id: "d15", direction: "in", status: "received", at: AT, sentBy: null, sentFrom: "contact", type: "contacts", contacts: [{ name: "Rohan Kulkarni", phone: "+91 98240 77665" }] },
  { kind: "whatsapp", id: "d16", direction: "in", status: "received", at: AT, sentBy: null, sentFrom: "contact", type: "unsupported" },
];
const MAIL_SAMPLE = "<p>Thank you. Please confirm the <strong>airport pickup</strong> on the 12th at 6 pm.</p><table width=\"600\"><tr><td>A wide newsletter table scrolls inside the paper, never the page.</td></tr></table><div data-hms-quote=\"1\"><p>On Mon, the front desk wrote:</p><blockquote>Two deluxe rooms are held for you.</blockquote></div>";

const SPACE = [["p-1", "0.25rem"], ["p-2", "0.5rem"], ["p-3", "1rem"], ["p-4", "1.5rem"], ["p-5", "3rem"]];

export function SharedComponent() {
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");
  const [tab, setTab] = useState("a");
  const [listTab, setListTab] = useState("all");
  const [pill, setPill] = useState("cash");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void loadPallavBase().then(() => setPageSheets(["portal.css", "conversations.css"])).then(() => setReady(true)); }, []);
  useEffect(() => { document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "light"); }, [theme]);
  if (!ready) return <p className="p-4">Loading the theme…</p>;
  const tones: ChipTone[] = ["ok", "neutral", "warn", "danger"];
  return (
    <main className="container py-4" style={{ maxWidth: 1100 }}>
      <header className="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-4">
        <div>
          <h1 className="fs-3xl fw-black mb-1">Shared Component</h1>
          <p className="text-muted mb-0">Every reusable piece, all variants and states, and the design tokens. New UI = use or add a shared component.</p>
        </div>
        <Button variant="outline" icon={theme === "dark" ? "sun" : "moon-stars"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? "Day" : "Night"} mode
        </Button>
      </header>
      <nav className="d-flex flex-wrap gap-3 mb-4 fs-sm" aria-label="Groups">
        {["buttons", "forms", "date", "feedback", "navigation", "states", "data", "conversations", "layout", "tokens"].map((g) => <a key={g} className="t-link" href={`#${g}`}>{g}</a>)}
      </nav>

      <Group id="buttons" title="Buttons and calls to action">
        <Spec name="Button" note="primary, outline, ghost, danger; sm / md; icon; busy" snippet={'<Button variant="outline" size="sm" icon="plus">Add</Button>'}>
          <Button>Primary</Button><Button variant="outline">Outline</Button><Button variant="ghost">Ghost</Button><Button variant="danger">Danger</Button>
          <Button size="sm" icon="plus">Small + icon</Button><Button disabled>Disabled</Button>
          <Button busy busyLabel="Saving…">Save</Button>
          <Button busy={busy} busyLabel="Working…" onClick={() => { setBusy(true); setTimeout(() => setBusy(false), 1400); }}>Click: busy 1.4 s</Button>
        </Spec>
        <Spec name="IconButton" note="square, accessible name required" snippet={'<IconButton icon="pencil" label="Edit" />'}>
          <IconButton icon="pencil" label="Edit" /><IconButton icon="trash" label="Delete" tone="danger" /><IconButton icon="printer" label="Print" disabled />
        </Spec>
      </Group>

      <Group id="forms" title="Forms">
        <Spec name="Field messages" note="label mark, hint, error" snippet={"<RequiredMark /> <FieldHint>…</FieldHint> <FieldError>…</FieldError>"}>
          <div><label className="form-label">Guest name <RequiredMark /></label><input className="form-control is-invalid" defaultValue="" /><FieldError>Enter the guest&apos;s name.</FieldError></div>
          <div><label className="form-label">Mobile</label><input className="form-control" defaultValue="98250 00000" /><FieldHint>Ten digits, without +91.</FieldHint></div>
        </Spec>
        <Spec name="PmsSelect" note="lookup with search" snippet={'<PmsSelect aria-label="Room type" value={v} onChange={set}><option …/></PmsSelect>'}>
          <div style={{ minWidth: 240 }}><PmsSelect aria-label="Room type" value="d" onChange={() => {}}><option value="d">Deluxe</option><option value="s">Suite</option></PmsSelect></div>
        </Spec>
      </Group>

      <Group id="date" title="Date">
        <Spec name="PmsDate" note="Pallav's flatpickr date input" snippet={'<PmsDate label="Check-in" value={d} onChange={set} />'}>
          <div style={{ minWidth: 220 }}><PmsDate aria-label="Check-in" value="2026-10-12" onChange={() => {}} /></div>
        </Spec>
      </Group>

      <Group id="feedback" title="Feedback">
        <Spec name="Alert" note="info, success, warning, danger, neutral" snippet={'<Alert tone="warning" action={<Button size="sm">Retry</Button>}>…</Alert>'}>
          <div className="w-100">
            {(["info", "success", "warning", "danger", "neutral"] as const).map((t) => <Alert key={t} tone={t}>This is a {t} note.</Alert>)}
          </div>
        </Spec>
        <Spec name="StatusChip" snippet={'<StatusChip tone="ok">Paid</StatusChip>'}>
          {tones.map((t) => <StatusChip key={t} tone={t}>{t}</StatusChip>)}
          {tones.map((t) => <StatusChip key={`p${t}`} tone={t} look="portal">{t} (portal)</StatusChip>)}
        </Spec>
        <Spec name="EmptyState" snippet={'<EmptyState icon="inbox" title="No bills yet" text="…" />'}>
          <EmptyState icon="inbox" title="No bills yet" text="Bills appear here when a guest checks out."><Button size="sm" icon="plus">Create a bill</Button></EmptyState>
        </Spec>
        <Spec name="Skeleton" note="loading" snippet={'<Skeleton rows={3} />'}>
          <div className="w-100"><Skeleton rows={3} /></div>
        </Spec>
      </Group>

      <Group id="navigation" title="Navigation">
        <Spec name="SegTabs" snippet={'<SegTabs label="Bills" tabs={[…]} active={t} onChange={set} />'}>
          <SegTabs label="Example" active={tab} onChange={setTab} tabs={[{ id: "a", label: "All" }, { id: "b", label: "Open", icon: "clock" }, { id: "c", label: "Paid" }]} />
        </Spec>
        <Spec name="ListTabs" note="the list filter bar: tabs with count or dot, and the pill look" snippet={'<ListTabs label="Status" active={t} onChange={set} tabs={[{ id: "all", label: "All", count: 12 }, …]} />'}>
          <div className="w-100">
            <ListTabs label="Status" active={listTab} onChange={setListTab} tabs={[{ id: "all", label: "All", count: 12 }, { id: "paid", label: "Paid", dot: "ok", count: 4 }, { id: "due", label: "Due", icon: "clock", count: 8 }]} />
            <div className="mt-3"><ListTabs look="pills" label="Kind" active={pill} onChange={setPill} tabs={[{ id: "cash", label: "Cash" }, { id: "card", label: "Card" }, { id: "upi", label: "UPI" }]} /></div>
          </div>
        </Spec>
        <Spec name="TextAction and RemoveButton" note="small text actions; the remove cross needs an accessible name" snippet={'<TextAction kind="add">Add another item</TextAction>  <RemoveButton aria-label="Remove item 2" />'}>
          <TextAction kind="add">Add another item</TextAction>
          <TextAction kind="reset">Reset filters</TextAction>
          <TextAction kind="clear" aria-label="Clear the search" />
          <RemoveButton aria-label="Remove item 2" />
          <RemoveButton look="person" aria-label="Remove this person">Remove</RemoveButton>
        </Spec>
      </Group>

      <Group id="states" title="States">
        <Spec name="Focus, disabled, invalid" snippet={"Tab to any control: the focus ring is the theme ring; :disabled and .is-invalid are Bootstrap states"}>
          <FocusDemo />
        </Spec>
      </Group>

      <Group id="data" title="Data display">
        <Spec name="Table, sort, pager" note="useTableView + Th + Pager (PmsTable)" snippet={"const view = useTableView(rows, { perPage: 25 }); <Th view={view} id=\"guest\">Guest</Th> … <Pager view={view} />"}>
          <TableDemo />
        </Spec>
        <Spec name="Kpi / KpiGrid" snippet={'<KpiGrid><Kpi … /></KpiGrid>'}>
          <div className="w-100"><KpiGrid><Kpi label="Rooms in house" value="18" icon="in" glyph="box-arrow-in-right" /><Kpi label="Collected today" value="₹ 84,200" icon="month" glyph="cash-coin" /></KpiGrid></div>
        </Spec>
        <Spec name="CellStack" note="two lines in one table cell" snippet={"<CellStack main='Amit Joshi' sub='Room 204' />"}>
          <CellStack main="Amit Joshi" sub="Room 204 · 2 nights" />
        </Spec>
      </Group>

      <Group id="conversations" title="Conversations">
        <Spec name="ChannelIcon" note="named for a screen reader" snippet={'<ChannelIcon channel="whatsapp" />'}>
          <ChannelIcon channel="email" /> <ChannelIcon channel="whatsapp" />
        </Spec>
        <Spec name="MessageTicks" note="sending (clock), sent, delivered, read, not delivered" snippet={'<MessageTicks status="read" />'}>
          {(["pending", "sent", "delivered", "read", "failed"] as const).map((s) => <span key={s} className="d-inline-flex align-items-center gap-1 fs-sm"><MessageTicks status={s} /> {s}</span>)}
        </Spec>
        <Spec name="ChatBubble" note="in, out, not delivered, automatic" snippet={'<ChatBubble direction="out" meta={<MessageTicks status="read" />}>…</ChatBubble>'}>
          <div className="cv-messages w-100">
            <ChatBubble direction="in" meta="9:35 am">The guest&apos;s message.</ChatBubble>
            <ChatBubble direction="out" by="Sent by Neha Patel" meta={<>9:36 am <MessageTicks status="read" /></>}>The hotel&apos;s reply.</ChatBubble>
            <ChatBubble direction="out" tone="failed" meta={<>9:37 am <MessageTicks status="failed" /></>}>Not delivered.</ChatBubble>
            <ChatBubble direction="out" tone="auto" by="Sent automatically" meta="9:38 am">An automatic message.</ChatBubble>
          </div>
        </Spec>
        <Spec name="WhatsApp messages" note="every type and tick (groups/conversations/WhatsAppBubble)" snippet={"<WhatsAppBubble m={message} contactName=\"Asha Rao\" />"}>
          <div className="cv-messages w-100">
            {WA_SAMPLES.map((m) => <WhatsAppBubble key={m.id} m={m} contactName="Asha Rao" />)}
          </div>
        </Spec>
        <Spec name="MailFrame" note="sanitised email on a light paper, no scripts, quoted text folded" snippet={"<MailFrame html={body.html} title={body.subject} hasQuoted />"}>
          <div className="w-100"><MailFrame html={MAIL_SAMPLE} title="Re: Room for 3 nights" hasQuoted /></div>
        </Spec>
      </Group>

      <Group id="layout" title="Layout, header and footer">
        <Spec name="PageHead" snippet={'<PageHead sub="What this page is for">buttons</PageHead>'}>
          <div className="w-100"><PageHead sub="Every guest advance, in one place."><Button size="sm" icon="plus">New advance</Button></PageHead></div>
        </Spec>
        <Spec name="Modal + ModalFooter" snippet={"<Modal …><ModalFooter … /></Modal>"}>
          <Button onClick={() => setOpen(true)}>Open a modal</Button>
          <Modal open={open} title="Example" onClose={() => setOpen(false)} footer={<ModalFooter confirmLabel="Save" onConfirm={() => setOpen(false)} onCancel={() => setOpen(false)} />}>
            <p className="mb-0">Shared window: title, body, footer with Cancel and Save.</p>
          </Modal>
        </Spec>
        <Spec name="Footer" snippet={"<Footer links={[{ label: 'Terms', href: '/terms' }]} />"}>
          <div className="w-100"><Footer links={[{ label: "Terms", href: "#terms" }, { label: "Privacy", href: "#privacy" }]} /></div>
        </Spec>
      </Group>

      <Group id="tokens" title="Design tokens">
        <h3 className="fs-lg fw-bold mb-2">Colours ({theme === "dark" ? "night" : "day"}) <span className="fs-sm text-muted fw-regular">click a swatch to copy its code</span></h3>
        {COLOURS.map((g) => (
          <div key={g.role} className="mb-3">
            <p className="t-label text-muted mb-1">{g.role}</p>
            <div className="d-flex flex-wrap gap-2">{g.tokens.map((t) => <Swatch key={t} token={t} theme={theme} />)}</div>
          </div>
        ))}
        <h3 className="fs-lg fw-bold mt-4 mb-2">Contrast of the text-on-background pairs in use</h3>
        <Contrast theme={theme} />
        <h3 className="fs-lg fw-bold mt-4 mb-2">Typography</h3>
        <p className="fs-sm text-muted">Body: <code>--font-body</code> (Inter, then system-ui, Segoe UI, Roboto, sans-serif). Brand name only: <code>--font-brand</code> (Playfair Display, Georgia, serif). Code: <code>--font-mono</code>. Weights: 500, 600, 700, 800. Line heights 1.2 / 1.45 / 1.6. Label spacing .08em, uppercase.</p>
        <Table className="table table-sm align-middle">
          <thead><tr><th>Use</th><th>Token</th><th>Sample</th></tr></thead>
          <tbody>
            {SIZES.map(([use, tok, sample]) => (
              <tr key={use}>
                <td>{use}</td><td className="fs-sm">{tok}</td>
                <td><span className={use.startsWith("Label") ? "t-label" : use.startsWith("Tabular") ? "t-num" : ""} style={{ fontSize: `var(${tok})` }}>{sample}</span></td>
              </tr>
            ))}
          </tbody>
        </Table>
        <h3 className="fs-lg fw-bold mt-4 mb-2">Spacing, radius, shadows</h3>
        <div className="d-flex flex-wrap gap-3 mb-3">
          {SPACE.map(([c, v]) => <div key={c} className="text-center"><div style={{ width: v, height: v, background: "var(--p600)", borderRadius: 2 }} /><p className="fs-xs text-muted mb-0 mt-1">{c} {v}</p></div>)}
          {[["6px", "chips"], ["10px", "cards"], ["999px", "pills"]].map(([r, n]) => <div key={r} className="text-center"><div style={{ width: 56, height: 36, border: "2px solid var(--p600)", borderRadius: r }} /><p className="fs-xs text-muted mb-0 mt-1">radius {r} {n}</p></div>)}
          {["--sh-sm", "--hms-shadow-md"].map((s) => <div key={s} className="text-center"><div style={{ width: 72, height: 44, background: "var(--surface)", borderRadius: 10, boxShadow: `var(${s})` }} /><p className="fs-xs text-muted mb-0 mt-1">{s}</p></div>)}
        </div>
        <h3 className="fs-lg fw-bold mt-3 mb-2">Breakpoints, icons, layers</h3>
        <ul className="fs-sm">
          <li>Spacing: Bootstrap scale 0.25, 0.5, 1, 1.5, 3 rem (classes <code>p-1 .. p-5</code>, <code>gap-*</code>).</li>
          <li>Radius: <code>--radius-sm</code> 6px for chips, 10px for cards, 999px for pills (kit classes).</li>
          <li>Shadows: <code>--hms-shadow-md</code>, <code>--sh-sm</code> (see pms-ui.css).</li>
          <li>Breakpoints: 576 (phone), 768 (tablet), 992 (side menu opens), 1200, 1400 px.</li>
          <li>Icons: Bootstrap Icons through <code>Bi</code>, 14, 16, 20, 24 px.</li>
          <li>Layers: header 1030, side menu 1040, modal 1055, toast 1090 (Bootstrap).</li>
        </ul>
        <p className="fs-sm text-muted">Icons used here: <Bi name="check-circle" /> <Bi name="info-circle" /> <Bi name="exclamation-triangle" /> <Bi name="x-octagon" /></p>
      </Group>
    </main>
  );
}
