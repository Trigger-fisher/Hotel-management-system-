import "server-only";
import { randomUUID } from "node:crypto";
import { DESK_LABELS } from "@shared/dashboards/conversations";
import { hasMailbox } from "@shared/dashboards/mailboxAccess";
import type { VerifiedSession } from "../../auth/session";
import { AppError } from "../../errors";
import { mailboxAddressOf } from "../../mail/personalAddress";
import { isReservedLocal } from "../../mail/sendingDomain";
import type { PlatformConsoleUnit } from "../../repos/platformConsole";
import { createGate, type AuditInput, type Gate, type PlatformMeta } from "./access";

// Extra email addresses of a staff login (MJ, 5 Nov 2026, rule 4). Every staff login keeps its automatic <username>@<sending domain>; the Super Admin picks any staff login (hotel, group or
// platform) and gives it one or more EXTRA addresses, made from a pattern and checked to be free (never a username, a reserved name, a desk, a hotel's or group's address, or another
// extra address), and may remove them. Mail to an extra address reaches the owner's own mailbox (compose/mailInbound.ts); each address shows in that person's Email switch.

export interface ExtraAddressRow {
  id: string;
  loginId: string;
  local: string;
  domain: string;
  createdBy: string | null;
  createdAt: Date;
}

export interface ExtraAddressStore {
  list(loginId: string): Promise<ExtraAddressRow[]>;
  /** The extra addresses with these local parts on this domain (delivery). */
  byLocals(domain: string, locals: readonly string[]): Promise<ExtraAddressRow[]>;
  /** False when the address is already someone's extra address (the unique key decides). */
  add(row: Omit<ExtraAddressRow, "id" | "createdAt">, at: Date): Promise<ExtraAddressRow | null>;
  remove(loginId: string, id: string): Promise<ExtraAddressRow | null>;
}

export type AddressPattern = "org_name" | "org_word" | "name_number" | "custom";

export interface MailAddressInput {
  pattern: AddressPattern;
  /** org_word: the word after the hotel or group (frontdesk, accounts, sales); custom: the whole part before the @. */
  word?: string;
}

export interface MailAddressesView {
  /** The automatic <username>@<domain>, and whether it works. */
  auto: { address: string | null; usable: boolean };
  extras: { id: string; address: string; createdAt: string }[];
  /** null when the platform has no sending domain yet (nothing can be added). */
  domain: string | null;
}

const LOCAL = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const DESKS: ReadonlySet<string> = new Set(DESK_LABELS.map((d) => d.toLowerCase()));
const slug = (s: string | null | undefined, max = 24): string => (s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "").slice(0, max);
const FIELD = { word: "Type a word of letters and numbers, like frontdesk." };

