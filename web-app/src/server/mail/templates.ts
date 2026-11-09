import "server-only";
import { amountInWords, formatDate, formatDateTime, formatINR, formatWeekdayDate } from "@shared/dashboards/format";
import { durationText } from "@shared/dashboards/security";
import type { MailPayload } from "../services/auth/mail";
import { langOf, PRODUCT_NAME, safeUrl, type MailBlock, type MailDetail, type MailLayout } from "./layout";
import type { MailKind } from "./routes";

// The words of every email (redesign 5 Nov 2026): a short subject with the one fact that matters, a preheader, one heading, plain paragraphs, a details table and
// at most one button. The plain-text part is made from the same pieces (layout.ts renderMailText). Dates "05 Nov 2026", times "3:05 pm", money formatINR.

export interface MailContext {
  /** Where the app is served (HMS_PUBLIC_URL): the "Sign in" button of account mail. */
  publicUrl?: string | null;
}

export interface Composed {
  subject: string;
  layout: Omit<MailLayout, "brand" | "sentWith">;
}

type Template = (p: MailPayload, ctx: MailContext) => Composed;

const P = PRODUCT_NAME;
const hello = (p: MailPayload): string => `Hello ${p.name},`;
const note = (text: string): MailBlock => ({ kind: "note", text });
const text = (t: string): MailBlock => ({ kind: "text", text: t });
const ACCOUNT_WHY = `You get this email because you have an ${P} account.`;
/** temp_password, admin_reset: how long the temporary password works (MJ, 5 Nov 2026), when the payload says it. */
const tempPasswordNote = (p: MailPayload): string =>
  p.minutes
    ? `Keep this email private. The temporary password works for ${durationText(p.minutes)}. After that, ask your administrator to send a new one.`
    : "Keep this email private. The temporary password stops working once you choose your own.";

/** A moment as "12 Nov 2026, 3:05 pm" (IST); something that is not a moment stays as it was. */
export const whenOf = (v: string): string => (/^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v)) ? formatDateTime(v) : v);
/** A day as "05 Nov 2026"; something that is not a date stays as it was. */
export const dayOf = (v: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDate(v) : v);
/** A day with its weekday: "Thu, 12 Nov 2026". */
const weekdayOf = (v: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? formatWeekdayDate(v) : v);

/** Nights between two plain dates, or null. */
export function nightsOf(checkIn?: string, checkOut?: string): number | null {
  if (!checkIn || !checkOut || !/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut)) return null;
  const n = Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000);
  return n > 0 ? n : null;
}

/** A stay for a subject line: "12-14 Nov", "30 Nov-02 Dec", "30 Dec 2026-02 Jan 2027". */
export function stayShort(checkIn?: string, checkOut?: string): string | null {
  if (nightsOf(checkIn, checkOut) === null) return null;
  const [a, b] = [formatDate(checkIn as string).split(" "), formatDate(checkOut as string).split(" ")];
  if (a[2] !== b[2]) return `${a.join(" ")}-${b.join(" ")}`;
  if (a[1] !== b[1]) return `${a[0]} ${a[1]}-${b[0]} ${b[1]}`;
  return `${a[0]}-${b[0]} ${b[1]}`;
}

/** The rows of a stay: check-in, check-out (with their weekdays) and the nights. */
export function stayRows(p: Pick<MailPayload, "roomName" | "checkIn" | "checkOut" | "guests">): MailDetail[] {
  const nights = nightsOf(p.checkIn, p.checkOut);
  return [
    ...(p.roomName ? [{ label: "Room", value: p.roomName }] : []),
    ...(p.checkIn ? [{ label: "Check-in", value: weekdayOf(p.checkIn) }] : []),
    ...(p.checkOut ? [{ label: "Check-out", value: weekdayOf(p.checkOut) }] : []),
    ...(nights ? [{ label: "Nights", value: String(nights) }] : []),
    ...(p.guests ? [{ label: "Guests", value: String(p.guests) }] : []),
  ];
}

