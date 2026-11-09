import "server-only";

// The address a hotel (or a group) sends as on the platform's mail: <slug without dashes>@<domain>. The domain is NOT typed anywhere: it is the part after the @ of the From address the Super Admin
// saves in Platform settings > Mail, so changing that address moves every hotel and group to the new domain by itself, and nothing is stored per hotel. A Gmail / Google address is
// never a sending domain (nobody may send as name@gmail.com). Pure: no database, no settings read here.

/** Free mail domains: a From address on one of them gives no sending domain. */
const SHARED_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * Local parts nobody may take by naming a hotel or a group after them (a hotel called "Support" or "Billing" must not send as support@ the company): the mail then goes from the
 * platform address with the hotel's name as before.
 */
const RESERVED_LOCALS = new Set([
  "abuse", "accounts", "admin", "administrator", "billing", "contact", "dmarc", "easyhotelsolutions", "ehs", "hello", "help", "helpdesk", "hostmaster", "info", "mail", "mailer-daemon",
  "no-reply", "noreply", "postmaster", "root", "sales", "security", "support", "team", "webmaster",
]);

export const isReservedLocal = (local: string): boolean => RESERVED_LOCALS.has(local.trim().toLowerCase());

const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

/** The domain of an address (lower case), null when it is not an address. */
export function domainOfAddress(address: string | null | undefined): string | null {
  const text = (address ?? "").trim().toLowerCase();
  const at = text.lastIndexOf("@");
  if (at < 1 || at === text.length - 1) return null;
  const domain = text.slice(at + 1);
  return DOMAIN_RE.test(domain) ? domain : null;
}

/**
 * The platform's sending domain: the domain of the saved From address, else the older stored setting (mail.sending_domain), else none. A free mail domain (Gmail) never counts, so a
 * platform that still sends from a Gmail address keeps sending every hotel mail from that one address.
 */
export function sendingDomainOf(fromEmail: string | null | undefined, stored: string | null | undefined): string | null {
  const fromDomain = domainOfAddress(fromEmail);
  if (fromDomain && !SHARED_DOMAINS.has(fromDomain)) return fromDomain;
  const old = (stored ?? "").trim().toLowerCase();
  return DOMAIN_RE.test(old) && !SHARED_DOMAINS.has(old) ? old : null;
}

/** <name>@<domain> for a hotel or group slug, written without dashes (hotel-pallav sends as hotelpallav@); null with no domain or a reserved name. */
export function mailAddressOf(slug: string | null | undefined, domain: string | null | undefined): string | null {
  const local = (slug ?? "").trim().toLowerCase().replace(/-/g, "");
  if (!local || !domain || isReservedLocal(local)) return null;
  return `${local}@${domain}`;
}
