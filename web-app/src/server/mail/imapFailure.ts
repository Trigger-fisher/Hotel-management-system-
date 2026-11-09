import "server-only";

// Why reading a mailbox did not work, as a short CODE (decision 66, A13). The IMAP server's own words are read here only to pick the code: they are never returned, shown, logged
// or stored (they can carry the address, the login or the host's banner). Each code has one fixed sentence (IMAP_FAILURE_TEXT) and, for some mail services, a hint (mail/hints.ts).

export type ImapFailureCode = "AUTH" | "IMAP_DISABLED" | "APP_PASSWORD_BLOCKED" | "WEB_LOGIN" | "RATE_LIMITED" | "CONNECT" | "HOST_PRIVATE" | "TLS" | "TIMEOUT" | "NO_SENT_FOLDER" | "TOO_LARGE" | "UNKNOWN";

export const IMAP_FAILURE_CODES: readonly ImapFailureCode[] = ["AUTH", "IMAP_DISABLED", "APP_PASSWORD_BLOCKED", "WEB_LOGIN", "RATE_LIMITED", "CONNECT", "HOST_PRIVATE", "TLS", "TIMEOUT", "NO_SENT_FOLDER", "TOO_LARGE", "UNKNOWN"];

export const IMAP_FAILURE_TEXT: Record<ImapFailureCode, string> = {
  AUTH: "The mail server did not accept the login for reading mail.",
  IMAP_DISABLED: "Reading mail (IMAP) is turned off for this account.",
  APP_PASSWORD_BLOCKED: "This account does not allow app passwords.",
  WEB_LOGIN: "The mail service wants someone to sign in to this account in a web browser first.",
  RATE_LIMITED: "The mail server is limiting how often HMS checks.",
  CONNECT: "The mail server could not be reached for reading mail.",
  HOST_PRIVATE: "This server address is not on the internet.",
  TLS: "The secure connection to the mail server failed.",
  TIMEOUT: "The mail server took too long to answer.",
  NO_SENT_FOLDER: "No Sent folder was found in this mailbox.",
  TOO_LARGE: "This email is too large to open here.",
  UNKNOWN: "Reading mail did not work.",
};

export const isImapFailureCode = (v: unknown): v is ImapFailureCode => typeof v === "string" && (IMAP_FAILURE_CODES as readonly string[]).includes(v);

/** A failure HMS raises itself, with its code. */
export class ImapFailure extends Error {
  readonly code: ImapFailureCode;
  constructor(code: ImapFailureCode) {
    super(IMAP_FAILURE_TEXT[code]);
    this.name = "ImapFailure";
    this.code = code;
  }
}

/** The code of an error thrown by the IMAP client (imapflow), the host check or the network. Reads the error's fields to classify; returns only the code. */
export function imapFailureOf(error: unknown): ImapFailureCode {
  const e = error as { code?: unknown; name?: unknown; message?: unknown; responseText?: unknown; serverResponseCode?: unknown; authenticationFailed?: unknown; response?: unknown } | null;
  if (e && isImapFailureCode((e as { code?: unknown }).code) && (e as { name?: unknown }).name === "ImapFailure") return (e as { code: ImapFailureCode }).code;
  const code = typeof e?.code === "string" ? e.code : "";
  if (code === "HOST_PRIVATE" || code === "HOST_INVALID") return "HOST_PRIVATE";
  if (code === "HOST_UNRESOLVED") return "CONNECT";
  const words = [e?.responseText, e?.serverResponseCode, e?.response, e?.message].filter((x): x is string => typeof x === "string").join(" ");
  if (/\[THROTTLED\]|too many simultaneous connections|exceeded command or bandwidth limits|too many connections|rate limit/i.test(words) || code === "ETHROTTLE") return "RATE_LIMITED";
  if (/\[WEBALERT\]|log in via your web browser|web login required/i.test(words)) return "WEB_LOGIN";
  if (/application-specific password required|app passwords? (are|is) (disabled|not allowed|blocked)|\[ALERT\][^\n]*app password/i.test(words)) return "APP_PASSWORD_BLOCKED";
  if (/imap access is disabled|please enable imap|imap is disabled|imap not enabled/i.test(words)) return "IMAP_DISABLED";
  if (e?.authenticationFailed === true || /AUTHENTICATIONFAILED|invalid credentials|authentication failed|login failed|LOGIN failed/i.test(words)) return "AUTH";
  if (["CONNECT_TIMEOUT", "GREETING_TIMEOUT", "UPGRADE_TIMEOUT", "ETIMEOUT", "ETIMEDOUT", "TIMEOUT"].includes(code)) return "TIMEOUT";
  if (code === "ERR_TLS_CERT_ALTNAME_INVALID" || /^ERR_(TLS|SSL)|CERT|SSL|ClosedAfterConnectTLS|STARTTLS_INJECTION/.test(code)) return "TLS";
  if (["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH", "ECONNRESET", "EAI_AGAIN", "NoConnection", "EConnectionClosed", "ClosedAfterConnectText"].includes(code)) return "CONNECT";
  if (code === "DownloadOverflow" || code === "LiteralTooLarge" || code === "ResponseTooLarge") return "TOO_LARGE";
  return "UNKNOWN";
}
