import "server-only";
// Why a mail did not go, as a short CODE (never the mail server's own words: they can carry the address, the login or the host's banner). The code is kept on the outbox
// row ("last_error", migration 0124) and shown in the hotel's Settings > Email as a plain sentence ("Last mail failed: ...").

export type MailFailureCode = "AUTH" | "CONNECT" | "TLS" | "RECIPIENT" | "REFUSED" | "NO_SENDER" | "RENDER" | "NO_HOTEL" | "SUPPRESSED" | "CANCELLED" | "PAUSED" | "UNKNOWN";

export const MAIL_FAILURE_TEXT: Record<MailFailureCode, string> = {
  AUTH: "The mail server did not accept the login. Check the username and password in Settings > Email.",
  CONNECT: "The mail server could not be reached. Check the host and port in Settings > Email.",
  TLS: "The secure connection to the mail server failed. Check the encryption setting in Settings > Email.",
  RECIPIENT: "The mail server did not accept the recipient's address.",
  REFUSED: "The mail server refused the message.",
  NO_SENDER: "No mail server is set up to send this mail.",
  RENDER: "The attachment could not be made (the bill or receipt may have been removed).",
  NO_HOTEL: "The hotel of this mail is not available, so it was not sent.",
  SUPPRESSED: "The address bounced before or was marked as spam, so campaign mail is not sent to it.",
  CANCELLED: "The campaign was cancelled before this mail went.",
  PAUSED: "Mail is paused for this hotel by the platform. This mail waits and goes out when the pause ends.",
  UNKNOWN: "The mail could not be sent.",
};

/** A failure no retry can mend (the hotel is gone or was never there, the address is suppressed): the row is marked failed at once instead of being tried again. */
export const isPermanentFailure = (code: MailFailureCode): boolean => code === "NO_HOTEL" || code === "SUPPRESSED" || code === "CANCELLED";

export const isMailFailureCode = (v: unknown): v is MailFailureCode => typeof v === "string" && v in MAIL_FAILURE_TEXT;

/** The failure code of an error thrown by a transport (nodemailer's `code`, `responseCode`, `command`) or by the mail code itself. Reads codes only, never the text. */
export function failureCodeOf(error: unknown): MailFailureCode {
  const e = error as { reason?: unknown; code?: unknown; responseCode?: unknown; command?: unknown } | null;
  if (e && isMailFailureCode(e.reason)) return e.reason;
  const code = typeof e?.code === "string" ? e.code : "";
  const response = typeof e?.responseCode === "number" ? e.responseCode : 0;
  if (code === "EAUTH" || response === 535 || response === 534 || e?.command === "AUTH PLAIN" || e?.command === "AUTH LOGIN") return "AUTH";
  if (code === "EENVELOPE" || response === 550 || response === 551 || response === 553 || response === 553) return "RECIPIENT";
  if (code === "ETLS" || /^ERR_(TLS|SSL)|CERT|SSL/.test(code)) return "TLS";
  if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "ECONNREFUSED", "ENOTFOUND", "EDNS", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH"].includes(code)) return "CONNECT";
  if (response >= 400) return "REFUSED";
  return "UNKNOWN";
}