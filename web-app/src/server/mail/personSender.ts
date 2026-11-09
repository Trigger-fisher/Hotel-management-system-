import "server-only";
import { randomUUID } from "node:crypto";
import { personalMailboxCopy as P } from "@shared/dashboards/conversations";
import { AppError } from "../errors";
import type { MailAttachment, MailMessage } from "../services/auth/mail";
import { failureCodeOf } from "./failure";
import { composeReply, createSmtpSender, fromHeader, type SmtpConfig, type TransportFactory } from "./smtp";

// How a staff login's mailbox SENDS (platform 0179; MJ, 3 Nov 2026): through the platform's ONE Amazon SES sender, as the person's own address (<username>@<sending domain>), with the person's
// display name and the address as Reply-To. NO FALLBACK, by MJ's rule: "the hierarchy we have done is for automated emails sent by the system, not for the mailbox".
//   - this file never imports the hotel/group/platform router (compose/mail.ts routedMailSender, mailSenderFor), the provider failover (mail/failover.ts) or any other identity;
//   - ONE attempt through ONE sender. If it fails, nothing else is tried: the person gets a plain sentence and the text stays in the compose box (or as a draft); the email is not recorded as sent;
//   - if the platform has no saved mail server, or its sending domain is not the address's domain, nothing is sent at all (the server's own SMTP_* is a fallback too, so it is not used).

export interface PersonalMail {
  to: string;
  cc?: readonly string[];
  bcc?: readonly string[];
  subject: string;
  text: string;
  inReplyTo?: string | null;
  references?: readonly string[];
  attachments?: MailAttachment[];
  bill?: boolean;
  keep?: { conversationId: string; cc: readonly string[] };
  /** One of the person's own addresses (identity checks it); default the main one. */
  from?: string;
}

export interface PersonalSendResult {
  messageId: string;
  sentAt: Date;
  source?: Buffer;
  /** The address it went from. */
  from: string;
}

export interface PersonSenderDeps {
  /** The platform's saved mail server (Platform settings > Mail), or null while none is saved. The ONLY server this file ever uses. */
  platformServer: () => Promise<SmtpConfig | null>;
  /** The login's address and name; throws a plain AppError when the address is not usable (a name used by something else). */
  identity: (loginId: string, from?: string) => Promise<{ address: string; name: string }>;
  createTransport?: TransportFactory;
  log?: (message: string, fields: Record<string, unknown>) => void;
}

/** The name on a sent email: no line break, quote or bracket (it goes into a header). */
const cleanName = (name: string): string => name.replace(/[\r\n"<>\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);

export function createPersonSender(deps: PersonSenderDeps): (loginId: string, mail: PersonalMail) => Promise<PersonalSendResult> {
  return async (loginId, mail) => {
    const who = await deps.identity(loginId, mail.from);
    let config: SmtpConfig | null = null;
    try {
      config = await deps.platformServer();
    } catch {
      // the settings could not be read: nothing is sent (the server's own configuration is not a second try)
    }
    const domain = who.address.slice(who.address.lastIndexOf("@") + 1);
    // no saved server, or one that does not send from the address's own domain (a Gmail login, say): nothing is sent, and no other server is looked for
    if (!config || !config.sendingDomain || config.sendingDomain !== domain) throw new AppError("CONFLICT", P.errors.sendUnavailable);
    const name = cleanName(who.name);
    const messageId = `<${randomUUID()}@hms.mail>`;
    const message: MailMessage = {
      to: mail.to,
      ...(mail.cc && mail.cc.length > 0 ? { cc: [...mail.cc] } : {}),
      ...(mail.bcc && mail.bcc.length > 0 ? { bcc: [...mail.bcc] } : {}),
      subject: mail.subject,
      text: mail.text,
      messageId,
      // marked as a conversation (X-HMS-Kind: conversation), not as automated system mail: a colleague's mailbox takes it in
      kind: "conversation",
      ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo } : {}),
      ...(mail.references && mail.references.length > 0 ? { references: [...mail.references] } : {}),
      ...(mail.attachments ? { attachments: mail.attachments } : {}),
      useEnvironmentFrom: true,
      fromAddress: who.address,
      ...(name ? { fromName: name } : {}),
      replyTo: who.address,
    };
    const sender = createSmtpSender(config, { createTransport: deps.createTransport });
    try {
      await sender.send(message);
    } catch (error) {
      // a code only: never the server's words, an address or the text
      deps.log?.("personal mail not sent", { code: failureCodeOf(error) });
      throw new AppError("CONFLICT", P.errors.sendFailed);
    } finally {
      sender.close();
    }
    const sentAt = new Date();
    if (!mail.keep) return { messageId, sentAt, from: who.address };
    // the whole email as sent, kept with its message in the person's own rows (like a hotel's and a group's)
    try {
      const { raw } = await composeReply({ from: fromHeader(name || null, who.address) }, { to: mail.to, cc: mail.keep.cc, ...(mail.bcc && mail.bcc.length > 0 ? { bcc: mail.bcc } : {}), subject: mail.subject, text: mail.text, inReplyTo: mail.inReplyTo ?? null, references: mail.references ?? [], messageId, conversationId: mail.keep.conversationId, ...(mail.attachments ? { attachments: mail.attachments } : {}), bill: mail.bill === true, date: sentAt });
      return { messageId, sentAt, source: raw, from: who.address };
    } catch {
      return { messageId, sentAt, from: who.address };
    }
  };
}
