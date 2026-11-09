import "server-only";
import { fromHeader, GMAIL, isMailAddress, readSmtpPassword, type SmtpConfig } from "./smtp";
import { providerIdOfHost } from "./hints";
import { sesHostOf } from "./provider";
import type { GroupMailRow, HotelMailRow } from "../repos/platformConsole";

// A hotel's or a group's own mail accounts, set by the Super Admin (platform.hotel_mail 0161, platform.group_mail 0162): an Amazon SES login and a Google login. This module turns a saved
// row into the two mail servers the shared sender needs. The order of use is decided by the router (mail/hotelSmtp.ts): the hotel's SES, its Google, the group's SES, the group's Google,
// then the platform's SES and the platform's Google backup.

/** The scope a hotel's SES password is sealed under (a sealed value of another hotel, or of the Google login, does not open as this one). */
export const hotelSesScope = (hotelId: string): string => `hotel-mail:ses:${hotelId}`;
export const hotelGmailScope = (hotelId: string): string => `hotel-mail:gmail:${hotelId}`;
/** The same for a group: a sealed value of a hotel never opens as a group's, nor the other way round. */
export const groupSesScope = (groupId: string): string => `group-mail:ses:${groupId}`;
export const groupGmailScope = (groupId: string): string => `group-mail:gmail:${groupId}`;

export type { GroupMailRow, HotelMailRow };

export interface HotelMailRead {
  /** The Amazon SES login as a mail server; null = not set, or not usable (no login, no password, no From address, a password that cannot be opened). */
  ses: SmtpConfig | null;
  /** The Google login as a mail server; null = not set or not usable. */
  gmail: SmtpConfig | null;
  sesUnreadable: boolean;
  gmailUnreadable: boolean;
  /** The sender name and reply-to the mail carries even when it goes out through the platform. */
  fromName: string | null;
  replyTo: string | null;
}

type Accounts = Omit<HotelMailRow, "hotelId" | "updatedAt" | "sesTest" | "gmailTest">;

/**
 * The saved fields as usable mail servers; `scopes` bind each sealed password to its owner. `ownerName` is the sender name when the Super Admin left it empty. `platformSes` is the Amazon
 * SES login of Platform settings > Email: an owner that saved only an EMAIL ADDRESS for SES (no login of its own) sends through it, as that address.
 */
function readAccounts(row: Accounts, scopes: { ses: string; gmail: string }, key: Buffer | null, ownerName: string | null, platformSes: SmtpConfig | null = null, autoFrom: string | null = null): HotelMailRead {
  const name = (row.fromName ?? "").trim() || ownerName;
  const cleanName = name && !/[\r\n]/.test(name) ? name : null;
  const replyTo = (row.replyTo ?? "").trim().toLowerCase();
  const reply = isMailAddress(replyTo) ? { replyTo } : {};

  const sesPass = readSmtpPassword(row.sesPassword, key, scopes.ses);
  const sesUser = (row.sesUser ?? "").trim();
  const sesFrom = (row.sesFrom ?? "").trim().toLowerCase();
  const ownLogin = sesUser !== "" && sesPass.pass !== null && isMailAddress(sesFrom) && row.sesRegion;
  // Amazon SES is automatic: the platform's own SES login sends as the owner's own address (name@domain, made by itself) unless an email address was saved for it, which replaces that address.
  // An owner with a login of its own uses it. Not when the platform's service is not SES.
  const sesAddress = isMailAddress(sesFrom) ? sesFrom : autoFrom !== null && isMailAddress(autoFrom) ? autoFrom : null;
  const viaPlatform = !ownLogin && sesUser === "" && sesAddress !== null && platformSes !== null && providerIdOfHost(platformSes.host) === "ses";
  const ses: SmtpConfig | null = ownLogin
    ? { host: sesHostOf(row.sesRegion as string), port: 587, security: "starttls", user: sesUser, pass: sesPass.pass as string, from: fromHeader(cleanName, sesFrom), ...reply }
    : viaPlatform
      ? { ...(platformSes as SmtpConfig), from: fromHeader(cleanName, sesAddress as string), ...reply }
      : null;

  const gmPass = readSmtpPassword(row.gmailPassword, key, scopes.gmail);
  const gmUser = (row.gmailUser ?? "").trim().toLowerCase();
  // Google sends as the account itself, so the From address is the Google address
  const gmail: SmtpConfig | null = isMailAddress(gmUser) && gmPass.pass !== null
    ? { host: GMAIL.host, port: GMAIL.port, security: GMAIL.security, user: gmUser, pass: gmPass.pass, from: fromHeader(cleanName, gmUser), ...reply }
    : null;

  return { ses, gmail, sesUnreadable: sesPass.unreadable, gmailUnreadable: gmPass.unreadable, fromName: cleanName, replyTo: isMailAddress(replyTo) ? replyTo : null };
}

/** A hotel's saved row as usable mail servers. `hotelName` is the sender name when the Super Admin left it empty. */
export const readHotelMail = (row: HotelMailRow, key: Buffer | null, hotelName: string | null, platformSes: SmtpConfig | null = null, autoFrom: string | null = null): HotelMailRead =>
  readAccounts(row, { ses: hotelSesScope(row.hotelId), gmail: hotelGmailScope(row.hotelId) }, key, hotelName, platformSes, autoFrom);

/** A group's saved row as usable mail servers. `groupName` is the sender name when the Super Admin left it empty. */
export const readGroupMail = (row: GroupMailRow, key: Buffer | null, groupName: string | null, platformSes: SmtpConfig | null = null, autoFrom: string | null = null): HotelMailRead =>
  readAccounts(row, { ses: groupSesScope(row.groupId), gmail: groupGmailScope(row.groupId) }, key, groupName, platformSes, autoFrom);

/** The servers an owner's mail tries, in order: its SES, then its Google. Empty = the owner has none (the next level sends). */
export const serversOf = (read: HotelMailRead | null): SmtpConfig[] => (read ? [read.ses, read.gmail].filter((c): c is SmtpConfig => c !== null) : []);

/** Which server the owner's mail tries first: its SES; when it has no SES, its Google. null = none. */
export const firstOf = (read: HotelMailRead | null): SmtpConfig | null => serversOf(read)[0] ?? null;
