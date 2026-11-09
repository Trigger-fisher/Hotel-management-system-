import "server-only";
import { z } from "zod";
import { CHANNEL_LABELS, CONV_CC_MAX, CONV_NOTE_MAX, CONV_QUICK_BODY_MAX, CONV_QUICK_TITLE_MAX, CONV_REPLY_MAX, CONV_SUBJECT_MAX, CONV_TABS, EMAIL_FOLDERS, type EmailFolder } from "@shared/dashboards/conversations";
import { SENT_MAIL_STATUSES } from "@shared/dashboards/sentMail";
import { WHATSAPP_AUTOMATIC_KEYS } from "@shared/dashboards/whatsapp";
import { searchParam } from "../../validation/listQuery";

// Request shapes of the Conversations routes (contract: ui-shared/dashboards/conversations.ts), the hotel's and the platform's alike. Bounded and strict; the service applies
// the rules and words (who may reply to which address, the bill rule, the lengths in plain sentences).
const NO_CONTROL = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;
const LINK_KINDS = ["customer", "stay", "reservation", "company", "user", "hotel"] as const;

export const conversationParams = z.strictObject({ id: z.uuid() });
export const messageParams = z.strictObject({ id: z.uuid(), messageId: z.uuid() });
export const attachmentParams = z.strictObject({ id: z.uuid(), messageId: z.uuid(), part: z.coerce.number().int().min(0).max(199) });
export const noteParams = z.strictObject({ id: z.uuid(), noteId: z.uuid() });
export const quickReplyParams = z.strictObject({ id: z.uuid() });

