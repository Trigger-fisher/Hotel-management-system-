import "server-only";
import type { MailSenderIdentity } from "@shared/dashboards/mailProviders";
import { domainOfAddress, systemDns, type DnsLookup } from "../mail/identity";
import type { HotelIdentityPort } from "../services/admin/settingsService";
import { identityView, lookupIdentity } from "../services/platform/identityCore";
import { getPlatformUnit } from "./auth";

// A hotel's own sender domain, on the platform unit (platform.sender_identities): what Settings > Email shows, saves and checks for the hotel that chose "My own domain". The DNS lookup runs
// outside any transaction. Nothing here can read another hotel's identity: every call names the signed-in hotel.
export function hotelIdentityPort(dns: DnsLookup = systemDns(), now: () => Date = () => new Date()): HotelIdentityPort {
  const unit = () => getPlatformUnit();
  return {
    view: (hotelId, hotelName) =>
      unit().run(async (r) => {
        const rec = await r.identities.get(hotelId);
        return rec ? identityView(rec, hotelName) : null;
      }),
    save: (hotelId, address) =>
      unit().run(async (r) => {
        const domain = domainOfAddress(address);
        if (!domain) return false;
        return (await r.identities.save(hotelId, { domain, fromAddress: address })) !== null;
      }),
    remove: (hotelId) => unit().run((r) => r.identities.remove(hotelId)),
    async check(hotelId, hotelName): Promise<MailSenderIdentity | null> {
      const rec = await unit().run((r) => r.identities.get(hotelId));
      if (!rec) return null;
      const patch = await lookupIdentity(rec, dns, now());
      return unit().run(async (r) => {
        const saved = await r.identities.save(hotelId, patch);
        return saved ? identityView(saved, hotelName) : null;
      });
    },
  };
}

/** The address a verified hotel identity sends from: its address on its own domain, only when the DNS check passed and the platform confirmed the domain in SES. */
export async function verifiedDomainAddress(hotelId: string): Promise<string | null> {
  const rec = await getPlatformUnit().run((r) => r.identities.get(hotelId));
  return rec && rec.status === "verified" && rec.fromAddress ? rec.fromAddress : null;
}