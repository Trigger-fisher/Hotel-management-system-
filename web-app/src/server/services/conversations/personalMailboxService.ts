import "server-only";
import { conversationsCopy as C, personalMailboxCopy as P, type PersonalAddressView } from "@shared/dashboards/conversations";
import { hasMailbox } from "@shared/dashboards/mailboxAccess";
import type { InboundEntry } from "../../conversations/channel";
import { isPortalAccount } from "../../auth/permissions";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import { addressViewOf, mailboxAddressOf, type MailboxAddress } from "../../mail/personalAddress";
import type { PersonalMailboxRepos } from "../../repos/personalMailbox";
import type { Unit } from "../../repos/types";
import { MAIL_SOURCE_MAX } from "./conversationsService";

// My mailbox (platform 0178, 0179; MJ, 3 Nov 2026): every STAFF login has its own mailbox on the platform's Amazon SES domain, in every dashboard. This file is the gate (who may open one),
// the address (<username>@<sending domain>, ONE pure function in mail/personalAddress.ts), and the delivery of received mail into the person's own rows. The mail itself (list, threads, reply,
// compose, labels, files) is the hotel's Conversations service run over the person's own rows (compose/personalMailbox.ts); sending is mail/personSender.ts (SES only, no fallback).
// Who: an account role in common/ui-shared/dashboards/mailboxAccess.ts (the account role only, never a hotel permission role), in the browser, never during a visit, never an API key.
// The login id comes from the SESSION only. Audit lines and logs hold fixed words and counts only.

/**
 * The session the personal mailbox runs in: a staff login in the browser, not in a visit. The login id stands where a hotel's id would (the unit refuses a session where the two differ),
 * with full rights over its own rows.
 */
export function personalSession(session: VerifiedSession): VerifiedSession {
  if (session.client === "token" || session.token !== undefined) throw new AppError("FORBIDDEN", "My mailbox is not available to an API key.");
  if (isPortalAccount(session) || !hasMailbox(session.accountRole)) throw new AppError("FORBIDDEN", P.errors.notStaff);
  if (session.visit !== undefined) throw new AppError("FORBIDDEN", P.errors.visit);
  if (!session.userId) throw new AppError("FORBIDDEN");
  return { ...session, hotelId: session.userId, accountRole: "hotel_admin", roleKey: "super_admin", roleLevel: 4, permissions: {} };
}

export interface PersonalMailboxDeps {
  unit: Unit<PersonalMailboxRepos>;
  now: () => Date;
  /** The login's username and display name; null when the login is not there, not active, deleted or blocked. */
  identity: (loginId: string) => Promise<{ username: string; name: string } | null>;
  /** The platform sending domain (mail/sendingDomain.ts sendingDomainOf of the saved settings), or null. */
  domain: () => Promise<string | null>;
  /** The full addresses a hotel, a group or the platform already answers on this domain (they keep winning at delivery). */
  taken: (domain: string) => Promise<ReadonlySet<string>>;
  /** The extra addresses the Super Admin gave this login (platform 0189). */
  extras?: (loginId: string) => Promise<string[]>;
  log?: (message: string, fields: Record<string, unknown>) => void;
}

export function createPersonalMailboxService(deps: PersonalMailboxDeps) {
  const { unit, now } = deps;
  /** The unit's session for a login (delivery and the daily pass have no person: the login id only). */
  const sessionOf = (loginId: string): Parameters<Unit<PersonalMailboxRepos>["run"]>[0] => ({ hotelId: loginId, userId: loginId, visit: undefined, scope: undefined }) as unknown as Parameters<Unit<PersonalMailboxRepos>["run"]>[0];

  /** What this login's address is and whether it is usable, from the login's username and the platform's settings. A login that is not active has none. */
  async function resolve(loginId: string): Promise<{ who: { username: string; name: string } | null; address: MailboxAddress }> {
    const who = await deps.identity(loginId);
    if (!who) return { who: null, address: { address: null, usable: false, reason: "invalid" } };
    const domain = await deps.domain();
    return { who, address: mailboxAddressOf(who.username, domain, domain ? await deps.taken(domain) : new Set()) };
  }

  return {
    /** The signed-in person's address, and whether it works. Records it (once, and again if the username changed). */
    async address(session: VerifiedSession): Promise<PersonalAddressView> {
      const s = personalSession(session);
      const { address } = await resolve(s.userId);
      const view = { ...addressViewOf(address), extras: deps.extras ? await deps.extras(s.userId).catch(() => []) : [] };
      if (address.address !== null) {
        await unit.run(s, async (r) => {
          if ((await r.address.get()) !== address.address) await r.address.save(address.address as string);
        });
      }
      return view;
    },

    /** The usable address of a login, or null (the "connected" note of the page and the delivery of received mail use it). */
    async usableAddress(loginId: string): Promise<string | null> {
      const { address } = await resolve(loginId);
      return address.usable ? address.address : null;
    },

    /**
     * The address and name to send as; a plain sentence (409) when the address is not usable. Sending is blocked until the username is fixed. `from` is one of the person's extra
     * addresses (or the main one); any other address is refused.
     */
    async senderOf(loginId: string, from?: string): Promise<{ address: string; name: string }> {
      const { who, address } = await resolve(loginId);
      if (!who || !address.usable || address.address === null) throw new AppError("CONFLICT", P.errors.sendBlocked);
      const asked = (from ?? "").trim().toLowerCase();
      if (asked === "" || asked === address.address) return { address: address.address, name: who.name };
      const extras = deps.extras ? (await deps.extras(loginId)).map((a) => a.toLowerCase()) : [];
      if (!extras.includes(asked)) throw new AppError("FORBIDDEN", C.errors.fromNotOwn, { fields: { from: C.errors.fromNotOwn } });
      return { address: asked, name: who.name };
    },

    /** The addresses this person may send from: the main one (when usable), then the extra ones. */
    async fromChoices(loginId: string): Promise<string[]> {
      const { address } = await resolve(loginId);
      const main = address.usable ? address.address : null;
      if (main === null) return [];
      const extras = deps.extras ? await deps.extras(loginId).catch(() => []) : [];
      return [main, ...extras.map((a) => a.toLowerCase()).filter((a) => a !== main)];
    },

    /**
     * Mail that reached a person's address through Amazon SES receiving: taken into that login's own rows with the whole email kept (at the size the hotels use). Runs inside that person's
     * scope (hms.pmail_login_id set) and touches nothing else. Not reachable from a session route.
     */
    async receive(loginId: string, entries: InboundEntry[], sources: ReadonlyMap<string, Buffer> = new Map()): Promise<{ added: number }> {
      return unit.run(sessionOf(loginId), async (repos) => {
        const { added } = await repos.conversations.ingest(entries, { mailbox: null }, repos.matcher, now());
        for (const e of entries) {
          const source = sources.get(e.externalId);
          if (!source || source.byteLength < 1 || source.byteLength > MAIL_SOURCE_MAX) continue;
          const m = await repos.conversations.messageByExternal("email", e.externalId);
          if (m && m.direction === "in") await repos.conversations.saveMailSource(m.id, source);
        }
        return { added };
      });
    },

    /**
     * The daily pass calls this, and it deletes NOTHING (MJ, 3 Nov 2026: "do not delete"): a personal mailbox's entries are never removed by a job, whatever the autoPurge switch says.
     * Kept so the cron has one place to change if a retention rule is ever decided; it answers 0 and touches no row.
     */
    async purgeForWorker(): Promise<number> {
      return 0;
    },
  };
}

export type PersonalMailboxService = ReturnType<typeof createPersonalMailboxService>;