/** The "Sign in" button of account mail, when the app's address is known. */
const signInButton = (ctx: MailContext, p?: MailPayload): MailLayout["button"] => {
  const url = safeUrl(p?.link) ?? safeUrl(ctx.publicUrl);
  return url ? { label: `Sign in to ${P}`, url } : null;
};

const signInDetails = (p: MailPayload): MailDetail[] => [
  { label: "Username", value: p.username ?? "" },
  { label: "Temporary password", value: p.tempPassword ?? "" },
];

/** Hours as the words a person uses: 168 is "7 days", 48 is "2 days", 5 is "5 hours". */
export const hoursAsWords = (h: number): string => (h % 24 === 0 ? `${h / 24} ${h === 24 ? "day" : "days"}` : `${h} ${h === 1 ? "hour" : "hours"}`);

const INVITE_WHY = `You get this email because someone invited you to ${P}.`;

function invitation(p: MailPayload): Composed {
  const name = p.hotelName ?? "your hotel";
  const by = p.invitedBy ?? `The ${P} team`;
  const valid = hoursAsWords(p.validHours ?? 168);
  const member = p.inviteType === "member_hotel" && p.groupName;
  const group = p.inviteType === "group";
  const subject = member ? `${p.groupName} invited ${name} to ${P}` : `${name} is invited to join ${P}`;
  const intro = member
    ? `${by}, the admin of ${p.groupName}, invited ${name} to join the group on ${P}.`
    : group
      ? `${by} from ${P} invited your hotel group, ${name}, to join ${P}.`
      : `${by} from ${P} invited ${name} to join ${P}.`;
  return {
    subject,
    layout: {
      preheader: `Fill in the onboarding form. The link works for ${valid}.`,
      heading: member ? `Join ${p.groupName}` : `Join ${P}`,
      greeting: hello(p),
      blocks: [text(intro), { kind: "steps", items: [`Fill in the onboarding form with the details of ${group ? "the group" : "the hotel"} and choose your password.`, "We check the form.", "Once it is approved, we email you and you can sign in."] }],
      details: [{ label: group ? "Group" : "Hotel", value: name }, ...(member ? [{ label: "Group", value: p.groupName as string }] : []), { label: "Invited by", value: by }],
      button: { label: "Fill in the onboarding form", url: p.link ?? "" },
      after: [note(`The link works once, for ${valid}. If you did not expect this invitation, ignore this email.`)],
      why: INVITE_WHY,
    },
  };
}

const hotelOf = (p: MailPayload, fallback = "the hotel"): string => p.hotelName ?? fallback;
const GUEST_CALL = "If anything needs to change, call us or reply to this email.";

/** The subject's stay part: "12-14 Nov, Deluxe Room", or the reference when no dates are known. */
const staySubject = (p: MailPayload): string => [stayShort(p.checkIn, p.checkOut), p.roomName].filter((x): x is string => Boolean(x)).join(", ") || (p.reference ?? "");

/** A hotel's payment link: the amount in figures and in words, what it is for, one Pay button. Old queued mails without the amount keep their message. */
function paymentLink(p: MailPayload): Composed {
  const hotel = hotelOf(p, "Your hotel");
  const amount = typeof p.amountPaise === "number" && p.amountPaise > 0 ? formatINR(p.amountPaise) : null;
  return {
    subject: amount ? `Payment request from ${hotel}: ${amount}` : `${hotel}: ${p.subject ?? "Payment request"}`,
    layout: {
      preheader: amount ? `${amount}${p.forWhat ? ` for ${p.forWhat}` : ""}. Pay securely online.` : "Pay securely online.",
      heading: "Payment request",
      greeting: hello(p),
      blocks: [text(amount ? `${hotel} asks you to pay online with the button below.` : `${hotel} sent you a payment link${p.message ? `: ${p.message}` : "."}`)],
      details: amount ? [{ label: "Amount", value: amount, strong: true }, { label: "In words", value: amountInWords(p.amountPaise as number) }, ...(p.forWhat ? [{ label: "For", value: p.forWhat }] : [])] : [],
      button: { label: amount ? `Pay ${amount}` : "Pay now", url: p.link ?? "" },
      after: [note("Pay only through this button. The hotel will never ask for your card number, PIN or one-time password by email or phone."), note("If you did not expect this request, call the hotel before you pay.")],
      why: `You get this email because ${hotel} sent you a payment request.`,
    },
  };
}

