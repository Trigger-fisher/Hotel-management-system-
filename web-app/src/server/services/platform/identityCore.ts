import "server-only";
import type { MailDnsRecord, MailSenderIdentity } from "@shared/dashboards/mailProviders";
import { checkRecords, recordsFor, statusOf, type DnsLookup, type IdentityCheck } from "../../mail/identity";
import type { SenderIdentityPatch, SenderIdentityRecord } from "../../repos/auth";

// The shared part of sender identities (mail/identity.ts has the records and the DNS lookup): the plain view of an identity for a screen, and the check that looks the records up and keeps
// the answer. Used by the Super Admin's service (every identity) and by a hotel's Settings > Email (its own).

/** The plain sentence that says what to do now. */
export function nextStepOf(rec: Pick<SenderIdentityRecord, "domain" | "fromAddress" | "dkimTokens" | "sesConfirmed" | "status" | "result">): string {
  const dkimReady = rec.dkimTokens.length === 3;
  if (rec.status === "verified") return rec.fromAddress ? `Verified. Mail is sent from ${rec.fromAddress}.` : `Verified. ${rec.domain} is ready to send from.`;
  if (!dkimReady) return `Waiting for the platform to add ${rec.domain} in Amazon SES. The DNS records to add appear here as soon as it has.`;
  if (!rec.result) return "Add these records at the company that manages your domain, then press Check DNS.";
  if (!rec.result.requiredOk) return "Some required records are missing or wrong. Fix them, wait a few minutes (DNS can be slow), and check again.";
  if (!rec.sesConfirmed) return `The DNS records are right. Waiting for the platform to confirm ${rec.domain} in Amazon SES.`;
  return "Almost there: press Check DNS once more.";
}

/** An identity as a screen shows it: every record with the state the last check found ('unchecked' before the first). */
export function identityView(rec: SenderIdentityRecord, hotelName: string | null): MailSenderIdentity {
  const records: MailDnsRecord[] = recordsFor(rec.domain, rec.dkimTokens).map((r) => {
    const found = rec.result?.records.find((x) => x.id === r.id);
    return { ...r, state: found ? found.state : "unchecked", ...(found?.found ? { found: found.found } : {}) };
  });
  return { scope: rec.scope, hotelName, domain: rec.domain, fromAddress: rec.fromAddress, status: rec.status, dkimReady: rec.dkimTokens.length === 3, sesConfirmed: rec.sesConfirmed, records, checkedAt: rec.checkedAt ? rec.checkedAt.toISOString() : null, nextStep: nextStepOf(rec) };
}

/**
 * Looks the records of this identity up in DNS (this can take seconds: call it OUTSIDE a database transaction) and says what to keep: the answer, when, and the status that follows
 * (verified = all required records found AND confirmed in SES).
 */
export async function lookupIdentity(rec: SenderIdentityRecord, dns: DnsLookup, now: Date): Promise<SenderIdentityPatch> {
  const check: IdentityCheck = await checkRecords(rec.domain, recordsFor(rec.domain, rec.dkimTokens), dns, now);
  return { result: check, checkedAt: now, status: statusOf(check, rec.sesConfirmed) };
}