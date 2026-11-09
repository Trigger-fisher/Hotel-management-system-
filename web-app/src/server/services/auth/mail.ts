import "server-only";
import { isAppError } from "../../errors";
import { failureCodeOf, isPermanentFailure } from "../../mail/failure";
import { platformBrand, renderMailHtml, renderMailText, type MailBrand } from "../../mail/layout";
import { laneOf, MAIL_ROUTE, type MailKind } from "../../mail/routes";
import { TEMPLATES } from "../../mail/templates";
import { messageIdOf } from "../../mail/safety";
import type { AuthRepos, OutboxRecord, PlatformUnit } from "../../repos/auth";
import { mailWake } from "./mailWake";

// The mail queue. Every email the system sends (sign-in and reset codes, "your password changed", "your account was locked", "new phone")
// is a row in platform.outbox: the address and the payload are plain text columns (nothing is encrypted by the application), the one-time
// code is ONLY ever inside the payload, and the worker removes the payload as soon as the mail is sent or has failed for good. Nothing is sent inline during a request, so the answer takes the same time whether or not an address exists (nothing to learn
// from the timing). The sender is a port: a fake in tests, nodemailer later.
export type { MailKind };
/** The kinds that carry a PDF made when the mail is sent (not stored in the outbox). */
export const ATTACHMENT_KINDS: readonly MailKind[] = ["bill_invoice", "advance_receipt"];

export interface MailPayload {
  /** The one-time code (login_code, reset_code). */
  code?: string;
  minutes?: number;
  /** account_locked: when the lock ends (ISO). */
  until?: string;
  deviceName?: string;
  /** The name to greet. */
  name: string;
  /** temp_password, admin_reset: the sign-in name and the temporary password (only ever inside the payload). */
  username?: string;
  tempPassword?: string;
  /** invitation: the one-time onboarding link; reset_link: the one-time password reset link (both only ever inside the payload) and how long they work. */
  link?: string;
  validHours?: number;
  /** invitation, onboarding_*: the hotel (or group) name, who invited, and the reason of a rejection. */
  hotelName?: string;
  invitedBy?: string;
  reason?: string;
  /** invitation: what is invited (a hotel, a group, or a member hotel of a group) and, for a member hotel, the group's name. */
  inviteType?: "hotel" | "group" | "member_hotel";
  groupName?: string;
  /** enquiry_confirmed, enquiry_declined: the enquiry's reference, the room asked for and the stay. */
  reference?: string;
  roomName?: string;
  checkIn?: string;
  checkOut?: string;
  /** enquiry_new (to the hotel): who asked and what. Only ever inside the payload, which goes as soon as the mail is sent or lost. */
  guestName?: string;
  guestPhone?: string;
  guestEmail?: string;
  guests?: number;
  message?: string;
  /** daily_summary (to the owner): the day (YYYY-MM-DD) and the summary's lines, already written. */
  date?: string;
  summary?: string;
  /** campaign (Email Marketing): the hotel's own subject and message (already written for this person) and the person's unsubscribe link. */
  subject?: string;
  text?: string;
  unsubscribeUrl?: string;
  /** bill_invoice, advance_receipt: the bill (or advance) id the PDF is made from at send time, and the number printed on it. Never the amounts or the guest's details. */
  billId?: string;
  advanceId?: string;
  number?: string;
  /** notification (a payment link): the amount in paise and what it is for. */
  amountPaise?: number;
  forWhat?: string;
}

/** Queues one mail. `hotelId` names the hotel whose own mail server sends it (mail/hotelSmtp.ts); without one the platform sender does. The worker is woken. */
export async function queueMail(
  repos: AuthRepos,
  mail: { userId: string | null; kind: MailKind; toEmail: string; payload: MailPayload; hotelId?: string | null },
  now: Date,
): Promise<void> {
  await repos.outbox.enqueue(
    {
      userId: mail.userId,
      hotelId: mail.hotelId ?? null,
      kind: mail.kind,
      toEmail: mail.toEmail,
      template: mail.kind.replace(/_/g, "-"),
      payload: JSON.stringify(mail.payload),
    },
    now,
  );
  mailWake.touch();
}

