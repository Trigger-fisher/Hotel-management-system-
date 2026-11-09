import "server-only";
import type { MailFailureCode } from "./failure";
import type { ImapFailureCode } from "./imapFailure";

// Which mail service a server is, and the plain help for the usual failures of each (shown under "Send test email"). Kept apart from smtp.ts and provider.ts so both can use it.

export const PROVIDER_IDS = ["gmail", "brevo", "ses", "smtp", "domain"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
export const isProviderId = (v: unknown): v is ProviderId => typeof v === "string" && (PROVIDER_IDS as readonly string[]).includes(v);

export const GMAIL_HOST = "smtp.gmail.com";
export const BREVO_HOST = "smtp-relay.brevo.com";
/** `email-smtp.ap-south-1.amazonaws.com`: the region is the part in the middle. */
export const SES_HOST_RE = /^email-smtp\.([a-z]{2}(?:-[a-z]+)+-\d)\.amazonaws\.com$/;

/** Which service a host belongs to; anything unknown is "smtp" (another mail server). */
export function providerIdOfHost(host: string): ProviderId {
  const h = host.trim().toLowerCase();
  if (h === GMAIL_HOST) return "gmail";
  if (h === BREVO_HOST) return "brevo";
  if (SES_HOST_RE.test(h)) return "ses";
  return "smtp";
}

export const PROVIDER_HINTS: Record<ProviderId, Partial<Record<MailFailureCode, string>>> = {
  gmail: {
    AUTH: "Gmail refused the login. Use a Google APP PASSWORD (16 letters), not the normal Google password, and check that 2-step verification is switched on for that Google account.",
    CONNECT: "The server could not reach smtp.gmail.com on port 587. Check the internet connection of the server and that port 587 is not blocked.",
    TLS: "The secure connection to Gmail failed. Try again in a few minutes.",
  },
  brevo: {
    AUTH: "Brevo refused the login. Use your Brevo SMTP login and an SMTP KEY (Brevo > SMTP & API > SMTP), not your Brevo account password.",
    CONNECT: "The server could not reach smtp-relay.brevo.com on port 587. Check the internet connection of the server and that port 587 is not blocked.",
    TLS: "The secure connection to Brevo failed. Try again in a few minutes.",
    RECIPIENT: "Brevo did not accept the recipient. Check the address.",
    REFUSED: "Brevo refused the message. Check that the sender address is added and verified in Brevo (Senders & IP) and that the daily allowance is not used up.",
  },
  ses: {
    AUTH: "Amazon SES refused the login. Use the SMTP user name and SMTP password made in the SES console (SMTP settings > Create SMTP credentials), not your AWS login or access keys, and make them in the same region as the server.",
    CONNECT: "The server could not reach Amazon SES on port 587. Check the region and that port 587 is not blocked.",
    TLS: "The secure connection to Amazon SES failed. Try again in a few minutes.",
    RECIPIENT: "Amazon SES did not accept the recipient. While the account is in the SES sandbox it only sends to verified addresses: ask AWS to move the account out of the sandbox.",
    REFUSED: "Amazon SES refused the message. Check that the sender address or its domain is verified in SES and that the account is out of the sandbox.",
  },
  domain: {},
  smtp: {
    AUTH: "The mail server refused the login. Check the user name and password with your mail provider.",
    CONNECT: "The mail server could not be reached. Check the host and port, and that the server's firewall allows the port.",
    TLS: "The secure connection failed. Use STARTTLS for port 587 and SSL/TLS for port 465.",
  },
};

/** The plain help for a failure of this server, or undefined when there is none for that code. */
export const hintFor = (host: string, code: MailFailureCode): string | undefined => PROVIDER_HINTS[providerIdOfHost(host)][code];

// Reading mail (IMAP, Conversations, decision 66): the plain help per failure code. Fixed sentences only, never the server's words.
const IMAP_HINTS_GMAIL: Partial<Record<ImapFailureCode, string>> = {
  AUTH: "Google refused the app password. Make a new app password (Google Account > Security > App passwords), paste it in Settings > Email and save.",
  IMAP_DISABLED: "IMAP is turned off for this Google Workspace account. Your Workspace admin turns it on in the Admin console > Apps > Google Workspace > Gmail > End user access > POP and IMAP access.",
  APP_PASSWORD_BLOCKED: "Your Google Workspace admin has blocked app passwords. Ask them to allow app passwords for this account.",
  WEB_LOGIN: "Google wants someone to sign in to this Gmail account in a web browser once. Sign in at mail.google.com, then try again.",
  RATE_LIMITED: "The mail server is limiting how often HMS checks. HMS will try again in a few minutes; nothing needs to change.",
  CONNECT: "HMS could not reach imap.gmail.com. Try again in a few minutes.",
  TLS: "The secure connection to Gmail failed. Try again in a few minutes.",
  TIMEOUT: "Gmail took too long to answer. Try again in a few minutes.",
  NO_SENT_FOLDER: "Gmail did not show its Sent folder. Check that \"Show in IMAP\" is ticked for Sent Mail in Gmail > Settings > Labels.",
};
const IMAP_HINTS_OTHER: Partial<Record<ImapFailureCode, string>> = {
  AUTH: "The mail server refused the login. Check the login and password in Settings > Email with your mail provider.",
  IMAP_DISABLED: "Reading mail (IMAP) is turned off for this account. Ask your mail provider to switch IMAP on.",
  APP_PASSWORD_BLOCKED: "This account does not allow app passwords. Ask the account's admin to allow them.",
  WEB_LOGIN: "Your mail provider wants someone to sign in to this account in a web browser once. Sign in there, then try again.",
  RATE_LIMITED: "The mail server is limiting how often HMS checks. HMS will try again in a few minutes; nothing needs to change.",
  HOST_PRIVATE: "This server address is not on the internet. Use your mail provider's public IMAP/SMTP server name.",
  CONNECT: "The IMAP server could not be reached. Check the IMAP server name and port (993 or 143) with your mail provider.",
  TLS: "The secure connection failed. Use port 993 (SSL/TLS) or 143 (STARTTLS), as your mail provider says.",
  TIMEOUT: "The mail server took too long to answer. Try again in a few minutes.",
  NO_SENT_FOLDER: "No Sent folder was found. Replies are still sent; ask your mail provider how the Sent folder is shown over IMAP.",
};

/** The plain help for a mail-reading failure of this IMAP server (imap.gmail.com is Gmail's), or undefined. */
export function imapHintFor(host: string, code: ImapFailureCode): string | undefined {
  const h = host.trim().toLowerCase();
  if (code === "HOST_PRIVATE") return IMAP_HINTS_OTHER.HOST_PRIVATE;
  return (h === "imap.gmail.com" ? IMAP_HINTS_GMAIL : IMAP_HINTS_OTHER)[code];
}
