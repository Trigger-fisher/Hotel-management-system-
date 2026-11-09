import "server-only";
import type { DeskLabel } from "@shared/dashboards/conversations";
import type { InboundEntry } from "../../conversations/channel";
import { entryOfInbound, sesInboundOf, type InboundSkip } from "../../mail/inbound";

// Mail that reached HMS through Amazon SES receiving (MJ, 1 Nov 2026): one SNS "Message" (the SES "Received" notification) in, the hotel's Email inbox out. The route checks the key and the
// Amazon signature first; this service decides what the message is and which hotel it belongs to. Nothing here is logged but counts and codes (never an address or a word of the mail).
//   - which hotel: the address the mail was sent to. A hotel's own SES From address (Platform > Hotel mail) first; else <slug without dashes>@<the platform sending domain>, the address a
//     hotel sends as on the platform's mail. An address of no hotel (info@, a deleted hotel) is left alone;
//   - a staff login's own mailbox (MJ, 3 Nov 2026): <username>@<the platform sending domain> goes to that login's own rows, when a hotel, a group or a desk does not already own the address;
//   - the platform's desks (MJ, 2 Nov 2026): sales@ and support@ of the platform sending domain go to the PLATFORM's own inbox, labelled Sales or Support;
//   - a repeat of the same message (SNS sends at least once) is harmless: the hub takes a Message-ID once.

export interface InboundMailPorts {
  /** The live hotels these addresses (lower case) belong to. */
  hotelsOf(recipients: readonly string[]): Promise<string[]>;
  /** Takes the entries into the hotel's hub, with the whole email of each (by its external id) kept in the hotel's own schema; how many were new. */
  deliver(hotelId: string, entries: InboundEntry[], sources: ReadonlyMap<string, Buffer>): Promise<{ added: number }>;
  /** The active groups these addresses belong to (a group's own inbox, platform 0166): <group slug without dashes>@<the sending domain>, or the group's own SES From address. */
  groupsOf?(recipients: readonly string[]): Promise<string[]>;
  /** Takes the entries into the group's own inbox, the whole email kept with each. */
  deliverGroup?(groupId: string, entries: InboundEntry[], sources: ReadonlyMap<string, Buffer>): Promise<{ added: number }>;
  /** The platform desk these addresses name (sales@ or support@ at the platform sending domain; the first one named wins), or null. */
  deskOf?(recipients: readonly string[]): Promise<DeskLabel | null>;
  /** Takes the entries into the PLATFORM's own inbox (platform.conv_*), the whole email kept with each (platform 0171), the conversation labelled with the desk. */
  deliverPlatform?(entries: InboundEntry[], sources: ReadonlyMap<string, Buffer>, desk: DeskLabel): Promise<{ added: number }>;
  /**
   * The staff logins (MJ, 3 Nov 2026; platform 0179) whose own mailbox these addresses belong to: <username>@<the sending domain> of an active, not deleted, not blocked login of a staff account
   * role, and only when that address is usable (a hotel, a group and a desk keep the addresses they already answer to, so those names are never a person's).
   */
  personsOf?(recipients: readonly string[]): Promise<string[]>;
  /** Takes the entries into that login's own rows, the whole email kept with each. Runs inside that person's scope and nothing else. */
  deliverPerson?(loginId: string, entries: InboundEntry[], sources: ReadonlyMap<string, Buffer>): Promise<{ added: number }>;
}

export interface InboundOutcome {
  /** False when the message is not a received mail at all (a test, a report): nothing was done. */
  recognised: boolean;
  /** Hotels the mail was delivered to, and how many of them (and of the groups) took it as new. */
  hotels: number;
  /** Groups the mail was delivered to (their own inbox). */
  groups: number;
  /** Staff logins the mail was delivered to (each in their own mailbox). */
  persons: number;
  /** 1 when the mail went to the platform's own inbox (a desk: sales@, support@), else 0. */
  platform: number;
  added: number;
  /** The mail was left out, and why (spam, a virus, a report, mail HMS made, no sender, unreadable); null = it was taken, or it was for no hotel. */
  skipped: InboundSkip | null;
  /** The mail was for an address of no hotel. */
  noHotel: boolean;
}

export function createInboundMailService(deps: { ports: InboundMailPorts; now: () => Date; log?: (message: string, fields: Record<string, unknown>) => void }) {
  return {
    async receive(snsMessage: unknown): Promise<InboundOutcome> {
      const inbound = sesInboundOf(snsMessage);
      if (!inbound) return { recognised: false, hotels: 0, groups: 0, persons: 0, platform: 0, added: 0, skipped: null, noHotel: false };
      const made = await entryOfInbound(inbound, deps.now());
      if ("skip" in made) {
        deps.log?.("mail-inbound: left out", { reason: made.skip });
        return { recognised: true, hotels: 0, groups: 0, persons: 0, platform: 0, added: 0, skipped: made.skip, noHotel: false };
      }
      const hotelIds = [...new Set(await deps.ports.hotelsOf(inbound.recipients))];
      const groupIds = deps.ports.groupsOf && deps.ports.deliverGroup ? [...new Set(await deps.ports.groupsOf(inbound.recipients))] : [];
      const desk = deps.ports.deskOf && deps.ports.deliverPlatform ? await deps.ports.deskOf(inbound.recipients) : null;
      const personIds = deps.ports.personsOf && deps.ports.deliverPerson ? [...new Set(await deps.ports.personsOf(inbound.recipients))] : [];
      if (hotelIds.length === 0 && groupIds.length === 0 && personIds.length === 0 && !desk) {
        deps.log?.("mail-inbound: for no hotel", { recipients: inbound.recipients.length });
        return { recognised: true, hotels: 0, groups: 0, persons: 0, platform: 0, added: 0, skipped: null, noHotel: true };
      }
      let added = 0;
      // the whole email goes with its entry: each hotel keeps its own copy in its own schema (hotel 0053), each group in its own rows (platform 0166)
      const sources = new Map([[made.entry.externalId, inbound.raw]]);
      for (const hotelId of hotelIds) added += (await deps.ports.deliver(hotelId, [made.entry], sources)).added;
      for (const groupId of groupIds) added += (await (deps.ports.deliverGroup as NonNullable<InboundMailPorts["deliverGroup"]>)(groupId, [made.entry], sources)).added;
      // a staff login's own mailbox keeps its copy in the login's own rows (platform 0178, 0179): each person's mail is taken inside that person's scope
      for (const loginId of personIds) added += (await (deps.ports.deliverPerson as NonNullable<InboundMailPorts["deliverPerson"]>)(loginId, [made.entry], sources)).added;
      // the platform's desk keeps its copy in platform.conv_mail_sources (platform 0171)
      if (desk) added += (await (deps.ports.deliverPlatform as NonNullable<InboundMailPorts["deliverPlatform"]>)([made.entry], sources, desk)).added;
      const platform = desk ? 1 : 0;
      deps.log?.("mail-inbound: taken", { hotels: hotelIds.length, groups: groupIds.length, persons: personIds.length, platform, added });
      return { recognised: true, hotels: hotelIds.length, groups: groupIds.length, persons: personIds.length, platform, added, skipped: null, noHotel: false };
    },
  };
}

export type InboundMailService = ReturnType<typeof createInboundMailService>;