/** The hotel's answer to a problem with an online payment the guest raised. */
function paymentProblemAnswer(p: MailPayload): Composed {
  const hotel = hotelOf(p, "Your hotel");
  return {
    subject: `${hotel} answered your payment problem ${p.reference ?? ""}`.trim(),
    layout: {
      preheader: p.subject ?? "Read the answer.",
      heading: "We answered your payment problem",
      greeting: hello(p),
      blocks: [text(`${hotel} answered the problem you raised with an online payment.`)],
      details: [{ label: "Problem number", value: p.reference ?? "" }, ...(p.subject ? [{ label: "Subject", value: p.subject }] : [])],
      after: [...(p.message ? [{ kind: "quote" as const, text: p.message }] : []), note("You can read it, and raise another problem, on the Support page of your account.")],
      why: `You get this email because you raised a payment problem with ${hotel}.`,
    },
  };
}

/** A notice the hotel sent to the companies it works with (Companies > Notifications), also emailed. */
function companyNotice(p: MailPayload): Composed {
  const hotel = hotelOf(p, "Your hotel");
  return {
    subject: `${hotel}: ${p.subject ?? "A notice for your company"}`,
    layout: {
      preheader: (p.message ?? "").split(/\r?\n/)[0]?.slice(0, 120) || `A notice from ${hotel}.`,
      heading: p.subject ?? "A notice for your company",
      greeting: hello(p),
      blocks: [text(`${hotel} sent your company this notice:`), ...(p.message ? [{ kind: "quote" as const, text: p.message }] : [])],
      after: [note("You can also read it, and mark it as read, in your company portal under Notifications.")],
      why: `You get this email because your company works with ${hotel}.`,
    },
  };
}
/** A campaign: the hotel's own subject and words (already written for this person, in the language the hotel chose), paragraph by paragraph, no greeting added. */
function campaign(p: MailPayload): Composed {
  const body = p.text ?? "";
  const paragraphs = body.split(/\r?\n\s*\r?\n/).filter((x) => x.trim() !== "");
  const lead = paragraphs.find((x) => x.trim().length > 40) ?? paragraphs[0] ?? "";
  return {
    subject: p.subject ?? "",
    layout: {
      preheader: lead.replace(/\s+/g, " ").trim().slice(0, 140),
      blocks: paragraphs.map((t) => text(t)),
      unsubscribe: { why: "You get this email because you stayed with us or have an account with us.", url: p.unsubscribeUrl ?? null },
      lang: langOf(`${p.subject ?? ""} ${body}`),
    },
  };
}

