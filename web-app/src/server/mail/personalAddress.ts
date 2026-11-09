import "server-only";
import { DESK_LABELS, personalMailboxCopy as P, type PersonalAddressReason, type PersonalAddressView } from "@shared/dashboards/conversations";
import { isMailAddress } from "./smtp";
import { isReservedLocal } from "./sendingDomain";

// The address of a staff login's mailbox (platform 0179; MJ, 3 Nov 2026): <username>@<the platform sending domain>, lower case. ONE pure function answers "what is this login's address and is it
// usable": no database, no settings read here. A hotel, a group and a platform desk keep their addresses at delivery, so a username that equals one of them, or a name nobody may take
// (admin, postmaster, noreply, info ... and every desk), gets NO working address; the page says so in a plain sentence and sending is blocked until the username is changed.

/** The username rule of the whole system (platform.logins): a name this shape is always a valid address local part. */
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const DESKS: ReadonlySet<string> = new Set(DESK_LABELS.map((d) => d.toLowerCase()));

export interface MailboxAddress {
  /** The address, or null when there is none to show (no domain, an invalid name). */
  address: string | null;
  /** True only when mail to the address arrives and mail from it may be sent. */
  usable: boolean;
  reason: PersonalAddressReason;
}

/**
 * @param username  the login's username (any case)
 * @param domain    the platform sending domain (mail/sendingDomain.ts sendingDomainOf), or null while the platform has none
 * @param taken     full lower-case addresses already answered by a hotel, a group or the platform (their slugs without dashes, their own SES From addresses, the platform's From address)
 */
export function mailboxAddressOf(username: string, domain: string | null, taken: ReadonlySet<string> = new Set()): MailboxAddress {
  const local = username.trim().toLowerCase();
  if (!USERNAME.test(local)) return { address: null, usable: false, reason: "invalid" };
  const host = (domain ?? "").trim().toLowerCase();
  if (host === "") return { address: null, usable: false, reason: "no_domain" };
  const address = `${local}@${host}`;
  if (!isMailAddress(address)) return { address: null, usable: false, reason: "invalid" };
  if (isReservedLocal(local) || DESKS.has(local)) return { address, usable: false, reason: "reserved" };
  if (taken.has(address)) return { address, usable: false, reason: "taken" };
  return { address, usable: true, reason: "ok" };
}

/** The view the page shows: the address, whether it works, and the plain sentence when it does not. */
export function addressViewOf(a: MailboxAddress): PersonalAddressView {
  const message = a.usable ? null : a.reason === "no_domain" ? P.noDomain : a.reason === "invalid" ? P.invalid : P.unusable;
  return { address: a.address, usable: a.usable, reason: a.reason, message };
}
