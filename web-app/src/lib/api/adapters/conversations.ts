// Conversations over /api/v1/conversations (the hotel's hub) and /api/v1/platform/conversations (the platform's own mailbox), decision 66. Same TypeScript
// interface as the mock (ui-shared/dashboards/conversations.mock.ts); the paths are CONVERSATIONS_ROUTES and PLATFORM_MAILBOX_ROUTES of the contract.
// The list, the summary and an open thread are polled and change on the server by themselves (new mail): they always read the server, never the 20 s memory of
// GET answers (lib/api/getCache.ts). Every write is sent WITHOUT an Idempotency-Key (`idempotent: false`): no reply text, note, address or link may be kept in the
// server's idempotency store (A6); the routes run with idempotency off as well.
import {
  CONVERSATIONS_ROUTES,
  PERSONAL_MAILBOX_ROUTES,
  PLATFORM_MAILBOX_ROUTES,
  type ConvMessage,
  type ConvNote,
  type ConvPerson,
  type ConversationList,
  type ConversationThread,
  type ConversationsApi,
  type ConvSummary,
  type EmailBody,
  type LinkCandidate,
  type MailConnectionTest,
  type PersonalMailboxApi,
  type PersonalAddressView,
  type PlatformMailbox,
  type PlatformMailboxApi,
  type QuickReply,
  type SyncResult,
} from '@shared/dashboards/conversations';
import type { DashResult } from '@shared/dashboards/common';
import type { EmailFileUpload } from '@shared/dashboards/mailFiles';
import type { WhatsAppHotelRow, WhatsAppSettings } from '@shared/dashboards/whatsapp';

import { API_BASE, del, get, patch, post, put } from '../client';

const enc = encodeURIComponent;
const FRESH = { fresh: true } as const;
/** No Idempotency-Key on any Conversations write (decision 66, A6). */
const NO_KEY = { idempotent: false } as const;

const failure = <T>(message: string): DashResult<T> => ({ ok: false, error: { code: 'SERVER_ERROR', message, traceId: '' } });

/** The bytes as base64, in pieces (a 25 MB file must not be spread into one call). */
async function base64Of(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

/**
 * Adds a file to an email: the server checks it by Gmail's rules and answers where to send it. On the live server that is an address that goes straight to the private bucket (a function on
 * Vercel refuses a body over 4.5 MB, so a 25 MB file cannot pass through it); on a machine with no bucket the file goes through the server. The Compose window then names it by `ref`.
 */
async function addEmailFile(base: string, file: Blob & { name: string; size: number }, onProgress?: (percent: number) => void): Promise<DashResult<EmailFileUpload>> {
  const begun = await post<{ ref: string; name: string; size: number; upload: { kind: 'put'; url: string } | { kind: 'server' } }>(`${base}/files`, { name: file.name, size: file.size }, NO_KEY);
  if (!begun.ok) return begun;
  const { ref, name, size, upload } = begun.data;
  if (upload.kind === 'server') {
    const sent = await put<{ ok: true }>(`${base}/files`, { ref, dataBase64: await base64Of(file) }, NO_KEY);
    if (!sent.ok) return sent;
    onProgress?.(100);
    return { ok: true, data: { ref, name, size } };
  }
  const url = upload.url;
  return new Promise<DashResult<EmailFileUpload>>((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve({ ok: true, data: { ref, name, size } });
      } else resolve(failure(`${name} could not be uploaded (the file store answered ${xhr.status}). Try again.`));
    };
    xhr.onerror = () => resolve(failure(`${name} could not be uploaded. Check the connection and try again.`));
    xhr.send(file);
  });
}