/** What a business service needs to send a mail: queue it (the worker sends it, from the right mail server for its kind). Nothing is sent inside the request. */
export interface MailQueue {
  queue(mail: { kind: MailKind; hotelId: string | null; toEmail: string; payload: MailPayload }): Promise<void>;
}

export function createMailQueue(unit: PlatformUnit, now: () => Date): MailQueue {
  return { queue: (mail) => unit.run((r) => queueMail(r, { userId: null, ...mail }, now())) };
}

export interface MailMessage {
  to: string;
  /** Copy recipients of a Conversations email (at most 5): a real Cc header, so the person written to sees who else got it. */
  cc?: string[];
  /** Hidden copy recipients (at most 5): delivered, but never written into the message, so nobody else sees them. */
  bcc?: string[];
  subject: string;
  text: string;
  /** The same mail in the shared HTML layout (mail/layout.ts); the text part is always sent too. */
  html?: string;
  /** The hotel whose mail server should send it; null = the platform's. */
  hotelId?: string | null;
  /** Use the deployment's SMTP_FROM for this platform email, ignoring a platform-settings sender override. */
  useEnvironmentFrom?: boolean;
  /** Replies go here (the hotel's own address when its mail goes out through the platform sender). */
  replyTo?: string;
  /** A Conversations reply: the Message-ID it answers and the ids before it, so the guest's mail program keeps it in the same thread (In-Reply-To and References). */
  inReplyTo?: string;
  references?: string[];
  /** The display name of the From address, used only when a hotel's mail goes out through the platform sender (the hotel's name instead of the platform's). */
  fromName?: string;
  /** The local part of the hotel's own address on the platform's sending domain (its slug): set when a hotel mail goes out through the platform sender, which makes <fromLocal>@<sending domain> the From address. */
  fromLocal?: string;
  /** The full From address, set only when a hotel's own verified domain is used through the platform sender (mail/identity.ts): only the router sets it, after the DNS check and the SES confirmation. */
  fromAddress?: string;
  /** PDFs made for this mail (an invoice, a receipt) and files added to an email. At most 25 MB in all, none of a type Gmail refuses. */
  attachments?: MailAttachment[];
  /** Our Message-ID (mail/safety.ts messageIdOf): the mail services report it back with a bounce or a complaint, so the event finds the hotel that sent it. */
  messageId?: string;
  /** Extra headers: List-Unsubscribe on campaign mail. Only these names are sent (smtp.ts). */
  headers?: { "List-Unsubscribe"?: string; "List-Unsubscribe-Post"?: "List-Unsubscribe=One-Click" };
  /** What kind of mail this is (the outbox kind, "test"...): sent as X-HMS-Kind, so reading a mailbox never lists HMS's own mail (decision 66). Default "system". */
  kind?: string;
}

export interface MailAttachment {
  filename: string;
  /** application/pdf for a bill or receipt made by HMS; any type for a file added to an email (mail/files.ts), by the Gmail rules. */
  contentType: string;
  content: Uint8Array;
}

export interface MailSender {
  send(message: MailMessage): Promise<void>;
}

/** The sign-in page of the app, for the first-sign-in mails (one obvious action: a Sign in button). */
export function signInLink(publicUrl?: string): string {
  return `${(publicUrl ?? process.env.HMS_PUBLIC_URL ?? "http://localhost:3000").replace(/\/+$/, "")}/login`;
}

/** A time sent as ISO (UTC) written for people in India: "10:45 pm, 5 Nov". Anything that is not a time is shown as it came. */
export function istTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true, day: "numeric", month: "short" }).formatToParts(d);
  const get = (t: string): string => parts.find((x) => x.type === t)?.value ?? "";
  return `${get("hour")}:${get("minute")} ${get("dayPeriod").toLowerCase()}, ${get("day")} ${get("month")}`;
}

/**
 * The subject, the text part and the HTML part of a mail (the words: mail/templates.ts; the look: mail/layout.ts). `brand` is who it is from: the hotel's name, logo and
 * contact for hotel mail (the worker's brandOf), the platform's for system mail; without one a hotel mail shows the hotel name of its payload. `publicUrl` is where the
 * app is served: the platform's logo and the Sign in buttons come from there.
 */