export const conversationListQuery = z.strictObject({
  search: searchParam,
  tab: z.enum(CONV_TABS as unknown as [string, ...string[]]).default("all"),
  channel: z.enum(["all", "email", "whatsapp"]).default("all"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  size: z.coerce.number().pipe(z.union([z.literal(25), z.literal(50), z.literal(100)])).default(25),
  /** The Email page (Gmail's folders and labels); wins over `tab`. */
  folder: z.enum(EMAIL_FOLDERS as unknown as [EmailFolder, ...EmailFolder[]]).optional(),
  label: z.enum(CHANNEL_LABELS as unknown as [string, ...string[]]).optional(),
  /** My mailbox: the threads with mail to or from this one of the person's addresses. */
  address: z.string().trim().toLowerCase().max(254).optional(),
});
export type ConversationListQueryInput = z.output<typeof conversationListQuery>;

/** The Email page's bulk actions on the ticked conversations. */
export const bulkBody = z.strictObject({
  ids: z.array(z.uuid()).min(1).max(100),
  action: z.enum(["snooze", "read", "unread", "done", "reopen", "star", "unstar", "other", "main", "trash"]),
});

/** Compose: a new email, or a draft of one. The service checks the addresses and words with the contract's sentences. */
export const composeBody = z.strictObject({
  to: z.string().max(320),
  cc: z.array(z.string().max(320)).max(CONV_CC_MAX).optional(),
  bcc: z.array(z.string().max(320)).max(CONV_CC_MAX).optional(),
  subject: z.string().max(CONV_SUBJECT_MAX + 100),
  text: z.string().max(CONV_REPLY_MAX + 100),
  attachments: z.array(z.string().max(300)).max(20).optional(),
  draft: z.boolean().optional(),
  /** My mailbox: one of the person's own addresses. */
  from: z.string().trim().max(254).optional(),
});
export type ComposeBody = z.output<typeof composeBody>;

/** A file about to be added to an email: its name and size, checked by the Gmail rules (mail/files.ts). */
export const mailFileBeginBody = z.strictObject({ name: z.string().min(1).max(300), size: z.number().int().min(0).max(1024 * 1024 * 1024) });
/** The file itself, only on a server with no bucket (a local disk); base64 because the API reads JSON. */
export const mailFileReceiveBody = z.strictObject({ ref: z.string().min(1).max(200), dataBase64: z.string().max(40 * 1024 * 1024) });

/** The "Sent through Amazon SES" list of the Email pages: one search, one status, a page. */
export const sentMailQuery = z.strictObject({
  search: searchParam,
  status: z.enum(SENT_MAIL_STATUSES).default("all"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  size: z.coerce.number().pipe(z.union([z.literal(25), z.literal(50), z.literal(100)])).default(25),
});
export type SentMailQueryInput = z.output<typeof sentMailQuery>;

export const threadQuery = z.strictObject({ before: z.iso.datetime({ offset: true }).optional() });
export const bodyQuery = z.strictObject({ images: z.enum(["0", "1"]).optional() });

export const syncBody = z.strictObject({ background: z.boolean().optional() });

/** PATCH /conversations/{id}: exactly one of assignedTo, status, box, or (the Email page) starred, labels, snoozedUntil. */
export const threadPatchBody = z
  .strictObject({
    assignedTo: z.uuid().nullable().optional(),
    status: z.enum(["open", "done"]).optional(),
    box: z.enum(["main", "other"]).optional(),
    starred: z.boolean().optional(),
    labels: z.array(z.enum(CHANNEL_LABELS as unknown as [string, ...string[]])).max(10).optional(),
    snoozedUntil: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .refine((b) => [b.assignedTo !== undefined, b.status !== undefined, b.box !== undefined, b.starred !== undefined, b.labels !== undefined, b.snoozedUntil !== undefined].filter(Boolean).length === 1, {
    message: "Send exactly one of assignedTo, status, box, starred, labels or snoozedUntil",
  });

const emailReply = z.strictObject({
  channel: z.literal("email"),
  inReplyTo: z.uuid().optional(),
  to: z.string().trim().max(254).optional(),
  cc: z.array(z.string().trim().max(254)).max(CONV_CC_MAX + 5).optional(),
  subject: z.string().max(CONV_SUBJECT_MAX + 100).regex(NO_CONTROL).optional(),
  text: z.string().max(CONV_REPLY_MAX + 100),
  billId: z.uuid().optional(),
  from: z.string().trim().max(254).optional(),
});
const whatsappReply = z.strictObject({
  channel: z.literal("whatsapp"),
  text: z.string().max(4096).optional(),
  templateId: z.string().max(200).optional(),
  variables: z.array(z.string().max(1000)).max(20).optional(),
  billId: z.uuid().optional(),
  replyToId: z.string().max(200).optional(),
});
export const replyBody = z.discriminatedUnion("channel", [emailReply, whatsappReply]);
export type ReplyBody = z.output<typeof replyBody>;

export const noteBody = z.strictObject({ text: z.string().max(CONV_NOTE_MAX + 100) });
export const linkBody = z.strictObject({ kind: z.enum(LINK_KINDS), targetId: z.uuid() });
export const linkCandidatesQuery = z.strictObject({ search: searchParam, kind: z.enum(LINK_KINDS).optional() });

export const quickReplyBody = z.strictObject({
  title: z.string().max(CONV_QUICK_TITLE_MAX + 20),
  body: z.string().max(CONV_QUICK_BODY_MAX + 100),
  channel: z.enum(["any", "email", "whatsapp"]).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

export const whatsappAutomaticBody = z.strictObject({ key: z.enum(WHATSAPP_AUTOMATIC_KEYS as unknown as [string, ...string[]]), on: z.boolean() });

/** PATCH /platform/conversations/mailbox */
export const platformMailboxBody = z.strictObject({
  reading: z.boolean(),
  imapHost: z.string().trim().max(253).optional(),
  // any whole number here: the service answers a port other than 993 or 143 with a plain sentence on the field
  imapPort: z.number().int().min(0).max(65535).optional(),
});

/** Every Conversations write: no body field is ever kept in the idempotency store (decision 66, A6). */
export const emptyBody = z.strictObject({});