export function createMemoryExtraAddressStore(): ExtraAddressStore & { rows: ExtraAddressRow[] } {
  const rows: ExtraAddressRow[] = [];
  return {
    rows,
    list: async (loginId) => rows.filter((r) => r.loginId === loginId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    byLocals: async (domain, locals) => rows.filter((r) => r.domain === domain && locals.includes(r.local)),
    add: async (row, at) => {
      if (rows.some((r) => r.local === row.local && r.domain === row.domain)) return null;
      const made = { ...row, id: randomUUID(), createdAt: at };
      rows.push(made);
      return made;
    },
    remove: async (loginId, id) => {
      const i = rows.findIndex((r) => r.id === id && r.loginId === loginId);
      return i < 0 ? null : (rows.splice(i, 1)[0] ?? null);
    },
  };
}

export interface MailAddressDeps {
  unit: PlatformConsoleUnit;
  now: () => Date;
  store: ExtraAddressStore;
  /** The platform sending domain, or null. */
  domain: () => Promise<string | null>;
  /** Full lower-case addresses a hotel, a group or the platform already answers on this domain. */
  taken: (domain: string) => Promise<ReadonlySet<string>>;
  /** Is this local part some login's username (their automatic address)? */
  isUsername: (local: string) => Promise<boolean>;
  gate?: Gate;
}

export function createMailAddressService(deps: MailAddressDeps) {
  const { unit, now, store } = deps;
  const gate = deps.gate ?? createGate(unit, now);
  const probe = (loginId: string, what: string): AuditInput => ({ action: "settings_updated", entity: "user", entityId: loginId, reason: `mail_address:${what}` });
  const browserOnly = (session: VerifiedSession): void => {
    if (session.token !== undefined || session.visit !== undefined) throw new AppError("FORBIDDEN", "Email addresses are given in the browser by the Super Admin.");
  };

  async function staffOf(loginId: string) {
    const row = await unit.run((repos) => repos.accounts.get(loginId));
    if (!row || !hasMailbox(row.accountRole)) throw new AppError("NOT_FOUND", "This staff login was not found.");
    return row;
  }

  async function isFree(local: string, domain: string): Promise<boolean> {
    if (!LOCAL.test(local) || isReservedLocal(local) || DESKS.has(local)) return false;
    if ((await deps.taken(domain)).has(`${local}@${domain}`)) return false;
    if (await deps.isUsername(local)) return false;
    return (await store.byLocals(domain, [local])).length === 0;
  }

  /** The first free address the pattern gives for this person (a number is added when the plain one is taken; never for a typed one). */
  async function generate(person: Awaited<ReturnType<typeof staffOf>>, input: MailAddressInput, domain: string): Promise<string> {
    const name = slug(person.displayName.split(/\s+/)[0], 20) || slug(person.username, 20);
    const org = slug(person.hotelName ?? person.groupAdminOf?.groupName ?? person.groupName ?? "", 20);
    const word = slug(input.word, 30);
    let base: string;
    if (input.pattern === "custom") {
      base = (input.word ?? "").trim().toLowerCase();
      if (!LOCAL.test(base)) throw new AppError("VALIDATION_FAILED", "Use 3 to 64 letters, numbers, dots, dashes or underscores, starting with a letter or number.", { fields: { word: "Use 3 to 64 letters, numbers, dots, dashes or underscores." } });
      if (!(await isFree(base, domain))) throw new AppError("CONFLICT", `${base}@${domain} is already in use. Try another.`, { fields: { word: "Already in use. Try another." } });
      return base;
    }
    if (input.pattern === "org_word" && word === "") throw new AppError("VALIDATION_FAILED", FIELD.word, { fields: FIELD });
    if ((input.pattern === "org_name" || input.pattern === "org_word") && org === "") throw new AppError("VALIDATION_FAILED", "This login has no hotel or group to name the address after. Choose another pattern.", { fields: { pattern: "Choose another pattern." } });
    base = input.pattern === "org_name" ? `${org}.${name}` : input.pattern === "org_word" ? `${org}.${word}` : `${name}.1`;
    if (input.pattern === "name_number") {
      for (let n = 1; n < 100; n++) if (await isFree(`${name}.${n}`, domain)) return `${name}.${n}`;
    } else {
      if (await isFree(base, domain)) return base;
      for (let n = 2; n < 100; n++) if (await isFree(`${base}${n}`, domain)) return `${base}${n}`;
    }
    throw new AppError("CONFLICT", "No free address was found for this pattern. Type your own.");
  }

  async function domainOrFail(): Promise<string> {
    const d = await deps.domain();
    if (!d) throw new AppError("CONFLICT", "The platform has no sending domain yet. Set up mail in the Set-up centre first.");
    return d;
  }

  async function viewOf(loginId: string, username: string): Promise<MailAddressesView> {
    const domain = await deps.domain();
    const auto = mailboxAddressOf(username, domain, domain ? await deps.taken(domain) : new Set());
    const extras = (await store.list(loginId)).filter((r) => r.domain === domain).map((r) => ({ id: r.id, address: `${r.local}@${r.domain}`, createdAt: r.createdAt.toISOString() }));
    return { auto: { address: auto.address, usable: auto.usable }, extras, domain };
  }

  return {
    /** A staff login's addresses: the automatic one and the extra ones. Super Admin only. */
    async list(session: VerifiedSession, loginId: string): Promise<MailAddressesView> {
      gate.superRead(session);
      browserOnly(session);
      const person = await staffOf(loginId);
      return viewOf(loginId, person.username);
    },

    /** The address a pattern would give now (nothing saved). */
    async preview(session: VerifiedSession, loginId: string, input: MailAddressInput): Promise<{ address: string }> {
      gate.superRead(session);
      browserOnly(session);
      const domain = await domainOrFail();
      return { address: `${await generate(await staffOf(loginId), input, domain)}@${domain}` };
    },

    async add(session: VerifiedSession, loginId: string, input: MailAddressInput, meta: PlatformMeta): Promise<MailAddressesView & { added: string }> {
      await gate.superWrite(session, meta, probe(loginId, "added"));
      browserOnly(session);
      const person = await staffOf(loginId);
      const domain = await domainOrFail();
      const local = await generate(person, input, domain);
      const row = await store.add({ loginId, local, domain, createdBy: session.userId }, now());
      if (!row) throw new AppError("CONFLICT", `${local}@${domain} was just taken. Try again.`);
      await unit.run(async (repos) => gate.audit(repos, await gate.actor(repos, session), meta, { ...probe(loginId, "added"), targetLabel: person.displayName, after: { address: `${local}@${domain}` } }));
      return { ...(await viewOf(loginId, person.username)), added: `${local}@${domain}` };
    },

    /** Removes an extra address (the automatic one cannot be removed). */
    async remove(session: VerifiedSession, loginId: string, id: string, meta: PlatformMeta): Promise<MailAddressesView> {
      await gate.superWrite(session, meta, probe(loginId, "removed"));
      browserOnly(session);
      const person = await staffOf(loginId);
      const gone = await store.remove(loginId, id);
      if (!gone) throw new AppError("NOT_FOUND", "This address was not found. It may be removed already.");
      await unit.run(async (repos) => gate.audit(repos, await gate.actor(repos, session), meta, { ...probe(loginId, "removed"), targetLabel: person.displayName, before: { address: `${gone.local}@${gone.domain}` } }));
      return viewOf(loginId, person.username);
    },

    /** The extra addresses of a login on the current domain (the person's own Email switch; sending from one). */
    async extrasOf(loginId: string): Promise<string[]> {
      const domain = await deps.domain();
      if (!domain) return [];
      return (await store.list(loginId)).filter((r) => r.domain === domain).map((r) => `${r.local}@${r.domain}`);
    },

    /** Delivery: the owners of these extra addresses (recipients on the domain). */
    async ownersOf(domain: string, locals: readonly string[]): Promise<string[]> {
      return [...new Set((await store.byLocals(domain, locals)).map((r) => r.loginId))];
    },
  };
}

export type MailAddressService = ReturnType<typeof createMailAddressService>;