export function renderMail(kind: MailKind, p: MailPayload, brand?: MailBrand | null, options: { publicUrl?: string | null } = {}): { subject: string; text: string; html: string } {
  // system mail is the product's (Easy Hotel Solutions); a hotel's mail is the hotel's own, with a small "Sent with Easy Hotel Solutions" under it
  const ofHotel = MAIL_ROUTE[kind] === "hotel";
  const platform = platformBrand(options.publicUrl);
  const from = ofHotel ? (brand ?? (p.hotelName ? { name: p.hotelName } : platform)) : platform;
  const made = TEMPLATES[kind](p, { publicUrl: options.publicUrl });
  const layout = { brand: from, ...made.layout, sentWith: ofHotel };
  return { subject: made.subject, text: renderMailText(layout), html: renderMailHtml(layout) };
}
interface WorkerOptions {
  unit: PlatformUnit;
  sender: MailSender;
  now: () => Date;
  /** Tries before a mail is given up (then the payload is removed). */
  maxAttempts?: number;
  /** Rows claimed in one pass. Default 50. */
  batch?: number;
  /** Mails in flight at once (each is one SMTP conversation; hotels' pooled transports cap their own connections). Default 8. */
  concurrency?: number;
  /** Makes the PDFs of an invoice or receipt mail at send time from the hotel's own data (nothing is stored in the outbox). Absent = such a mail fails with the reason RENDER. */
  attach?: (row: OutboxRecord, payload: MailPayload) => Promise<MailAttachment[]>;
  /** The hotel's name, logo and contact for the HTML layout of its mail (read once a minute: mail/layout.ts cachedBrandOf). Absent or failing = the payload's hotel name. */
  brandOf?: (hotelId: string) => Promise<MailBrand | null>;
  /** Where the app is served (HMS_PUBLIC_URL): the platform's logo in system mail comes from there (https only). */
  publicUrl?: string | null;
  /**
   * Turns the lanes on (MAIL-PROVIDERS-50K): the system lane is always served first, then each hotel's campaign mail within what its mail service, its own daily limit and the Super Admin's cap
   * allow today, paced to the service's mails-a-second. Absent = the plain claim (system mail first, then the rest, no limits).
   */
  policy?: BulkPolicy;
}

