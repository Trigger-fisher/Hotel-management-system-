import "server-only";
import { resolveCname, resolveTxt } from "node:dns/promises";

// Sender identities (MAIL-PROVIDERS-50K, 18 Oct 2026): the DNS records a domain needs before the platform's mail service (Amazon SES) sends from it, and the check that looks for them.
//  - DKIM (required): three CNAME records "<token>._domainkey.<domain>" -> "<token>.dkim.amazonses.com". The tokens are the ones SES shows when the domain is added there.
//  - SPF (recommended): a TXT record on the domain that allows amazonses.com. A domain can have ONE SPF record: when it already has one, "include:amazonses.com" is added to it.
//  - DMARC (recommended): a TXT record "_dmarc.<domain>"; "p=none" only reports, nothing is rejected.
// The check only reads public DNS. A domain is 'verified' when every required record is found AND the Super Admin has confirmed the identity exists in SES (the check cannot see inside SES).

export type RecordId = "dkim1" | "dkim2" | "dkim3" | "spf" | "dmarc";

export interface DnsRecord {
  id: RecordId;
  type: "CNAME" | "TXT";
  /** The full name to add the record at. */
  name: string;
  value: string;
  required: boolean;
  /** One plain sentence: what the record is for. */
  purpose: string;
}

export interface RecordResult {
  id: RecordId;
  state: "ok" | "missing" | "wrong";
  /** What was found (cut to 200 characters), when something was. */
  found?: string;
}

export interface IdentityCheck {
  /** ISO time of the check. */
  at: string;
  records: RecordResult[];
  /** Every required record is ok. */
  requiredOk: boolean;
}

/** Looks records up in DNS; a name with no such record answers an empty list, never an error. */
export interface DnsLookup {
  cname(name: string): Promise<string[]>;
  txt(name: string): Promise<string[]>;
}

export const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
export const DKIM_TOKEN_RE = /^[a-z0-9]{10,64}$/;
export const isDomain = (v: string): boolean => v.length <= 253 && DOMAIN_RE.test(v);

/** The domain part of a mail address, lower-case; null when it is not an address. */
export function domainOfAddress(address: string): string | null {
  const m = /^[^@\s]+@([^@\s]+)$/.exec(address.trim().toLowerCase());
  return m && isDomain(m[1]) ? m[1] : null;
}

/** The records to add for a domain. Without the three DKIM tokens only SPF and DMARC can be shown (the tokens come from SES once the Super Admin has added the domain there). */
export function recordsFor(domain: string, dkimTokens: readonly string[]): DnsRecord[] {
  const out: DnsRecord[] = [];
  if (dkimTokens.length === 3) {
    dkimTokens.forEach((t, i) => out.push({ id: `dkim${i + 1}` as RecordId, type: "CNAME", name: `${t}._domainkey.${domain}`, value: `${t}.dkim.amazonses.com`, required: true, purpose: "Proves the mail really comes from this domain (DKIM). Required." }));
  }
  out.push(
    { id: "spf", type: "TXT", name: domain, value: "v=spf1 include:amazonses.com ~all", required: false, purpose: "Says Amazon SES may send for this domain (SPF). If the domain already has an SPF record, add include:amazonses.com to it instead of a second record." },
    { id: "dmarc", type: "TXT", name: `_dmarc.${domain}`, value: `v=DMARC1; p=none; rua=mailto:postmaster@${domain}`, required: false, purpose: "Tells receivers what to do with mail that fails the checks (DMARC). p=none only reports." },
  );
  return out;
}

const cut = (s: string): string => (s.length > 200 ? `${s.slice(0, 200)}…` : s);
const norm = (s: string): string => s.trim().toLowerCase().replace(/\.$/, "");

/** Looks every record up and says ok, missing or wrong for each. Never throws: a lookup that fails counts as missing. */
export async function checkRecords(domain: string, records: readonly DnsRecord[], dns: DnsLookup, now: Date): Promise<IdentityCheck> {
  const results: RecordResult[] = [];
  for (const r of records) {
    try {
      if (r.type === "CNAME") {
        const found = (await dns.cname(r.name)).map(norm);
        results.push(found.length === 0 ? { id: r.id, state: "missing" } : found.includes(norm(r.value)) ? { id: r.id, state: "ok", found: cut(found[0]) } : { id: r.id, state: "wrong", found: cut(found[0]) });
      } else if (r.id === "spf") {
        const spf = (await dns.txt(r.name)).filter((t) => /^v=spf1\b/i.test(t.trim()));
        results.push(spf.length === 0 ? { id: r.id, state: "missing" } : spf.some((t) => /include:amazonses\.com\b/i.test(t)) ? { id: r.id, state: "ok", found: cut(spf[0]) } : { id: r.id, state: "wrong", found: cut(spf[0]) });
      } else {
        const dmarc = (await dns.txt(r.name)).filter((t) => /^v=dmarc1\b/i.test(t.trim()));
        results.push(dmarc.length === 0 ? { id: r.id, state: "missing" } : { id: r.id, state: "ok", found: cut(dmarc[0]) });
      }
    } catch {
      results.push({ id: r.id, state: "missing" });
    }
  }
  void domain;
  const requiredOk = records.every((r) => !r.required || results.find((x) => x.id === r.id)?.state === "ok") && records.some((r) => r.required);
  return { at: now.toISOString(), records: results, requiredOk };
}

/** verified = every required record found AND the identity confirmed in SES. */
export const statusOf = (check: IdentityCheck | null, sesConfirmed: boolean): "pending" | "verified" => (check?.requiredOk === true && sesConfirmed ? "verified" : "pending");

const NOT_FOUND = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN", "ENOENT"]);

/** The real lookup: the machine's resolver, 5 seconds a name, "no such record" is an empty list. */
export function systemDns(timeoutMs = 5000): DnsLookup {
  const guard = async <T>(p: Promise<T>, empty: T): Promise<T> => {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([p, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("dns timeout"), { code: "ETIMEOUT" })), timeoutMs); })]);
    } catch (error) {
      if (NOT_FOUND.has(String((error as { code?: unknown }).code))) return empty;
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  return {
    cname: (name) => guard(resolveCname(name), [] as string[]),
    txt: async (name) => (await guard(resolveTxt(name), [] as string[][])).map((chunks) => chunks.join("")),
  };
}