export const TEMPLATES: Record<MailKind, Template> = {
  campaign: (p) => campaign(p),
  enquiry_confirmed: (p) => ({
    subject: `Booking confirmed: ${staySubject(p)}`,
    layout: {
      preheader: `${hotelOf(p)} looks forward to welcoming you. Reference ${p.reference ?? ""}`.trim(),
      heading: "Your booking is confirmed",
      greeting: hello(p),
      blocks: [text(`${hotelOf(p, "The hotel")} has confirmed your booking. Please keep this email: the reference helps the front desk find your booking quickly.`)],
      details: [{ label: "Reference", value: p.reference ?? "" }, ...stayRows(p)],
      after: [text(`We look forward to welcoming you. ${GUEST_CALL}`)],
      why: `You get this email because you asked for a booking on the website of ${hotelOf(p)}.`,
    },
  }),
  enquiry_declined: (p) => ({
    subject: `We cannot confirm your booking request${stayShort(p.checkIn, p.checkOut) ? ` for ${stayShort(p.checkIn, p.checkOut)}` : ""}`,
    layout: {
      preheader: p.reason ?? "Call us and we will help you find other dates or another room.",
      heading: "We cannot confirm your booking request",
      greeting: hello(p),
      blocks: [text(`Sorry, ${hotelOf(p)} cannot confirm your booking request.`)],
      details: [{ label: "Reference", value: p.reference ?? "" }, ...stayRows(p), ...(p.reason ? [{ label: "Reason", value: p.reason }] : [])],
      after: [text("Call us or reply to this email, and we will help you find other dates or another room.")],
      why: `You get this email because you asked for a booking on the website of ${hotelOf(p)}.`,
    },
  }),
  bill_invoice: (p) => ({
    subject: `Your invoice${p.number ? ` ${p.number}` : ""} from ${hotelOf(p)}`,
    layout: {
      preheader: "Your invoice is attached as a PDF.",
      heading: "Your invoice",
      greeting: hello(p),
      blocks: [text(`Thank you for staying with ${hotelOf(p, "us")}. Your invoice is attached to this email as a PDF.`)],
      details: p.number ? [{ label: "Invoice number", value: p.number }] : [],
      after: [note("Please keep it for your records. If anything on it looks wrong, reply to this email or call us.")],
      why: `You get this email because you stayed at ${hotelOf(p)}.`,
    },
  }),
  advance_receipt: (p) => ({
    subject: `Your receipt${p.number ? ` ${p.number}` : ""} from ${hotelOf(p)}`,
    layout: {
      preheader: "Your receipt is attached as a PDF.",
      heading: "Thank you for your payment",
      greeting: hello(p),
      blocks: [text(`${hotelOf(p, "The hotel")} received your payment. Your receipt is attached to this email as a PDF.`)],
      details: p.number ? [{ label: "Receipt number", value: p.number }] : [],
      after: [note("Please keep it for your records. If anything on it looks wrong, reply to this email or call us.")],
      why: `You get this email because you made a payment to ${hotelOf(p)}.`,
    },
  }),
  // one kind, three mails: a payment link, the answer to a payment problem, and a notice to a company (company mail)
  notification: (p) => (p.link && !p.reference ? paymentLink(p) : p.reference ? paymentProblemAnswer(p) : companyNotice(p)),
  enquiry_new: (p) => ({
    subject: `New website enquiry: ${[p.guestName, stayShort(p.checkIn, p.checkOut)].filter(Boolean).join(", ") || (p.reference ?? "")}`,
    layout: {
      preheader: `${p.guestName ?? "A guest"} asked about ${p.roomName ?? "a stay"}. Please answer soon.`,
      heading: "New enquiry from your website",
      greeting: hello(p),
      blocks: [text(`A guest sent an enquiry through the website of ${hotelOf(p, "your hotel")}. Please answer it soon.`)],
      details: [{ label: "Reference", value: p.reference ?? "" }, { label: "Name", value: p.guestName ?? "" }, { label: "Phone", value: p.guestPhone ?? "" }, ...(p.guestEmail ? [{ label: "Email", value: p.guestEmail }] : []), ...stayRows(p)],
      after: [...(p.message ? [{ kind: "quote" as const, text: p.message }] : []), note(`Open Website > Guest Enquiries in ${P} to confirm or decline it.`)],
      why: `You get this email because you are on the enquiry list of ${hotelOf(p, "your hotel")}.`,
    },
  }),
  daily_summary: (p) => ({
    subject: `Daily summary: ${hotelOf(p, "your hotel")}${p.date ? `, ${dayOf(p.date)}` : ""}`,
    layout: {
      preheader: `How the day went at ${hotelOf(p, "your hotel")}.`,
      heading: "Your hotel today",
      greeting: hello(p),
      blocks: [text(`Here is the day at ${hotelOf(p, "your hotel")}${p.date ? ` (${dayOf(p.date)})` : ""}.`), { kind: "box", text: p.summary ?? "" }],
      after: [note(`Open ${P} for the details.`)],
      why: "You get this summary every evening. Change who gets it under Settings > Email.",
    },
  }),
  invitation: (p) => invitation(p),
  onboarding_waiting: (p) => ({
    subject: `We received the form for ${p.hotelName ?? "your hotel"}`,
    layout: {
      preheader: "It is waiting for approval. We will email you.",
      heading: "We received your form",
      greeting: hello(p),
      blocks: [text(`Thank you. The onboarding form for ${p.hotelName ?? "your hotel"} is waiting for approval.`), text("We will email you as soon as it is checked. You can sign in once it is approved.")],
      why: INVITE_WHY,
    },
  }),
  onboarding_approved: (p, ctx) => ({
    subject: `${p.hotelName ?? "Your hotel"} is approved: you can sign in now`,
    layout: {
      preheader: "Sign in with your username and the password you chose.",
      heading: "You can sign in now",
      greeting: hello(p),
      blocks: [text(`${p.hotelName ?? "Your hotel"} is approved on ${P}. Sign in with your username and the password you chose on the form.`)],
      details: [{ label: "Username", value: p.username ?? "" }],
      button: signInButton(ctx, p),
      why: ACCOUNT_WHY,
    },
  }),
  onboarding_rejected: (p) => ({
    subject: `The form for ${p.hotelName ?? "your hotel"} was not approved`,
    layout: {
      preheader: p.reason ? `Reason: ${p.reason}` : "Contact the person who invited you.",
      heading: "Your form was not approved",
      greeting: hello(p),
      blocks: [text(`The onboarding form for ${p.hotelName ?? "your hotel"} was not approved.`)],
      details: p.reason ? [{ label: "Reason", value: p.reason }] : [],
      after: [note("If you have questions, contact the person who invited you.")],
      why: INVITE_WHY,
    },
  }),
  login_code: (p) => ({
    subject: `Your ${P} sign-in code`,
    layout: {
      preheader: `Enter it on the sign-in screen. It works for ${p.minutes ?? 10} minutes.`,
      heading: "Your sign-in code",
      greeting: hello(p),
      blocks: [text(`Enter this code on the sign-in screen. It works for ${p.minutes ?? 10} minutes.`), { kind: "code", text: p.code ?? "" }],
      after: [note(`Nobody from ${P} or your hotel will ever ask you for this code.`), note("If you did not try to sign in, change your password now.")],
      why: ACCOUNT_WHY,
    },
  }),
  reset_code: (p) => ({
    subject: `Your ${P} password reset code`,
    layout: {
      preheader: `Enter it to choose a new password. It works for ${p.minutes ?? 10} minutes.`,
      heading: "Your password reset code",
      greeting: hello(p),
      blocks: [text(`Enter this code to choose a new password. It works for ${p.minutes ?? 10} minutes.`), { kind: "code", text: p.code ?? "" }],
      after: [note(`Nobody from ${P} or your hotel will ever ask you for this code.`), note("If you did not ask to reset your password, ignore this email. Your password stays as it is.")],
      why: ACCOUNT_WHY,
    },
  }),
  reset_link: (p) => ({
    subject: `Reset your ${P} password`,
    layout: {
      preheader: `The link works once, for ${p.minutes ?? 15} minutes.`,
      heading: "Choose a new password",
      greeting: hello(p),
      blocks: [text(`We got a request to reset the password of your account. The button works once, for ${p.minutes ?? 15} minutes.`)],
      button: { label: "Choose a new password", url: p.link ?? "" },
      after: [note("If you did not ask for this, ignore this email. Your password stays as it is.")],
      why: ACCOUNT_WHY,
    },
  }),
  password_changed: (p, ctx) => ({
    subject: `Your ${P} password was changed`,
    layout: {
      preheader: "You were signed out on every device.",
      heading: "Your password was changed",
      greeting: hello(p),
      blocks: [text("The password of your account was just changed, and you were signed out on every device. Sign in again with the new password.")],
      button: signInButton(ctx, p),
      after: [note("If you did not change it, contact the person who gave you this account now.")],
      why: ACCOUNT_WHY,
    },
  }),
  email_changed: (p) => ({
    subject: `The email address of your ${P} account was changed`,
    layout: {
      preheader: "Account emails now go to the new address.",
      heading: "Your email address was changed",
      greeting: hello(p),
      blocks: [text("The email address of your account was changed. From now on, sign-in codes and account emails go to the new address.")],
      after: [note("If you did not change it, contact the person who gave you this account now.")],
      why: ACCOUNT_WHY,
    },
  }),
  account_locked: (p) => ({
    subject: `Your ${P} account is locked for now`,
    layout: {
      preheader: p.until ? `You can sign in again from ${whenOf(p.until)}.` : "Too many wrong sign-in attempts.",
      heading: "Your account is locked for now",
      greeting: hello(p),
      blocks: [text("There were too many wrong sign-in attempts, so we locked your account to keep it safe.")],
      details: p.until ? [{ label: "Locked until", value: whenOf(p.until) }] : [],
      after: [text("After that you can sign in again. If you forgot your password, choose Forgot password on the sign-in screen."), note("If these attempts were not you, change your password as soon as you are back in.")],
      why: ACCOUNT_WHY,
    },
  }),
  account_blocked: (p) => ({
    subject: `Your ${P} account was blocked`,
    layout: {
      preheader: "Contact your admin to get access again.",
      heading: "Your account was blocked",
      greeting: hello(p),
      blocks: [text("An administrator blocked your account, so you cannot sign in for now."), text("To get access again, contact the person who gave you this account.")],
      why: ACCOUNT_WHY,
    },
  }),
  new_device: (p) => ({
    subject: `New sign-in to your ${P} account`,
    layout: {
      preheader: `${p.deviceName ?? "A new phone"} signed in for the first time.`,
      heading: "A new phone signed in",
      greeting: hello(p),
      blocks: [text("Your account was just used on a phone it has not seen before.")],
      details: [{ label: "Phone", value: p.deviceName ?? "A new phone" }],
      after: [note("If this was you, there is nothing to do. If not, change your password now.")],
      why: ACCOUNT_WHY,
    },
  }),
  temp_password: (p, ctx) => ({
    subject: `Your ${P} account is ready`,
    layout: {
      preheader: "Sign in with your username and temporary password.",
      heading: "Your account is ready",
      greeting: hello(p),
      blocks: [text(`An ${P} account was made for you. Sign in with these details:`)],
      details: signInDetails(p),
      button: signInButton(ctx, p),
      after: [{ kind: "steps", items: ["Sign in with the username and temporary password above.", "Choose your own password when you are asked."] }, note(tempPasswordNote(p))],
      why: ACCOUNT_WHY,
    },
  }),
  admin_reset: (p, ctx) => ({
    subject: `Your ${P} password was reset`,
    layout: {
      preheader: "Sign in with the temporary password and choose your own.",
      heading: "Your password was reset",
      greeting: hello(p),
      blocks: [text("An administrator reset your password and signed you out on every device. Sign in with these details:")],
      details: signInDetails(p),
      button: signInButton(ctx, p),
      after: [{ kind: "steps", items: ["Sign in with the username and temporary password above.", "Choose your own password when you are asked."] }, note(tempPasswordNote(p))],
      why: ACCOUNT_WHY,
    },
  }),
};