/** What the mail service of a hotel (or the platform one it falls back to) allows for campaign mail. 0 = no fixed limit. */
export interface BulkLimits {
  perSecond: number;
  perDay: number;
}
export interface BulkPolicy {
  limitsOf(hotelId: string): Promise<BulkLimits>;
  /** Tests: waits this long between mails of a hotel when the limit says so. Default setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

/** The UTC day of a moment, "YYYY-MM-DD": the key of the daily counts. */
export const utcDay = (d: Date): string => d.toISOString().slice(0, 10);

/** Waits so that no more than `perSecond` calls pass in a second (one pacer per hotel and pass). */
function pacer(perSecond: number, sleep: (ms: number) => Promise<void>): () => Promise<void> {
  if (!(perSecond > 0)) return async () => undefined;
  const gap = 1000 / perSecond;
  let nextAt = 0;
  return async () => {
    const at = Math.max(nextAt, Date.now());
    nextAt = at + gap;
    const wait = at - Date.now();
    if (wait > 0) await sleep(wait);
  };
}

/** The outbox worker's default pass size and parallelism. */
export const OUTBOX_BATCH = 50;
export const OUTBOX_CONCURRENCY = 8;

/**
 * One pass of the mail worker: claim what is due, send it `concurrency` mails at a time, remove the payload of what is sent or lost, retry the rest later
 * (1, 2, 3, 4 minutes between tries). Returns how many were sent. A pass that claimed a full batch is a sign more is waiting (the caller may run another).
 */
export async function runOutboxOnce(options: WorkerOptions): Promise<number> {
  return (await runOutboxPass(options)).sent;
}

/**
 * The same pass, with the number of rows it claimed and whether more is probably waiting (`more`): the system lane filled the whole batch, or some hotel took its whole
 * share of campaign mail. The drain runs another pass while `more` is true (MAIL-LOAD-REPORT F1: "fewer than a full batch" is not "nothing more", when a capped or held
 * hotel had mail waiting).
 */
export async function runOutboxPass(options: WorkerOptions): Promise<{ claimed: number; sent: number; more: boolean }> {
  const { unit, sender, now } = options;
  const maxAttempts = options.maxAttempts ?? 5;
  const batch = options.batch ?? OUTBOX_BATCH;
  const day = utcDay(now());
  const pace = new Map<string, () => Promise<void>>();
  const counts = new Map<string, number>();
  let due: OutboxRecord[];
  let more = false;
  if (!options.policy) {
    due = await unit.run((r) => r.outbox.claimDue(now(), batch));
    more = due.length >= batch;
  } else {
    const policy = options.policy;
    // the SYSTEM lane first, always with the whole batch: a campaign can never delay a code
    due = await unit.run((r) => r.outbox.claimLane(now(), "system", batch));
    if (due.length >= batch) more = true;
    let room = batch - due.length;
    if (room > 0) {
      // a hotel whose campaign mail is on hold (too many bounces or complaints, platform 0130) is left out: its campaign mail waits until the Super Admin releases it
      const waiting = await unit.run((r) => r.outbox.bulkHotels(now()));
      const held = waiting.length > 0 ? await unit.run((r) => r.mailSafety.heldAmong(waiting)).catch(() => new Set<string>()) : new Set<string>();
      const hotels = waiting.filter((h) => !held.has(h));
      if (hotels.length > 0) {
        const [sentToday, caps] = await unit.run(async (r) => [await r.outbox.sentToday(hotels, day), await r.outbox.caps(hotels)] as const);
        const sleep = policy.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
        // FIRST what each hotel may still send today; only the hotels that may send share the batch (a capped hotel, or one whose settings cannot be read, takes
        // no share: before, it took one and left it unused, so the pass claimed less than a batch and the drain stopped)
        const able: { hotelId: string; limits: BulkLimits; allowance: number }[] = [];
        for (const hotelId of hotels) {
          let limits: BulkLimits;
          try {
            limits = await policy.limitsOf(hotelId);
          } catch {
            // the hotel's settings cannot be read: it is skipped this pass, its mail stays queued
            continue;
          }
          const cap = caps.get(hotelId);
          const perDay = cap === undefined ? limits.perDay : limits.perDay === 0 ? cap : Math.min(limits.perDay, cap);
          const allowance = perDay === 0 && cap === undefined ? Infinity : Math.max(0, perDay - (sentToday.get(hotelId) ?? 0));
          if (allowance >= 1) able.push({ hotelId, limits, allowance });
        }
        let left = able.length;
        for (const { hotelId, limits, allowance } of able) {
          const share = Math.max(1, Math.floor(room / left));
          left -= 1;
          const take = Math.min(share, allowance);
          const rows = await unit.run((r) => r.outbox.claimLane(now(), "bulk", take, hotelId));
          pace.set(hotelId, pacer(limits.perSecond, sleep));
          due.push(...rows);
          room -= rows.length;
          // the hotel had at least as much waiting as it was given, and may send more today: probably more to send
          if (rows.length >= take && take < allowance) more = true;
          if (room <= 0) break;
        }
      }
    }
  }
  // campaign mail never goes to a suppressed address (a hard bounce anywhere, a complaint or unsubscribe at that hotel): read once per hotel for the claimed rows
  const suppressed = new Set<string>();
  const bulkByHotel = new Map<string, string[]>();
  for (const row of due) if (row.hotelId && laneOf(row.kind) === "bulk") bulkByHotel.set(row.hotelId, [...(bulkByHotel.get(row.hotelId) ?? []), row.toEmail.toLowerCase()]);
  for (const [hotelId, emails] of bulkByHotel) {
    const hit = await unit.run((r) => r.mailSafety.suppressedAmong(hotelId, emails)).catch(() => new Set<string>());
    for (const e of hit) suppressed.add(`${hotelId}\n${e}`);
  }
  let sent = 0;
  let next = 0;
  async function one(row: OutboxRecord): Promise<void> {
    const attempts = row.attempts + 1;
    try {
      if (row.payload === null) throw new Error("no payload");
      if (row.hotelId && laneOf(row.kind) === "bulk" && suppressed.has(`${row.hotelId}\n${row.toEmail.toLowerCase()}`)) throw Object.assign(new Error("suppressed"), { reason: "SUPPRESSED" });
      // a hotel mail without a hotel can never be made or sent: failed at once (the database check keeps invoices from being queued so)
      if (MAIL_ROUTE[row.kind] === "hotel" && !row.hotelId) throw Object.assign(new Error("no hotel"), { reason: "NO_HOTEL" });
      const payload = JSON.parse(row.payload) as MailPayload;
      // campaign mail is paced to the mails-a-second of the hotel's service
      const wait = row.hotelId ? pace.get(row.hotelId) : undefined;
      if (wait && laneOf(row.kind) === "bulk") await wait();
      // the hotel's brand never fails a mail: none = the payload's hotel name
      const brand = row.hotelId && options.brandOf ? await options.brandOf(row.hotelId).catch(() => null) : null;
      const rendered = renderMail(row.kind, payload, brand, { publicUrl: options.publicUrl });
      let attachments: MailAttachment[] | undefined;
      if (ATTACHMENT_KINDS.includes(row.kind)) {
        if (!options.attach) throw Object.assign(new Error("no attachment maker"), { reason: "RENDER" });
        try {
          attachments = await options.attach(row, payload);
        } catch (error) {
          // opening a hotel that does not exist (or was removed) answers FORBIDDEN: not a rendering problem and not worth a retry
          throw Object.assign(new Error("attachment"), { reason: isAppError(error) && error.code === "FORBIDDEN" ? "NO_HOTEL" : "RENDER" });
        }
      }
      await sender.send({
        to: row.toEmail,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        hotelId: row.hotelId,
        useEnvironmentFrom: row.kind === "login_code",
        messageId: messageIdOf(row.id),
        kind: row.kind,
        ...(row.kind === "campaign" && payload.unsubscribeUrl ? { headers: { "List-Unsubscribe": `<${payload.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" as const } } : {}),
        ...(attachments ? { attachments } : {}),
      });
      await unit.run((r) => r.outbox.finish(row.id, { status: "sent", attempts, sentAt: now() }));
      sent += 1;
      counts.set(row.hotelId ?? "platform", (counts.get(row.hotelId ?? "platform") ?? 0) + 1);
    } catch (error) {
      // never log the address, the payload or the error text (it can carry the address); the row keeps the count and a short REASON CODE (mail/failure.ts)
      // a FORBIDDEN from opening the row's hotel is "the hotel is not available": an expected state of the data, not a server fault
      const reason = isAppError(error) && error.code === "FORBIDDEN" ? "NO_HOTEL" : failureCodeOf(error);
      // one row never breaks the pass: if even this bookkeeping fails, the row keeps its claim and comes due again later
      // a paused hotel or group (Platform > Hotel and group mail): the mail waits, without using up a try, and is looked at again every ten minutes (so it goes out within ten minutes of the pause ending)
      const finish = reason === "PAUSED" ? { status: "pending" as const, attempts: row.attempts, nextAttemptAt: new Date(now().getTime() + 10 * 60_000), error: reason } : attempts >= maxAttempts || isPermanentFailure(reason) ? { status: "failed" as const, attempts, error: reason } : { status: "pending" as const, attempts, nextAttemptAt: new Date(now().getTime() + attempts * 60_000), error: reason };
      await unit.run((r) => r.outbox.finish(row.id, finish)).catch(() => undefined);
    }
  }
  // `concurrency` lanes, each taking the next row until none is left (rows keep their claim order)
  const lanes = Array.from({ length: Math.max(1, Math.min(options.concurrency ?? OUTBOX_CONCURRENCY, due.length)) }, async () => {
    while (next < due.length) {
      const row = due[next];
      next += 1;
      await one(row);
    }
  });
  await Promise.all(lanes);
  // the day's count of each owner (the daily caps and the usage report); a failure to count never fails a mail that went
  if (counts.size > 0) await unit.run((r) => r.outbox.addSent([...counts.entries()].map(([scope, n]) => ({ scope, day, sent: n })))).catch(() => undefined);
  return { claimed: due.length, sent, more };
}
