import "server-only";
import type { MailSenderIdentity, MailSenderIdentityInput } from "@shared/dashboards/mailProviders";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import { DKIM_TOKEN_RE, statusOf, systemDns, type DnsLookup } from "../../mail/identity";
import { createGate, type PlatformMeta } from "./access";
import type { ConsoleDeps } from "./context";
import { identityView, lookupIdentity } from "./identityCore";

// Sender identities for the Super Admin (MAIL-PROVIDERS-50K, 18 Oct 2026): the platform's own sending domain and the domains hotels bring. The Super Admin sees every identity with the DNS
// records and their last check, runs the DNS check, and keeps the two things only they know: the three DKIM names Amazon SES showed for the domain, and that the domain exists in SES.
// The platform identity's domain is the setting `mail.sending_domain` (Platform settings > Mail); a hotel identity's domain comes from the address the hotel typed.

const PLATFORM = "platform";
const SENDING_DOMAIN_KEY = "mail.sending_domain";

export function createIdentityService(deps: ConsoleDeps & { dns?: DnsLookup }) {
  const { unit, now } = deps;
  const gate = createGate(unit, now);
  const dns = deps.dns ?? systemDns();
  const probe = (scope: string) => ({ action: "settings_updated", entity: scope === PLATFORM ? "platform" : "hotel", entityId: scope === PLATFORM ? null : scope, hotelId: scope === PLATFORM ? null : scope }) as const;

  type Repos = Parameters<Parameters<typeof unit.run>[0]>[0];

  /** The platform identity follows the setting: a changed domain starts again, no domain removes it. */
  async function syncPlatform(repos: Repos): Promise<void> {
    const rows = await repos.settings.all();
    const raw = rows.find((r) => r.key === SENDING_DOMAIN_KEY)?.value;
    const domain = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    const existing = await repos.auth.identities.get(PLATFORM);
    if (domain === "") {
      if (existing) await repos.auth.identities.remove(PLATFORM);
      return;
    }
    if (!existing || existing.domain !== domain) await repos.auth.identities.save(PLATFORM, { domain });
  }

  async function viewOf(repos: Repos, scope: string): Promise<MailSenderIdentity | null> {
    const rec = await repos.auth.identities.get(scope);
    if (!rec) return null;
    const name = scope === PLATFORM ? null : ((await repos.hotels.get(scope, now()))?.name ?? null);
    return identityView(rec, name);
  }

  /** Every identity: the platform's first, then the hotels'. */
  async function list(session: VerifiedSession): Promise<MailSenderIdentity[]> {
    gate.superRead(session);
    return unit.run(async (repos) => {
      await gate.actor(repos, session);
      await syncPlatform(repos);
      const out: MailSenderIdentity[] = [];
      for (const rec of await repos.auth.identities.list()) out.push(identityView(rec, rec.scope === PLATFORM ? null : ((await repos.hotels.get(rec.scope, now()))?.name ?? null)));
      return out;
    });
  }

  /** Saves the three DKIM names SES showed and/or that the domain exists in SES. Audited. */
  async function save(session: VerifiedSession, scope: string, input: MailSenderIdentityInput, meta: PlatformMeta): Promise<MailSenderIdentity> {
    await gate.superWrite(session, meta, probe(scope));
    const tokens = input.dkimTokens?.map((t) => t.trim().toLowerCase());
    if (tokens !== undefined && tokens.length !== 0 && (tokens.length !== 3 || !tokens.every((t) => DKIM_TOKEN_RE.test(t)) || new Set(tokens).size !== 3)) {
      throw new AppError("VALIDATION_FAILED", "Paste the three DKIM names Amazon SES shows (letters and digits only, three different ones).", { fields: { dkimTokens: "Paste the three DKIM names Amazon SES shows (letters and digits only, three different ones)." } });
    }
    return unit.run(async (repos) => {
      const actor = await gate.actor(repos, session);
      if (scope === PLATFORM) await syncPlatform(repos);
      const rec = await repos.auth.identities.get(scope);
      if (!rec) throw new AppError("NOT_FOUND", scope === PLATFORM ? "Set the sending domain in Platform settings > Mail first." : undefined);
      const sesConfirmed = input.sesConfirmed ?? rec.sesConfirmed;
      const dkimTokens = tokens ?? rec.dkimTokens;
      // new DKIM names make the old check meaningless
      const changedTokens = tokens !== undefined && tokens.join() !== rec.dkimTokens.join();
      const result = changedTokens ? null : rec.result;
      await repos.auth.identities.save(scope, { dkimTokens, sesConfirmed, result, ...(changedTokens ? { checkedAt: null } : {}), status: statusOf(result, sesConfirmed) });
      const hotel = scope === PLATFORM ? null : await repos.hotels.get(scope, now());
      await gate.audit(repos, actor, meta, { ...probe(scope), targetLabel: hotel?.name ?? rec.domain, reason: `Sender domain ${rec.domain}: ${[tokens !== undefined ? "DKIM names saved" : "", input.sesConfirmed !== undefined ? (input.sesConfirmed ? "confirmed in SES" : "confirmation removed") : ""].filter(Boolean).join(", ")}` });
      return (await viewOf(repos, scope)) as MailSenderIdentity;
    });
  }

  /** The DNS check for one identity: looks the records up, keeps the answer, updates the status. The lookup happens outside the transaction. */
  async function check(session: VerifiedSession, scope: string, meta: PlatformMeta): Promise<MailSenderIdentity> {
    await gate.superWrite(session, meta, probe(scope));
    const rec = await unit.run(async (repos) => {
      await gate.actor(repos, session);
      if (scope === PLATFORM) await syncPlatform(repos);
      return repos.auth.identities.get(scope);
    });
    if (!rec) throw new AppError("NOT_FOUND", scope === PLATFORM ? "Set the sending domain in Platform settings > Mail first." : undefined);
    // the DNS lookup can take seconds: it runs outside the transaction
    const patch = await lookupIdentity(rec, dns, now());
    return unit.run(async (repos) => {
      const actor = await gate.actor(repos, session);
      await repos.auth.identities.save(scope, patch);
      const view = (await viewOf(repos, scope)) as MailSenderIdentity;
      await gate.audit(repos, actor, meta, { ...probe(scope), targetLabel: view.hotelName ?? view.domain, reason: `DNS check of ${view.domain}: ${view.status}` });
      return view;
    });
  }

  return { list, save, check };
}

export type IdentityService = ReturnType<typeof createIdentityService>;