export function createHttpConversationsApi(base: '/conversations' | '/platform/conversations' | '/group/conversations' | '/my-mailbox/mail'): ConversationsApi {
  const r = CONVERSATIONS_ROUTES(base);
  // the Email page's extras (Gmail's folders, labels, star, snooze, bulk and Compose): the hotel's server carries them (hotel 0052); the platform's inbox keeps its own screen
  // a group's own inbox runs the hotel's service (platform 0166), so it has the same extras
  const hotel = base !== '/platform/conversations';
  const extras: Partial<ConversationsApi> = hotel
    ? {
        setStarred: (id, on) => patch<ConversationThread>(r.thread(enc(id)), { starred: on }, NO_KEY),
        setLabels: (id, labels) => patch<ConversationThread>(r.thread(enc(id)), { labels }, NO_KEY),
        setSnoozed: (id, until) => patch<ConversationThread>(r.thread(enc(id)), { snoozedUntil: until }, NO_KEY),
        bulk: (ids, action) => post<{ changed: number }>(`${base}/bulk`, { ids, action }, NO_KEY),
        sendNewEmail: (input) => post<{ id: string }>(`${base}/compose`, input, NO_KEY),
        // files for an email live in the hotel's own hub only (a group's inbox has its own Compose without files)
        ...(base === '/conversations' || base === '/my-mailbox/mail' ? { addEmailFile: (file: { name: string; size: number }, onProgress?: (percent: number) => void) => addEmailFile(base, file as Blob & { name: string; size: number }, onProgress) } : {}),
      }
    : {};
  return {
    ...extras,
    list: (q) =>
      get<ConversationList>(
        r.list,
        { search: q.search?.trim() || undefined, tab: q.tab ?? 'all', channel: q.channel ?? 'all', page: q.page ?? 1, size: q.size ?? 25, ...(hotel && q.folder ? { folder: q.folder } : {}), ...(hotel && q.label ? { label: q.label } : {}), ...(base === '/my-mailbox/mail' && q.address ? { address: q.address } : {}) },
        undefined,
        FRESH,
      ),
    getSummary: () => get<ConvSummary>(r.summary, undefined, undefined, FRESH),
    syncMail: (opts) => post<SyncResult>(r.sync, opts?.background ? { background: true } : {}, NO_KEY),
    getThread: (id, opts) => get<ConversationThread>(r.thread(enc(id)), opts?.before ? { before: opts.before } : undefined, undefined, FRESH),
    getEmailBody: (id, messageId, opts) => get<EmailBody>(r.body(enc(id), enc(messageId)), opts?.images ? { images: '1' } : undefined, undefined, FRESH),
    attachmentHref: (id, messageId, part) => `${API_BASE}${r.attachment(enc(id), enc(messageId), part)}`,
    sendReply: (id, input) => post<ConvMessage>(r.reply(enc(id)), input, NO_KEY),
    setAssignee: (id, userId) => patch<ConversationThread>(r.thread(enc(id)), { assignedTo: userId }, NO_KEY),
    setStatus: (id, status) => patch<ConversationThread>(r.thread(enc(id)), { status }, NO_KEY),
    setBox: (id, box) => patch<ConversationThread>(r.thread(enc(id)), { box }, NO_KEY),
    setMuted: (id, on) => (on ? put<ConversationThread>(r.mute(enc(id)), undefined, NO_KEY) : del<ConversationThread>(r.mute(enc(id)), undefined, NO_KEY)),
    markRead: (id) => put<ConversationThread>(r.read(enc(id)), undefined, NO_KEY),
    markUnread: (id) => del<ConversationThread>(r.read(enc(id)), undefined, NO_KEY),
    addNote: (id, text) => post<ConvNote>(r.notes(enc(id)), { text }, NO_KEY),
    deleteNote: (id, noteId) => del<{ removed: true }>(r.note(enc(id), enc(noteId)), undefined, NO_KEY),
    setLink: (id, link) => put<ConversationThread>(r.link(enc(id)), { kind: link.kind, targetId: link.targetId }, NO_KEY),
    deleteLink: (id) => del<ConversationThread>(r.link(enc(id)), undefined, NO_KEY),
    listLinkCandidates: (search, kind) => get<LinkCandidate[]>(r.linkCandidates, { search: search.trim() || undefined, kind }, undefined, FRESH),
    listStaff: () => get<ConvPerson[]>(r.staff),
    listQuickReplies: () => get<QuickReply[]>(r.quickReplies, undefined, undefined, FRESH),
    addQuickReply: (input) => post<QuickReply>(r.quickReplies, input, NO_KEY),
    updateQuickReply: (id, input) => patch<QuickReply>(r.quickReply(enc(id)), input, NO_KEY),
    deleteQuickReply: (id) => del<{ removed: true }>(r.quickReply(enc(id)), undefined, NO_KEY),
    getWhatsAppSettings: () => get<WhatsAppSettings>(r.whatsapp),
    setWhatsAppAutomatic: (key, on) => patch<WhatsAppSettings>(r.whatsappAutomatic, { key, on }, NO_KEY),
  };
}

/** Console > Conversations > Settings: the platform mailbox's reading switch and IMAP server, its Test connection, and the hotels on WhatsApp (no chat content). */
export function createHttpPlatformMailboxApi(): PlatformMailboxApi {
  return {
    getMailbox: () => get<PlatformMailbox>(PLATFORM_MAILBOX_ROUTES.mailbox, undefined, undefined, FRESH),
    setMailbox: (input) => patch<PlatformMailbox>(PLATFORM_MAILBOX_ROUTES.mailbox, input, NO_KEY),
    startMailboxTest: () => post<MailConnectionTest>(PLATFORM_MAILBOX_ROUTES.test, {}, NO_KEY),
    listWhatsAppHotels: () => get<WhatsAppHotelRow[]>(PLATFORM_MAILBOX_ROUTES.whatsappHotels),
  };
}

/** My mailbox (platform 0179): the signed-in staff login's own address, from any dashboard. */
export function createHttpPersonalMailboxApi(): PersonalMailboxApi {
  return {
    getAddress: () => get<PersonalAddressView>(PERSONAL_MAILBOX_ROUTES.address, undefined, undefined, FRESH),
  };
}